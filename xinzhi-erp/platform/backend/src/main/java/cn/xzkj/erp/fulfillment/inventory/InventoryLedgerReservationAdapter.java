package cn.xzkj.erp.fulfillment.inventory;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

import cn.xzkj.erp.fulfillment.service.FulfillmentExceptions.Conflict;
import cn.xzkj.erp.fulfillment.service.FulfillmentExceptions.Invalid;
import cn.xzkj.erp.fulfillment.service.FulfillmentExceptions.NotFound;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;

/**
 * V46 reservation adapter over the V44 inventory balance grain. Reservations
 * are separate facts, so allocation changes available quantity without
 * rewriting the append-only on-hand ledger. Negative availability is retained.
 */
@Component
public class InventoryLedgerReservationAdapter implements InventoryReservationPort {

    private static final Pattern REQUEST_ID =
            Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");

    private final NamedParameterJdbcTemplate jdbc;
    private final WarehouseScopeEvaluator scopeEvaluator;

    public InventoryLedgerReservationAdapter(
            NamedParameterJdbcTemplate jdbc,
            WarehouseScopeEvaluator scopeEvaluator) {
        this.jdbc = jdbc;
        this.scopeEvaluator = scopeEvaluator;
    }

    @Override
    public ReservationResult reserve(ReservationCommand command) {
        validate(command);
        scopeEvaluator.requireVisible(
                scopeEvaluator.evaluate(
                        command.tenantId(),
                        command.actorUserId(),
                        command.actorSystemAdminId()),
                command.warehouseId());

        String fingerprint = fingerprint(command);
        Existing existing = existing(command);
        if (existing != null) {
            if (!existing.fingerprint().equals(fingerprint)) {
                throw new Conflict("idempotency_conflict");
            }
            return new ReservationResult(
                    existing.operationReference(),
                    existing.availableAfter());
        }

        requireAssignableMasterData(command);
        ensureAndLockBalance(command);
        long availableAfter;
        try {
            availableAfter = Math.subtractExact(
                    Math.subtractExact(currentOnHand(command), currentReserved(command)),
                    command.quantity());
        } catch (ArithmeticException exception) {
            throw new Invalid("quantity");
        }

        UUID reservationId = UUID.randomUUID();
        String operationReference = "inventory-reservation:"
                + fingerprint.substring(0, 32);
        MapSqlParameterSource parameters = parameters(command, fingerprint)
                .addValue("reservationId", reservationId)
                .addValue("operationReference", operationReference)
                .addValue("availableAfter", availableAfter);
        jdbc.update("""
                INSERT INTO tenant_inventory_reservations (
                    id, tenant_id, fulfillment_plan_id, fulfillment_line_id,
                    sku_id, warehouse_id, location_id, quantity, command_id,
                    request_fingerprint, operation_reference, available_after,
                    actor_user_id, actor_system_admin_id, request_id
                ) VALUES (
                    :reservationId, :tenantId, :planId, :lineId,
                    :skuId, :warehouseId, :locationId, :quantity, :commandId,
                    :fingerprint, :operationReference, :availableAfter,
                    :actorUserId, :actorSystemAdminId, :requestId
                )
                """, parameters);
        insertReservationEvent(
                reservationId, command.tenantId(), command.fulfillmentPlanId(),
                command.fulfillmentLineId(), "RESERVED", command.quantity(),
                command.commandId(), null, null, command.actorUserId(),
                command.actorSystemAdminId(), command.requestId());
        return new ReservationResult(operationReference, availableAfter);
    }

