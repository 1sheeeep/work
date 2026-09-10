package cn.xzkj.erp.inventory.repository;

import cn.xzkj.erp.inventory.domain.InventoryEventType;
import cn.xzkj.erp.inventory.service.InventoryBalanceView;
import cn.xzkj.erp.inventory.service.InventoryBalanceSearchField;
import cn.xzkj.erp.inventory.service.InventoryEventView;
import cn.xzkj.erp.inventory.service.InventorySkuSummaryView;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.warehouse.domain.WarehouseStatus;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class InventoryStore {
    private static final String BALANCE_SELECT = """
            SELECT b.id, b.sku_id, sku.business_code AS sku_code,
                   sku.name AS sku_name, b.warehouse_id,
                   warehouse.business_code AS warehouse_code,
                   warehouse.name AS warehouse_name, b.on_hand,
                   coalesce((
                       SELECT sum(r.quantity - r.consumed_quantity - r.released_quantity)
                       FROM tenant_inventory_reservations r
                       WHERE r.tenant_id = b.tenant_id
                         AND r.sku_id = b.sku_id
                         AND r.warehouse_id = b.warehouse_id
                   ), 0) AS reserved,
                   b.version, b.updated_at
            FROM inventory_balances b
            JOIN tenant_product_skus sku
              ON sku.tenant_id = b.tenant_id AND sku.id = b.sku_id
            JOIN tenant_product_spus spu
              ON spu.tenant_id = sku.tenant_id AND spu.id = sku.spu_id
            JOIN tenant_warehouses warehouse
              ON warehouse.tenant_id = b.tenant_id
             AND warehouse.id = b.warehouse_id
            """;

    private static final String EVENT_SELECT = """
            SELECT event.id, event.ledger_sequence, event.event_type,
                   event.sku_id, sku.business_code AS sku_code,
                   sku.name AS sku_name, event.warehouse_id,
                   warehouse.business_code AS warehouse_code,
                   warehouse.name AS warehouse_name, event.signed_delta,
                   event.balance_after, event.balance_version_after,
                   event.reason, event.reversal_of_event_id,
                   event.request_id, event.recorded_at
            FROM inventory_ledger_events event
            JOIN tenant_product_skus sku
              ON sku.tenant_id = event.tenant_id
             AND sku.id = event.sku_id
            JOIN tenant_warehouses warehouse
              ON warehouse.tenant_id = event.tenant_id
             AND warehouse.id = event.warehouse_id
            """;
    private static final String SKU_SUMMARY_ALL = """
            SELECT b.sku_id,
                   sum(b.on_hand) AS on_hand,
                   sum(coalesce(r.reserved, 0)) AS reserved
            FROM inventory_balances b
            LEFT JOIN (
                SELECT tenant_id, sku_id, warehouse_id,
                       sum(quantity - consumed_quantity - released_quantity)
                           AS reserved
                FROM tenant_inventory_reservations
                WHERE tenant_id = :tenantId
                GROUP BY tenant_id, sku_id, warehouse_id
            ) r ON r.tenant_id = b.tenant_id
               AND r.sku_id = b.sku_id
               AND r.warehouse_id = b.warehouse_id
            WHERE b.tenant_id = :tenantId
              AND b.sku_id IN (:skuIds)
            GROUP BY b.sku_id
            ORDER BY b.sku_id
            """;
    private static final String SKU_SUMMARY_SCOPED = """
            SELECT b.sku_id,
                   sum(b.on_hand) AS on_hand,
                   sum(coalesce(r.reserved, 0)) AS reserved
            FROM inventory_balances b
            LEFT JOIN (
                SELECT tenant_id, sku_id, warehouse_id,
                       sum(quantity - consumed_quantity - released_quantity)
                           AS reserved
                FROM tenant_inventory_reservations
                WHERE tenant_id = :tenantId
                GROUP BY tenant_id, sku_id, warehouse_id
            ) r ON r.tenant_id = b.tenant_id
               AND r.sku_id = b.sku_id
               AND r.warehouse_id = b.warehouse_id
            WHERE b.tenant_id = :tenantId
              AND b.sku_id IN (:skuIds)
              AND b.warehouse_id IN (:warehouseScope)
            GROUP BY b.sku_id
            ORDER BY b.sku_id
            """;
    private static final String SOURCE_EVENT_SELECT = """
            SELECT event.id, event.ledger_sequence, event.event_type,
                   event.sku_id, sku.business_code AS sku_code,
                   sku.name AS sku_name, event.warehouse_id,
                   warehouse.business_code AS warehouse_code,
                   warehouse.name AS warehouse_name, event.signed_delta,
                   event.balance_after, event.balance_version_after,
                   event.reason, event.reversal_of_event_id,
                   event.request_id, event.recorded_at,
                   event.source_line_id
            FROM inventory_ledger_events event
            JOIN tenant_product_skus sku
              ON sku.tenant_id = event.tenant_id
             AND sku.id = event.sku_id
            JOIN tenant_warehouses warehouse
              ON warehouse.tenant_id = event.tenant_id
             AND warehouse.id = event.warehouse_id
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public InventoryStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Page<InventoryBalanceView> listBalances(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            UUID warehouseId,
            UUID skuId,
            String keyword,
            Pageable pageable) {
        return listBalances(
                tenantId,
                warehouseScope,
                allWarehouses,
                warehouseId,
                skuId,
                InventoryBalanceSearchField.ALL,
                keyword,
                pageable);
    }

    public Page<InventoryBalanceView> listBalances(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            UUID warehouseId,
            UUID skuId,
            InventoryBalanceSearchField searchField,
            String keyword,
            Pageable pageable) {
        return listBalances(
                tenantId,
                warehouseScope,
                allWarehouses,
                warehouseId,
                skuId,
                searchField,
                keyword,
                null,
                null,
                pageable);
    }

    public Page<InventoryBalanceView> listBalances(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            UUID warehouseId,
            UUID skuId,
            InventoryBalanceSearchField searchField,
            String keyword,
            Long onHandMin,
            Long onHandMax,
            Pageable pageable) {
        return listBalances(
                tenantId,
                warehouseScope,
                allWarehouses,
                warehouseId,
                skuId,
                searchField,
                keyword,
                onHandMin,
                onHandMax,
                null,
                null,
                pageable);
    }

    public Page<InventoryBalanceView> listBalances(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            UUID warehouseId,
            UUID skuId,
            InventoryBalanceSearchField searchField,
            String keyword,
            Long onHandMin,
            Long onHandMax,
            Instant updatedFromInclusive,
            Instant updatedBefore,
            Pageable pageable) {
        return listBalances(
                tenantId,
                warehouseScope,
                allWarehouses,
                warehouseId,
                skuId,
                null,
                searchField,
                keyword,
                onHandMin,
                onHandMax,
                updatedFromInclusive,
                updatedBefore,
                pageable);
    }

    public Page<InventoryBalanceView> listBalances(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            UUID warehouseId,
            UUID skuId,
            UUID categoryId,
            InventoryBalanceSearchField searchField,
            String keyword,
            Long onHandMin,
            Long onHandMax,
            Instant updatedFromInclusive,
            Instant updatedBefore,
            Pageable pageable) {
        String where = balanceWhere(
                warehouseScope,
                allWarehouses,
                warehouseId,
                skuId,
                categoryId,
                searchField,
                keyword,
                onHandMin,
                onHandMax,
                updatedFromInclusive,
                updatedBefore);
        MapSqlParameterSource parameters = balanceParameters(
                tenantId,
                warehouseScope,
                warehouseId,
                skuId,
                categoryId,
                searchField,
                keyword,
                onHandMin,
                onHandMax,
                updatedFromInclusive,
                updatedBefore);
        parameters.addValue("limit", pageable.getPageSize());
        parameters.addValue("offset", pageable.getOffset());
        List<InventoryBalanceView> rows = jdbc.query(
                BALANCE_SELECT + where
                        + " ORDER BY warehouse.business_code, sku.business_code, b.id"
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                InventoryStore::mapBalance);
        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM inventory_balances b"
                        + " JOIN tenant_product_skus sku"
                        + " ON sku.tenant_id = b.tenant_id AND sku.id = b.sku_id"
                        + " JOIN tenant_product_spus spu"
                        + " ON spu.tenant_id = sku.tenant_id AND spu.id = sku.spu_id"
                        + " JOIN tenant_warehouses warehouse"
                        + " ON warehouse.tenant_id = b.tenant_id"
                        + " AND warehouse.id = b.warehouse_id"
                        + where,
                parameters,
                Long.class);
        return new PageImpl<>(rows, pageable, total == null ? 0 : total);
    }

    public Optional<InventoryBalanceView> findBalance(
            UUID tenantId, UUID balanceId) {
        return optionalQuery(
                BALANCE_SELECT + " WHERE b.tenant_id = :tenantId AND b.id = :id",
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("id", balanceId),
                InventoryStore::mapBalance);
    }

    public List<InventorySkuSummaryView> listSkuSummaries(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            Set<UUID> skuIds) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("skuIds", skuIds);
        return jdbc.query(
                allWarehouses ? SKU_SUMMARY_ALL : SKU_SUMMARY_SCOPED,
                parameters,
                (resultSet, rowNumber) -> new InventorySkuSummaryView(
                        resultSet.getObject("sku_id", UUID.class),
                        resultSet.getLong("on_hand"),
                        resultSet.getLong("reserved")));
    }

    public Optional<InventoryEventView> findEvent(
            UUID tenantId, UUID eventId) {
        return optionalQuery(
                EVENT_SELECT
                        + " WHERE event.tenant_id = :tenantId"
                        + " AND event.id = :id",
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("id", eventId),
                InventoryStore::mapEvent);
    }

    public Optional<InventoryEventView> lockEvent(
            UUID tenantId, UUID eventId) {
        return optionalQuery(
                EVENT_SELECT
                        + " WHERE event.tenant_id = :tenantId"
                        + " AND event.id = :id"
                        + " FOR UPDATE OF event",
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("id", eventId),
                InventoryStore::mapEvent);
    }

    public boolean hasReversal(UUID tenantId, UUID eventId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                """
                SELECT EXISTS (
                    SELECT 1 FROM inventory_ledger_events
                    WHERE tenant_id = :tenantId
                      AND reversal_of_event_id = :eventId
                )
                """,
                Map.of("tenantId", tenantId, "eventId", eventId),
                Boolean.class));
    }

    public boolean hasOperationalSource(UUID tenantId, UUID eventId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                """
                SELECT source_type IS NOT NULL
                FROM inventory_ledger_events
                WHERE tenant_id = :tenantId
                  AND id = :eventId
                """,
                Map.of("tenantId", tenantId, "eventId", eventId),
                Boolean.class));
    }

    public List<SourceEvent> listSourceEvents(
            UUID tenantId,
            String sourceType,
            UUID sourceId,
            InventoryEventType eventType,
            boolean forUpdate) {
        return jdbc.query(
                SOURCE_EVENT_SELECT
                        + " WHERE event.tenant_id = :tenantId"
                        + " AND event.source_type = :sourceType"
                        + " AND event.source_id = :sourceId"
                        + (eventType == null
                                ? ""
                                : " AND event.event_type = :eventType")
                        + (forUpdate
                                ? " ORDER BY event.sku_id,"
                                  + " event.warehouse_id, event.id"
                                : " ORDER BY event.ledger_sequence,"
                                  + " event.id")
                        + (forUpdate ? " FOR UPDATE OF event" : ""),
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("sourceType", sourceType)
                        .addValue("sourceId", sourceId)
                        .addValue(
                                "eventType",
                                eventType == null ? null : eventType.name()),
                InventoryStore::mapSourceEvent);
    }

    public void lockIdempotency(
            UUID tenantId, String operation, String idempotencyKey) {
        String lockValue = tenantId + ":" + operation + ":" + idempotencyKey;
        jdbc.queryForObject(
                "SELECT pg_advisory_xact_lock(hashtextextended(:value, 0))",
                Map.of("value", lockValue),
                Object.class);
    }

    public Optional<IdempotencyRecord> findIdempotency(
            UUID tenantId, String operation, String idempotencyKey) {
        return optionalQuery(
                """
                SELECT request_fingerprint, result_event_id
                FROM inventory_command_idempotency
                WHERE tenant_id = :tenantId
                  AND operation = :operation
                  AND idempotency_key = :idempotencyKey
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("operation", operation)
                        .addValue("idempotencyKey", idempotencyKey),
                (resultSet, rowNumber) -> new IdempotencyRecord(
                        resultSet.getString("request_fingerprint"),
                        resultSet.getObject("result_event_id", UUID.class)));
    }

    public MasterDataState lockMasterData(
            UUID tenantId, UUID skuId, UUID warehouseId) {
        try {
            return jdbc.queryForObject(
                    """
                    SELECT sku.status AS sku_status,
                           warehouse.status AS warehouse_status
                    FROM tenant_product_skus sku
                    JOIN tenant_warehouses warehouse
                      ON warehouse.tenant_id = sku.tenant_id
                    WHERE sku.tenant_id = :tenantId
                      AND sku.id = :skuId
                      AND warehouse.id = :warehouseId
                    FOR UPDATE OF sku, warehouse
                    """,
                    new MapSqlParameterSource()
                            .addValue("tenantId", tenantId)
                            .addValue("skuId", skuId)
                            .addValue("warehouseId", warehouseId),
                    (resultSet, rowNumber) -> new MasterDataState(
                            ProductStatus.valueOf(resultSet.getString("sku_status")),
                            WarehouseStatus.valueOf(
                                    resultSet.getString("warehouse_status"))));
        } catch (EmptyResultDataAccessException exception) {
            return null;
        }
    }

    public BalanceState lockBalance(
            UUID tenantId, UUID skuId, UUID warehouseId) {
        jdbc.update(
                """
                INSERT INTO inventory_balances (
                    tenant_id, sku_id, warehouse_id
                ) VALUES (
                    :tenantId, :skuId, :warehouseId
                )
                ON CONFLICT (tenant_id, sku_id, warehouse_id) DO NOTHING
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("skuId", skuId)
                        .addValue("warehouseId", warehouseId));
        return jdbc.queryForObject(
                """
                SELECT id, on_hand, version
                FROM inventory_balances
                WHERE tenant_id = :tenantId
                  AND sku_id = :skuId
                  AND warehouse_id = :warehouseId
                FOR UPDATE
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("skuId", skuId)
                        .addValue("warehouseId", warehouseId),
                (resultSet, rowNumber) -> new BalanceState(
                        resultSet.getObject("id", UUID.class),
                        resultSet.getLong("on_hand"),
                        resultSet.getLong("version")));
    }

    public InventoryEventView insertEvent(
            UUID eventId,
            UUID tenantId,
            InventoryEventType eventType,
            UUID skuId,
            UUID warehouseId,
            long delta,
            long balanceAfter,
            long balanceVersionAfter,
            String reason,
            String note,
            UUID reversalOfEventId,
            UUID actorUserId,
            UUID actorSystemAdminId,
            String requestId) {
        return jdbc.queryForObject(
                """
                WITH inserted AS (
                    INSERT INTO inventory_ledger_events (
                        id, tenant_id, event_type, sku_id, warehouse_id,
                        signed_delta, balance_after, balance_version_after,
                        reason, note, reversal_of_event_id, actor_user_id,
                        actor_system_admin_id, request_id
                    ) VALUES (
                        :id, :tenantId, :eventType, :skuId, :warehouseId,
                        :delta, :balanceAfter, :balanceVersionAfter,
                        :reason, :note, :reversalOfEventId, :actorUserId,
                        :actorSystemAdminId, :requestId
                    )
                    RETURNING *
                )
                SELECT inserted.id, inserted.ledger_sequence,
                       inserted.event_type, inserted.sku_id,
                       sku.business_code AS sku_code, sku.name AS sku_name,
                       inserted.warehouse_id,
                       warehouse.business_code AS warehouse_code,
                       warehouse.name AS warehouse_name,
                       inserted.signed_delta, inserted.balance_after,
                       inserted.balance_version_after, inserted.reason,
                       inserted.reversal_of_event_id, inserted.request_id,
                       inserted.recorded_at
                FROM inserted
                JOIN tenant_product_skus sku
                  ON sku.tenant_id = inserted.tenant_id
                 AND sku.id = inserted.sku_id
                JOIN tenant_warehouses warehouse
                  ON warehouse.tenant_id = inserted.tenant_id
                 AND warehouse.id = inserted.warehouse_id
                """,
                new MapSqlParameterSource()
                        .addValue("id", eventId)
                        .addValue("tenantId", tenantId)
                        .addValue("eventType", eventType.name())
                        .addValue("skuId", skuId)
                        .addValue("warehouseId", warehouseId)
                        .addValue("delta", delta)
                        .addValue("balanceAfter", balanceAfter)
                        .addValue("balanceVersionAfter", balanceVersionAfter)
                        .addValue("reason", reason)
                        .addValue("note", note)
                        .addValue("reversalOfEventId", reversalOfEventId)
                        .addValue("actorUserId", actorUserId)
                        .addValue("actorSystemAdminId", actorSystemAdminId)
                        .addValue("requestId", requestId),
                InventoryStore::mapEvent);
    }

    public InventoryEventView insertOperationalEvent(
            UUID eventId,
            UUID tenantId,
            InventoryEventType eventType,
            UUID skuId,
            UUID warehouseId,
            long delta,
            long balanceAfter,
            long balanceVersionAfter,
            String reason,
            String sourceType,
            UUID sourceId,
            UUID sourceLineId,
            UUID reversalOfEventId,
            UUID actorUserId,
            UUID actorSystemAdminId,
            String requestId) {
        return jdbc.queryForObject(
                """
                WITH inserted AS (
                    INSERT INTO inventory_ledger_events (
                        id, tenant_id, event_type, sku_id, warehouse_id,
                        signed_delta, balance_after, balance_version_after,
                        reason, source_type, source_id, source_line_id,
                        reversal_of_event_id,
                        actor_user_id, actor_system_admin_id, request_id
                    ) VALUES (
                        :id, :tenantId, :eventType, :skuId, :warehouseId,
                        :delta, :balanceAfter, :balanceVersionAfter,
                        :reason, :sourceType, :sourceId, :sourceLineId,
                        :reversalOfEventId,
                        :actorUserId, :actorSystemAdminId, :requestId
                    )
                    RETURNING *
                )
                SELECT inserted.id, inserted.ledger_sequence,
                       inserted.event_type, inserted.sku_id,
                       sku.business_code AS sku_code, sku.name AS sku_name,
                       inserted.warehouse_id,
                       warehouse.business_code AS warehouse_code,
                       warehouse.name AS warehouse_name,
                       inserted.signed_delta, inserted.balance_after,
                       inserted.balance_version_after, inserted.reason,
                       inserted.reversal_of_event_id, inserted.request_id,
                       inserted.recorded_at
                FROM inserted
                JOIN tenant_product_skus sku
                  ON sku.tenant_id = inserted.tenant_id
                 AND sku.id = inserted.sku_id
                JOIN tenant_warehouses warehouse
                  ON warehouse.tenant_id = inserted.tenant_id
                 AND warehouse.id = inserted.warehouse_id
                """,
                new MapSqlParameterSource()
                        .addValue("id", eventId)
                        .addValue("tenantId", tenantId)
                        .addValue("eventType", eventType.name())
                        .addValue("skuId", skuId)
                        .addValue("warehouseId", warehouseId)
                        .addValue("delta", delta)
                        .addValue("balanceAfter", balanceAfter)
                        .addValue("balanceVersionAfter", balanceVersionAfter)
                        .addValue("reason", reason)
                        .addValue("sourceType", sourceType)
                        .addValue("sourceId", sourceId)
                        .addValue("sourceLineId", sourceLineId)
                        .addValue("reversalOfEventId", reversalOfEventId)
                        .addValue("actorUserId", actorUserId)
                        .addValue("actorSystemAdminId", actorSystemAdminId)
                        .addValue("requestId", requestId),
                InventoryStore::mapEvent);
    }

    public void updateBalance(
            UUID balanceId,
            long expectedVersion,
            long onHand,
            long newVersion,
            UUID eventId) {
        int updated = jdbc.update(
                """
                UPDATE inventory_balances
                SET on_hand = :onHand,
                    version = :newVersion,
                    last_event_id = :eventId,
                    updated_at = now()
                WHERE id = :balanceId AND version = :expectedVersion
                """,
                new MapSqlParameterSource()
                        .addValue("onHand", onHand)
                        .addValue("newVersion", newVersion)
                        .addValue("eventId", eventId)
                        .addValue("balanceId", balanceId)
                        .addValue("expectedVersion", expectedVersion));
        if (updated != 1) {
            throw new IllegalStateException("Inventory balance update lost its lock");
        }
    }

    public void insertIdempotency(
            UUID tenantId,
            String operation,
            String idempotencyKey,
            String fingerprint,
            UUID resultEventId) {
        jdbc.update(
                """
                INSERT INTO inventory_command_idempotency (
                    tenant_id, operation, idempotency_key,
                    request_fingerprint, result_event_id
                ) VALUES (
                    :tenantId, :operation, :idempotencyKey,
                    :fingerprint, :resultEventId
                )
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("operation", operation)
                        .addValue("idempotencyKey", idempotencyKey)
                        .addValue("fingerprint", fingerprint)
                        .addValue("resultEventId", resultEventId));
    }

    public boolean hasNonZeroBalanceForSku(UUID tenantId, UUID skuId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                """
                SELECT EXISTS (
                    SELECT 1 FROM inventory_balances
                    WHERE tenant_id = :tenantId
                      AND sku_id = :skuId
                      AND on_hand <> 0
                )
                """,
                Map.of("tenantId", tenantId, "skuId", skuId),
                Boolean.class));
    }

    public boolean hasNonZeroBalanceForWarehouse(
            UUID tenantId, UUID warehouseId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                """
                SELECT EXISTS (
                    SELECT 1 FROM inventory_balances
                    WHERE tenant_id = :tenantId
                      AND warehouse_id = :warehouseId
                      AND on_hand <> 0
                )
                """,
                Map.of("tenantId", tenantId, "warehouseId", warehouseId),
                Boolean.class));
    }

    private static String balanceWhere(
            Set<UUID> scope,
            boolean all,
            UUID warehouseId,
            UUID skuId,
            UUID categoryId,
            InventoryBalanceSearchField searchField,
            String keyword,
            Long onHandMin,
            Long onHandMax,
            Instant updatedFromInclusive,
            Instant updatedBefore) {
        StringBuilder where = new StringBuilder(" WHERE b.tenant_id = :tenantId");
        if (!all) {
            where.append(" AND b.warehouse_id IN (:warehouseScope)");
        }
        if (warehouseId != null) {
            where.append(" AND b.warehouse_id = :warehouseId");
        }
        if (skuId != null) {
            where.append(" AND b.sku_id = :skuId");
        }
        if (categoryId != null) {
            where.append(" AND spu.category_id = :categoryId");
        }
        if (onHandMin != null) {
            where.append(" AND b.on_hand >= :onHandMin");
        }
        if (onHandMax != null) {
            where.append(" AND b.on_hand <= :onHandMax");
        }
        if (updatedFromInclusive != null) {
            where.append(" AND b.updated_at >= :updatedFromInclusive");
        }
        if (updatedBefore != null) {
            where.append(" AND b.updated_at < :updatedBefore");
        }
        if (keyword != null) {
            where.append("""
                     AND (
                         (:searchField = 'ALL' AND (
                             lower(sku.business_code) LIKE :keyword
                             OR lower(sku.name) LIKE :keyword
                             OR lower(coalesce(sku.name_en, '')) LIKE :keyword
                             OR lower(spu.business_code) LIKE :keyword
                         ))
                         OR (
                             :searchField = 'MASTER_SKU'
                             AND lower(spu.business_code) LIKE :keyword
                         )
                         OR (
                             :searchField = 'NAME_ZH'
                             AND lower(sku.name) LIKE :keyword
                         )
                         OR (
                             :searchField = 'NAME_EN'
                             AND lower(coalesce(sku.name_en, '')) LIKE :keyword
                         )
                         OR (
                             :searchField = 'INVENTORY_SKU'
                             AND lower(sku.business_code) LIKE :keyword
                         )
                     )
                    """);
        }
        return where.toString();
    }

    private static MapSqlParameterSource balanceParameters(
            UUID tenantId,
            Set<UUID> scope,
            UUID warehouseId,
            UUID skuId,
            UUID categoryId,
            InventoryBalanceSearchField searchField,
            String keyword,
            Long onHandMin,
            Long onHandMax,
            Instant updatedFromInclusive,
            Instant updatedBefore) {
        MapSqlParameterSource parameters =
                new MapSqlParameterSource("tenantId", tenantId);
        parameters.addValue("warehouseScope", scope);
        parameters.addValue("warehouseId", warehouseId);
        parameters.addValue("skuId", skuId);
        parameters.addValue("categoryId", categoryId);
        parameters.addValue("searchField", searchField.name());
        parameters.addValue("onHandMin", onHandMin);
        parameters.addValue("onHandMax", onHandMax);
        parameters.addValue(
                "updatedFromInclusive",
                updatedFromInclusive == null
                        ? null
                        : OffsetDateTime.ofInstant(
                                updatedFromInclusive, ZoneOffset.UTC));
        parameters.addValue(
                "updatedBefore",
                updatedBefore == null
                        ? null
                        : OffsetDateTime.ofInstant(
                                updatedBefore, ZoneOffset.UTC));
        parameters.addValue(
                "keyword", keyword == null ? null : "%" + keyword + "%");
        return parameters;
    }

    private static InventoryBalanceView mapBalance(
            ResultSet resultSet, int rowNumber) throws SQLException {
        return new InventoryBalanceView(
                resultSet.getObject("id", UUID.class),
                resultSet.getObject("sku_id", UUID.class),
                resultSet.getString("sku_code"),
                resultSet.getString("sku_name"),
                resultSet.getObject("warehouse_id", UUID.class),
                resultSet.getString("warehouse_code"),
                resultSet.getString("warehouse_name"),
                resultSet.getLong("on_hand"),
                resultSet.getLong("reserved"),
                resultSet.getLong("version"),
                resultSet.getObject(
                                "updated_at", java.time.OffsetDateTime.class)
                        .toInstant());
    }

    private static InventoryEventView mapEvent(
            ResultSet resultSet, int rowNumber) throws SQLException {
        return new InventoryEventView(
                resultSet.getObject("id", UUID.class),
                resultSet.getLong("ledger_sequence"),
                InventoryEventType.valueOf(resultSet.getString("event_type")),
                resultSet.getObject("sku_id", UUID.class),
                resultSet.getString("sku_code"),
                resultSet.getString("sku_name"),
                resultSet.getObject("warehouse_id", UUID.class),
                resultSet.getString("warehouse_code"),
                resultSet.getString("warehouse_name"),
                resultSet.getLong("signed_delta"),
                resultSet.getLong("balance_after"),
                resultSet.getLong("balance_version_after"),
                resultSet.getString("reason"),
                resultSet.getObject("reversal_of_event_id", UUID.class),
                resultSet.getString("request_id"),
                resultSet.getObject(
                                "recorded_at", java.time.OffsetDateTime.class)
                        .toInstant());
    }

    private static SourceEvent mapSourceEvent(
            ResultSet resultSet, int rowNumber) throws SQLException {
        return new SourceEvent(
                mapEvent(resultSet, rowNumber),
                resultSet.getObject("source_line_id", UUID.class));
    }

    private <T> Optional<T> optionalQuery(
            String sql,
            MapSqlParameterSource parameters,
            org.springframework.jdbc.core.RowMapper<T> mapper) {
        try {
            return Optional.ofNullable(jdbc.queryForObject(sql, parameters, mapper));
        } catch (EmptyResultDataAccessException exception) {
            return Optional.empty();
        }
    }

    public record BalanceState(UUID id, long onHand, long version) {
    }

    public record IdempotencyRecord(String fingerprint, UUID resultEventId) {
    }

    public record SourceEvent(
            InventoryEventView event,
            UUID sourceLineId) {
    }

    public record MasterDataState(
            ProductStatus skuStatus,
            WarehouseStatus warehouseStatus) {
    }
}