    @Override
    public InventoryFact consume(ConsumptionCommand command) {
        validateChange(
                command == null ? null : command.tenantId(),
                command == null ? null : command.commandId(),
                command == null ? null : command.fulfillmentPlanId(),
                command == null ? null : command.fulfillmentLineId(),
                command == null ? 0 : command.quantity(),
                command == null ? null : command.actorUserId(),
                command == null ? null : command.actorSystemAdminId(),
                command == null ? null : command.requestId());
        if (command.shipmentEventId() == null) {
            throw new Invalid("shipmentEventId");
        }
        Reservation reservation = lockReservation(
                command.tenantId(), command.fulfillmentPlanId(),
                command.fulfillmentLineId());
        requireVisible(command.tenantId(), command.actorUserId(),
                command.actorSystemAdminId(), reservation.warehouseId());
        if (reservation.remaining() < command.quantity()) {
            throw new Conflict("reservation_quantity_conflict");
        }
        Balance balance = lockBalance(
                command.tenantId(), reservation.skuId(), reservation.warehouseId());
        long nextOnHand = subtractExact(balance.onHand(), command.quantity());
        UUID inventoryEventId = UUID.randomUUID();
        long nextVersion = Math.incrementExact(balance.version());
        insertLedgerEvent(
                inventoryEventId, command.tenantId(), "FULFILLMENT_SHIPMENT",
                reservation.skuId(), reservation.warehouseId(),
                -((long) command.quantity()), nextOnHand, nextVersion,
                "FULFILLMENT_HANDOVER", null, command.actorUserId(),
                command.actorSystemAdminId(), command.requestId());
        updateBalance(balance, nextOnHand, nextVersion, inventoryEventId);
        updateReservation(
                reservation, command.quantity(), 0, command.tenantId());
        insertReservationEvent(
                reservation.id(), command.tenantId(), command.fulfillmentPlanId(),
                command.fulfillmentLineId(), "CONSUMED", command.quantity(),
                command.commandId(), command.shipmentEventId(), inventoryEventId,
                command.actorUserId(), command.actorSystemAdminId(), command.requestId());
        insertShipmentInventoryLink(
                command.tenantId(), command.shipmentEventId(),
                command.fulfillmentLineId(), inventoryEventId, command.quantity());
        return new InventoryFact(inventoryEventId, nextOnHand, nextVersion);
    }

    @Override
    public void release(ReleaseCommand command) {
        validateChange(
                command == null ? null : command.tenantId(),
                command == null ? null : command.commandId(),
                command == null ? null : command.fulfillmentPlanId(),
                command == null ? null : command.fulfillmentLineId(),
                command == null ? 0 : command.quantity(),
                command == null ? null : command.actorUserId(),
                command == null ? null : command.actorSystemAdminId(),
                command == null ? null : command.requestId());
        Reservation reservation = lockReservation(
                command.tenantId(), command.fulfillmentPlanId(),
                command.fulfillmentLineId());
        requireVisible(command.tenantId(), command.actorUserId(),
                command.actorSystemAdminId(), reservation.warehouseId());
        if (reservation.remaining() < command.quantity()) {
            throw new Conflict("reservation_quantity_conflict");
        }
        updateReservation(reservation, 0, command.quantity(), command.tenantId());
        insertReservationEvent(
                reservation.id(), command.tenantId(), command.fulfillmentPlanId(),
                command.fulfillmentLineId(), "RELEASED", command.quantity(),
                command.commandId(), null, null, command.actorUserId(),
                command.actorSystemAdminId(), command.requestId());
    }

    @Override
    public InventoryFact reverseConsumption(CorrectionCommand command) {
        validateChange(
                command == null ? null : command.tenantId(),
                command == null ? null : command.commandId(),
                command == null ? null : command.fulfillmentPlanId(),
                command == null ? null : command.fulfillmentLineId(),
                command == null ? 0 : command.quantity(),
                command == null ? null : command.actorUserId(),
                command == null ? null : command.actorSystemAdminId(),
                command == null ? null : command.requestId());
        if (command.originalShipmentEventId() == null
                || command.correctionShipmentEventId() == null) {
            throw new Invalid("shipmentEventId");
        }
        Reservation reservation = lockReservation(
                command.tenantId(), command.fulfillmentPlanId(),
                command.fulfillmentLineId());
        requireVisible(command.tenantId(), command.actorUserId(),
                command.actorSystemAdminId(), reservation.warehouseId());
        if (reservation.consumedQuantity() < command.quantity()) {
            throw new Conflict("reservation_quantity_conflict");
        }
        OriginalInventoryEvent original = lockOriginalInventoryEvent(
                command.tenantId(), command.originalShipmentEventId(),
                command.fulfillmentLineId());
        if (original.quantity() != command.quantity()
                || original.signedDelta() != -((long) command.quantity())) {
            throw new Conflict("shipment_correction_conflict");
        }
        Balance balance = lockBalance(
                command.tenantId(), reservation.skuId(), reservation.warehouseId());
        long nextOnHand = addExact(balance.onHand(), command.quantity());
        UUID inventoryEventId = UUID.randomUUID();
        long nextVersion = Math.incrementExact(balance.version());
        insertLedgerReversal(
                inventoryEventId, command.tenantId(), reservation.skuId(),
                reservation.warehouseId(), command.quantity(), nextOnHand,
                nextVersion, original.inventoryEventId(), command.actorUserId(),
                command.actorSystemAdminId(), command.requestId());
        updateBalance(balance, nextOnHand, nextVersion, inventoryEventId);
        updateReservation(
                reservation, -command.quantity(), 0, command.tenantId());
        insertReservationEvent(
                reservation.id(), command.tenantId(), command.fulfillmentPlanId(),
                command.fulfillmentLineId(), "CONSUMPTION_REVERSED", command.quantity(),
                command.commandId(), command.correctionShipmentEventId(),
                inventoryEventId, command.actorUserId(),
                command.actorSystemAdminId(), command.requestId());
        insertShipmentInventoryLink(
                command.tenantId(), command.correctionShipmentEventId(),
                command.fulfillmentLineId(), inventoryEventId, -command.quantity());
        return new InventoryFact(inventoryEventId, nextOnHand, nextVersion);
    }

    private Existing existing(ReservationCommand command) {
        return jdbc.query("""
                SELECT request_fingerprint, operation_reference, available_after
                FROM tenant_inventory_reservations
                WHERE tenant_id = :tenantId AND fulfillment_line_id = :lineId
                """, new MapSqlParameterSource()
                        .addValue("tenantId", command.tenantId())
                        .addValue("lineId", command.fulfillmentLineId()),
                (rs, row) -> new Existing(
                        rs.getString("request_fingerprint"),
                        rs.getString("operation_reference"),
                        rs.getLong("available_after")))
                .stream().findFirst().orElse(null);
    }

    private void requireAssignableMasterData(ReservationCommand command) {
        boolean found = !jdbc.query("""
                SELECT 1
                FROM tenant_product_skus sku
                JOIN tenant_warehouses warehouse
                  ON warehouse.tenant_id = sku.tenant_id
                WHERE sku.tenant_id = :tenantId
                  AND sku.id = :skuId
                  AND sku.status = 'ACTIVE'
                  AND warehouse.id = :warehouseId
                  AND warehouse.status = 'ACTIVE'
                  AND (
                    cast(:locationId as uuid) IS NULL OR EXISTS (
                      SELECT 1 FROM tenant_warehouse_locations location
                      WHERE location.tenant_id = :tenantId
                        AND location.id = :locationId
                        AND location.warehouse_id = :warehouseId
                        AND location.status = 'ACTIVE'
                    )
                  )
                FOR UPDATE OF sku, warehouse
                """, new MapSqlParameterSource()
                        .addValue("tenantId", command.tenantId())
                        .addValue("skuId", command.skuId())
                        .addValue("warehouseId", command.warehouseId())
                        .addValue("locationId", command.locationId()),
                (rs, row) -> rs.getInt(1)).isEmpty();
        if (!found) {
            throw new NotFound();
        }
    }

    private void ensureAndLockBalance(ReservationCommand command) {
        Map<String, Object> parameters = dimensions(command);
        jdbc.update("""
                INSERT INTO inventory_balances (tenant_id, sku_id, warehouse_id)
                VALUES (:tenantId, :skuId, :warehouseId)
                ON CONFLICT (tenant_id, sku_id, warehouse_id) DO NOTHING
                """, parameters);
        jdbc.queryForObject("""
                SELECT id FROM inventory_balances
                WHERE tenant_id = :tenantId
                  AND sku_id = :skuId
                  AND warehouse_id = :warehouseId
                FOR UPDATE
                """, parameters, UUID.class);
    }

    private long currentOnHand(ReservationCommand command) {
        Long value = jdbc.queryForObject("""
                SELECT on_hand FROM inventory_balances
                WHERE tenant_id = :tenantId
                  AND sku_id = :skuId
                  AND warehouse_id = :warehouseId
                """, dimensions(command), Long.class);
        return value == null ? 0 : value;
    }

    private long currentReserved(ReservationCommand command) {
        Long value = jdbc.queryForObject("""
                SELECT coalesce(sum(quantity - consumed_quantity - released_quantity), 0)
                FROM tenant_inventory_reservations
                WHERE tenant_id = :tenantId
                  AND sku_id = :skuId
                  AND warehouse_id = :warehouseId
                """, dimensions(command), Long.class);
        return value == null ? 0 : value;
    }

    private Reservation lockReservation(
            UUID tenantId, UUID planId, UUID lineId) {
        return jdbc.query("""
                SELECT id, sku_id, warehouse_id, quantity,
                       consumed_quantity, released_quantity, version
                FROM tenant_inventory_reservations
                WHERE tenant_id = :tenantId
                  AND fulfillment_plan_id = :planId
                  AND fulfillment_line_id = :lineId
                FOR UPDATE
                """, new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("planId", planId)
                        .addValue("lineId", lineId),
                (rs, row) -> new Reservation(
                        rs.getObject("id", UUID.class),
                        rs.getObject("sku_id", UUID.class),
                        rs.getObject("warehouse_id", UUID.class),
                        rs.getInt("quantity"),
                        rs.getInt("consumed_quantity"),
                        rs.getInt("released_quantity"),
                        rs.getLong("version")))
                .stream().findFirst().orElseThrow(NotFound::new);
    }

    private Balance lockBalance(UUID tenantId, UUID skuId, UUID warehouseId) {
        return jdbc.query("""
                SELECT id, on_hand, version
                FROM inventory_balances
                WHERE tenant_id = :tenantId
                  AND sku_id = :skuId
                  AND warehouse_id = :warehouseId
                FOR UPDATE
                """, new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("skuId", skuId)
                        .addValue("warehouseId", warehouseId),
                (rs, row) -> new Balance(
                        rs.getObject("id", UUID.class),
                        rs.getLong("on_hand"),
                        rs.getLong("version")))
                .stream().findFirst().orElseThrow(NotFound::new);
    }

    private OriginalInventoryEvent lockOriginalInventoryEvent(
            UUID tenantId, UUID shipmentEventId, UUID lineId) {
        return jdbc.query("""
                SELECT link.inventory_event_id, link.quantity, event.signed_delta
                FROM tenant_shipment_inventory_events link
                JOIN inventory_ledger_events event
                  ON event.tenant_id = link.tenant_id
                 AND event.id = link.inventory_event_id
                WHERE link.tenant_id = :tenantId
                  AND link.shipment_event_id = :shipmentEventId
                  AND link.fulfillment_line_id = :lineId
                  AND link.quantity > 0
                  AND NOT EXISTS (
                    SELECT 1 FROM inventory_ledger_events reversal
                    WHERE reversal.tenant_id = event.tenant_id
                      AND reversal.reversal_of_event_id = event.id
                  )
                FOR UPDATE OF event
                """, new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("shipmentEventId", shipmentEventId)
                        .addValue("lineId", lineId),
                (rs, row) -> new OriginalInventoryEvent(
                        rs.getObject("inventory_event_id", UUID.class),
                        rs.getInt("quantity"),
                        rs.getLong("signed_delta")))
                .stream().findFirst()
                .orElseThrow(() -> new Conflict("shipment_correction_conflict"));
    }

    private void updateReservation(
            Reservation reservation, int consumedDelta, int releasedDelta,
            UUID tenantId) {
        int changed = jdbc.update("""
                UPDATE tenant_inventory_reservations
                SET consumed_quantity = consumed_quantity + :consumedDelta,
                    released_quantity = released_quantity + :releasedDelta,
                    version = version + 1
                WHERE tenant_id = :tenantId
                  AND id = :reservationId
                  AND version = :version
                  AND consumed_quantity + :consumedDelta >= 0
                  AND released_quantity + :releasedDelta >= 0
                  AND consumed_quantity + :consumedDelta
                      + released_quantity + :releasedDelta <= quantity
                """, new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("reservationId", reservation.id())
                        .addValue("version", reservation.version())
                        .addValue("consumedDelta", consumedDelta)
                        .addValue("releasedDelta", releasedDelta));
        if (changed != 1) {
            throw new Conflict("reservation_quantity_conflict");
        }
    }

    private void insertLedgerEvent(
            UUID eventId, UUID tenantId, String eventType, UUID skuId,
            UUID warehouseId, long delta, long balanceAfter,
            long balanceVersion, String reason, UUID reversalOf,
            UUID actorUserId, UUID actorSystemAdminId, String requestId) {
        jdbc.update("""
                INSERT INTO inventory_ledger_events (
                    id, tenant_id, event_type, sku_id, warehouse_id,
                    signed_delta, balance_after, balance_version_after,
                    reason, reversal_of_event_id, actor_user_id,
                    actor_system_admin_id, request_id
                ) VALUES (
                    :eventId, :tenantId, :eventType, :skuId, :warehouseId,
                    :delta, :balanceAfter, :balanceVersion, :reason,
                    :reversalOf, :actorUserId, :actorSystemAdminId, :requestId
                )
                """, new MapSqlParameterSource()
                        .addValue("eventId", eventId)
                        .addValue("tenantId", tenantId)
                        .addValue("eventType", eventType)
                        .addValue("skuId", skuId)
                        .addValue("warehouseId", warehouseId)
                        .addValue("delta", delta)
                        .addValue("balanceAfter", balanceAfter)
                        .addValue("balanceVersion", balanceVersion)
                        .addValue("reason", reason)
                        .addValue("reversalOf", reversalOf)
                        .addValue("actorUserId", actorUserId)
                        .addValue("actorSystemAdminId", actorSystemAdminId)
                        .addValue("requestId", requestId));
    }

    private void insertLedgerReversal(
            UUID eventId, UUID tenantId, UUID skuId, UUID warehouseId,
            long delta, long balanceAfter, long balanceVersion,
            UUID reversalOf, UUID actorUserId, UUID actorSystemAdminId,
            String requestId) {
        insertLedgerEvent(
                eventId, tenantId, "REVERSAL", skuId, warehouseId,
                delta, balanceAfter, balanceVersion,
                "FULFILLMENT_HANDOVER_CORRECTION", reversalOf,
                actorUserId, actorSystemAdminId, requestId);
    }

    private void updateBalance(
            Balance balance, long nextOnHand, long nextVersion, UUID eventId) {
        int changed = jdbc.update("""
                UPDATE inventory_balances
                SET on_hand = :onHand, version = :nextVersion,
                    last_event_id = :eventId, updated_at = now()
                WHERE id = :balanceId AND version = :version
                """, new MapSqlParameterSource()
                        .addValue("onHand", nextOnHand)
                        .addValue("nextVersion", nextVersion)
                        .addValue("eventId", eventId)
                        .addValue("balanceId", balance.id())
                        .addValue("version", balance.version()));
        if (changed != 1) {
            throw new Conflict("inventory_conflict");
        }
    }

    private void insertReservationEvent(
            UUID reservationId, UUID tenantId, UUID planId, UUID lineId,
            String eventType, int quantity, UUID commandId,
            UUID shipmentEventId, UUID inventoryEventId,
            UUID actorUserId, UUID actorSystemAdminId, String requestId) {
        jdbc.update("""
                INSERT INTO tenant_inventory_reservation_events (
                    tenant_id, reservation_id, fulfillment_plan_id,
                    fulfillment_line_id, event_type, quantity, command_id,
                    shipment_event_id, inventory_event_id, actor_user_id,
                    actor_system_admin_id, request_id
                ) VALUES (
                    :tenantId, :reservationId, :planId, :lineId,
                    :eventType, :quantity, :commandId, :shipmentEventId,
                    :inventoryEventId, :actorUserId, :actorSystemAdminId,
                    :requestId
                )
                """, new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("reservationId", reservationId)
                        .addValue("planId", planId)
                        .addValue("lineId", lineId)
                        .addValue("eventType", eventType)
                        .addValue("quantity", quantity)
                        .addValue("commandId", commandId)
                        .addValue("shipmentEventId", shipmentEventId)
                        .addValue("inventoryEventId", inventoryEventId)
                        .addValue("actorUserId", actorUserId)
                        .addValue("actorSystemAdminId", actorSystemAdminId)
                        .addValue("requestId", requestId));
    }

    private void insertShipmentInventoryLink(
            UUID tenantId, UUID shipmentEventId, UUID lineId,
            UUID inventoryEventId, int quantity) {
        jdbc.update("""
                INSERT INTO tenant_shipment_inventory_events (
                    tenant_id, shipment_event_id, fulfillment_line_id,
                    inventory_event_id, quantity
                ) VALUES (
                    :tenantId, :shipmentEventId, :lineId,
                    :inventoryEventId, :quantity
                )
                """, new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("shipmentEventId", shipmentEventId)
                        .addValue("lineId", lineId)
                        .addValue("inventoryEventId", inventoryEventId)
                        .addValue("quantity", quantity));
    }

    private void requireVisible(
            UUID tenantId, UUID userId, UUID systemAdminId, UUID warehouseId) {
        scopeEvaluator.requireVisible(
                scopeEvaluator.evaluate(tenantId, userId, systemAdminId),
                warehouseId);
    }

    private static void validateChange(
            UUID tenantId, UUID commandId, UUID planId, UUID lineId,
            int quantity, UUID userId, UUID systemAdminId, String requestId) {
        if (tenantId == null || commandId == null || planId == null
                || lineId == null || quantity < 1
                || (userId == null) == (systemAdminId == null)
                || requestId == null
                || !REQUEST_ID.matcher(requestId).matches()) {
            throw new Invalid("inventoryReservation");
        }
    }

    private static long addExact(long left, long right) {
        try {
            return Math.addExact(left, right);
        } catch (ArithmeticException exception) {
            throw new Invalid("quantity");
        }
    }

    private static long subtractExact(long left, long right) {
        try {
            return Math.subtractExact(left, right);
        } catch (ArithmeticException exception) {
            throw new Invalid("quantity");
        }
    }

    private static Map<String, Object> dimensions(ReservationCommand command) {
        return Map.of(
                "tenantId", command.tenantId(),
                "skuId", command.skuId(),
                "warehouseId", command.warehouseId());
    }

    private static MapSqlParameterSource parameters(
            ReservationCommand command, String fingerprint) {
        return new MapSqlParameterSource()
                .addValue("tenantId", command.tenantId())
                .addValue("planId", command.fulfillmentPlanId())
                .addValue("lineId", command.fulfillmentLineId())
                .addValue("skuId", command.skuId())
                .addValue("warehouseId", command.warehouseId())
                .addValue("locationId", command.locationId())
                .addValue("quantity", command.quantity())
                .addValue("commandId", command.commandId())
                .addValue("fingerprint", fingerprint)
                .addValue("actorUserId", command.actorUserId())
                .addValue("actorSystemAdminId", command.actorSystemAdminId())
                .addValue("requestId", command.requestId());
    }

    private static void validate(ReservationCommand command) {
        if (command == null
                || command.tenantId() == null
                || command.commandId() == null
                || command.fulfillmentPlanId() == null
                || command.fulfillmentLineId() == null
                || command.skuId() == null
                || command.warehouseId() == null
                || command.quantity() < 1
                || (command.actorUserId() == null)
                        == (command.actorSystemAdminId() == null)
                || command.requestId() == null
                || !REQUEST_ID.matcher(command.requestId()).matches()) {
            throw new Invalid("reservation");
        }
    }

    private static String fingerprint(ReservationCommand command) {
        String value = command.tenantId() + "\n" + command.commandId() + "\n"
                + command.fulfillmentPlanId() + "\n"
                + command.fulfillmentLineId() + "\n" + command.skuId() + "\n"
                + command.warehouseId() + "\n" + command.locationId() + "\n"
                + command.quantity();
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }

    private record Existing(
            String fingerprint,
            String operationReference,
            long availableAfter) {
    }

    private record Reservation(
            UUID id,
            UUID skuId,
            UUID warehouseId,
            int quantity,
            int consumedQuantity,
            int releasedQuantity,
            long version) {
        int remaining() {
            return quantity - consumedQuantity - releasedQuantity;
        }
    }

    private record Balance(UUID id, long onHand, long version) {
    }

    private record OriginalInventoryEvent(
            UUID inventoryEventId, int quantity, long signedDelta) {
    }
}
