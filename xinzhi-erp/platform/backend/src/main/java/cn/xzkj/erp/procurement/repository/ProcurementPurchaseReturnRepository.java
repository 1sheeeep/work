package cn.xzkj.erp.procurement.repository;

import cn.xzkj.erp.procurement.domain.ProcurementReturnSearchField;
import cn.xzkj.erp.procurement.service.ProcurementPurchaseReturnView;
import cn.xzkj.erp.procurement.service.ProcurementReturnableOrderView;
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
public class ProcurementPurchaseReturnRepository {
    private static final String RETURN_SELECT = """
            SELECT purchase_return.id, purchase_return.return_no,
                   purchase_return.purchase_order_id,
                   purchase_order.purchase_no,
                   purchase_order.plan_no_snapshot,
                   purchase_order.supplier_id,
                   purchase_order.supplier_code_snapshot,
                   purchase_order.supplier_name_snapshot,
                   purchase_order.sku_id,
                   purchase_order.sku_code_snapshot,
                   purchase_order.sku_name_snapshot,
                   purchase_order.sku_variant_snapshot,
                   purchase_order.warehouse_id,
                   purchase_order.warehouse_code_snapshot,
                   purchase_order.warehouse_name_snapshot,
                   purchase_order.location_id,
                   purchase_order.location_code_snapshot,
                   purchase_order.location_name_snapshot,
                   purchase_return.quantity, purchase_return.reason,
                   purchase_return.inventory_event_id,
                   inventory_event.ledger_sequence,
                   inventory_event.balance_after,
                   purchase_return.returned_by_display_name,
                   purchase_return.returned_at
            FROM procurement_purchase_returns purchase_return
            JOIN procurement_purchase_orders purchase_order
              ON purchase_order.tenant_id = purchase_return.tenant_id
             AND purchase_order.id = purchase_return.purchase_order_id
            JOIN inventory_ledger_events inventory_event
              ON inventory_event.tenant_id = purchase_return.tenant_id
             AND inventory_event.id = purchase_return.inventory_event_id
            """;

    private static final String RETURNABLE_SELECT = """
            SELECT purchase_order.id, purchase_order.purchase_no,
                   purchase_order.supplier_code_snapshot,
                   purchase_order.supplier_name_snapshot,
                   purchase_order.sku_id,
                   purchase_order.sku_code_snapshot,
                   purchase_order.sku_name_snapshot,
                   purchase_order.sku_variant_snapshot,
                   purchase_order.warehouse_id,
                   purchase_order.warehouse_code_snapshot,
                   purchase_order.warehouse_name_snapshot,
                   purchase_order.location_id,
                   purchase_order.location_code_snapshot,
                   purchase_order.location_name_snapshot,
                   purchase_order.received_quantity,
                   purchase_order.returned_quantity,
                   purchase_order.received_quantity
                       - purchase_order.returned_quantity AS returnable_quantity,
                   purchase_order.version
            FROM procurement_purchase_orders purchase_order
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public ProcurementPurchaseReturnRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Page<ProcurementPurchaseReturnView> list(
            UUID tenantId, Set<UUID> warehouseScope, boolean allWarehouses,
            ProcurementReturnSearchField searchField, String keyword,
            Instant returnedFrom, Instant returnedTo, Pageable pageable) {
        String where = returnWhere(
                allWarehouses, searchField, keyword, returnedFrom, returnedTo);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("keyword", keyword)
                .addValue("returnedFrom", returnedFrom)
                .addValue("returnedTo", returnedTo)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<ProcurementPurchaseReturnView> rows = jdbc.query(
                RETURN_SELECT + where
                        + " ORDER BY purchase_return.returned_at DESC,"
                        + " purchase_return.id DESC LIMIT :limit OFFSET :offset",
                parameters, ProcurementPurchaseReturnRepository::mapReturn);
        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM procurement_purchase_returns purchase_return"
                        + " JOIN procurement_purchase_orders purchase_order"
                        + " ON purchase_order.tenant_id = purchase_return.tenant_id"
                        + " AND purchase_order.id = purchase_return.purchase_order_id"
                        + where,
                parameters, Long.class);
        return new PageImpl<>(rows, pageable, total == null ? 0 : total);
    }

    public Page<ProcurementReturnableOrderView> listReturnableOrders(
            UUID tenantId, Set<UUID> warehouseScope, boolean allWarehouses,
            String keyword, Pageable pageable) {
        String where = " WHERE purchase_order.tenant_id = :tenantId"
                + (allWarehouses ? "" :
                        " AND purchase_order.warehouse_id IN (:warehouseScope)")
                + " AND purchase_order.received_quantity"
                + " > purchase_order.returned_quantity"
                + (keyword == null ? "" :
                        " AND (lower(purchase_order.purchase_no)"
                        + " LIKE '%' || :keyword || '%'"
                        + " OR lower(purchase_order.sku_code_snapshot)"
                        + " LIKE '%' || :keyword || '%'"
                        + " OR lower(purchase_order.sku_name_snapshot)"
                        + " LIKE '%' || :keyword || '%')");
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("keyword", keyword)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<ProcurementReturnableOrderView> rows = jdbc.query(
                RETURNABLE_SELECT + where
                        + " ORDER BY purchase_order.last_received_at DESC NULLS LAST,"
                        + " purchase_order.id DESC LIMIT :limit OFFSET :offset",
                parameters, ProcurementPurchaseReturnRepository::mapReturnable);
        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM procurement_purchase_orders purchase_order"
                        + where,
                parameters, Long.class);
        return new PageImpl<>(rows, pageable, total == null ? 0 : total);
    }

    public Optional<ProcurementReturnableOrderView> lockReturnableOrder(
            UUID tenantId, UUID purchaseOrderId) {
        return optionalQuery(
                RETURNABLE_SELECT
                        + " WHERE purchase_order.tenant_id = :tenantId"
                        + " AND purchase_order.id = :purchaseOrderId"
                        + " FOR UPDATE OF purchase_order",
                Map.of("tenantId", tenantId, "purchaseOrderId", purchaseOrderId),
                ProcurementPurchaseReturnRepository::mapReturnable);
    }

    public Optional<ProcurementPurchaseReturnView> find(
            UUID tenantId, UUID purchaseReturnId) {
        return optionalQuery(
                RETURN_SELECT
                        + " WHERE purchase_return.tenant_id = :tenantId"
                        + " AND purchase_return.id = :purchaseReturnId",
                Map.of("tenantId", tenantId, "purchaseReturnId", purchaseReturnId),
                ProcurementPurchaseReturnRepository::mapReturn);
    }

    public void lockCommand(UUID tenantId, UUID commandId) {
        jdbc.queryForObject(
                "SELECT pg_advisory_xact_lock(hashtextextended(:value, 0))",
                Map.of("value", tenantId + ":procurement-return:" + commandId),
                Object.class);
    }

    public Optional<ReturnCommandRecord> findCommand(
            UUID tenantId, UUID commandId) {
        return optionalQuery(
                """
                SELECT purchase_return_id, request_fingerprint
                FROM procurement_purchase_return_commands
                WHERE tenant_id = :tenantId AND command_id = :commandId
                """,
                Map.of("tenantId", tenantId, "commandId", commandId),
                (resultSet, rowNumber) -> new ReturnCommandRecord(
                        resultSet.getObject(1, UUID.class),
                        resultSet.getString(2)));
    }

    public void insert(
            UUID id, UUID tenantId, String returnNo, UUID purchaseOrderId,
            long quantity, String reason, UUID inventoryEventId,
            String actorDisplayName, UUID actorUserId, UUID actorSystemAdminId,
            String requestId) {
        jdbc.update(
                """
                INSERT INTO procurement_purchase_returns (
                    id, tenant_id, return_no, purchase_order_id, quantity,
                    reason, inventory_event_id, returned_by_display_name,
                    returned_by_user_id, returned_by_system_admin_id, request_id
                ) VALUES (
                    :id, :tenantId, :returnNo, :purchaseOrderId, :quantity,
                    :reason, :inventoryEventId, :actorDisplayName,
                    :actorUserId, :actorSystemAdminId, :requestId
                )
                """,
                new MapSqlParameterSource()
                        .addValue("id", id).addValue("tenantId", tenantId)
                        .addValue("returnNo", returnNo)
                        .addValue("purchaseOrderId", purchaseOrderId)
                        .addValue("quantity", quantity).addValue("reason", reason)
                        .addValue("inventoryEventId", inventoryEventId)
                        .addValue("actorDisplayName", actorDisplayName)
                        .addValue("actorUserId", actorUserId)
                        .addValue("actorSystemAdminId", actorSystemAdminId)
                        .addValue("requestId", requestId));
    }

    public int markReturned(
            UUID tenantId, UUID purchaseOrderId, long expectedVersion,
            long quantity) {
        return jdbc.update(
                """
                UPDATE procurement_purchase_orders
                SET returned_quantity = returned_quantity + :quantity,
                    last_returned_at = now(), version = version + 1,
                    updated_at = now()
                WHERE tenant_id = :tenantId AND id = :purchaseOrderId
                  AND version = :expectedVersion
                  AND received_quantity - returned_quantity >= :quantity
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("purchaseOrderId", purchaseOrderId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("quantity", quantity));
    }

    public void insertCommand(
            UUID tenantId, UUID commandId, UUID purchaseReturnId,
            String fingerprint) {
        jdbc.update(
                """
                INSERT INTO procurement_purchase_return_commands (
                    tenant_id, command_id, purchase_return_id,
                    request_fingerprint
                ) VALUES (
                    :tenantId, :commandId, :purchaseReturnId, :fingerprint
                )
                """,
                Map.of(
                        "tenantId", tenantId, "commandId", commandId,
                        "purchaseReturnId", purchaseReturnId,
                        "fingerprint", fingerprint));
    }

    private static String returnWhere(
            boolean allWarehouses, ProcurementReturnSearchField searchField,
            String keyword, Instant returnedFrom, Instant returnedTo) {
        StringBuilder where = new StringBuilder(
                " WHERE purchase_return.tenant_id = :tenantId");
        if (!allWarehouses) {
            where.append(" AND purchase_order.warehouse_id IN (:warehouseScope)");
        }
        if (keyword != null) {
            where.append(" AND lower(").append(switch (searchField) {
                case RETURN_NO -> "purchase_return.return_no";
                case PURCHASE_NO -> "purchase_order.purchase_no";
                case SKU_CODE -> "purchase_order.sku_code_snapshot";
                case SKU_NAME -> "purchase_order.sku_name_snapshot";
                case SUPPLIER_NAME -> "purchase_order.supplier_name_snapshot";
                case RETURNED_BY -> "purchase_return.returned_by_display_name";
            }).append(") LIKE '%' || :keyword || '%'");
        }
        if (returnedFrom != null) {
            where.append(" AND purchase_return.returned_at >= :returnedFrom");
        }
        if (returnedTo != null) {
            where.append(" AND purchase_return.returned_at <= :returnedTo");
        }
        return where.toString();
    }

    private static ProcurementPurchaseReturnView mapReturn(
            ResultSet resultSet, int rowNumber) throws SQLException {
        return new ProcurementPurchaseReturnView(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("return_no"),
                resultSet.getObject("purchase_order_id", UUID.class),
                resultSet.getString("purchase_no"),
                resultSet.getString("plan_no_snapshot"),
                resultSet.getObject("supplier_id", UUID.class),
                resultSet.getString("supplier_code_snapshot"),
                resultSet.getString("supplier_name_snapshot"),
                resultSet.getObject("sku_id", UUID.class),
                resultSet.getString("sku_code_snapshot"),
                resultSet.getString("sku_name_snapshot"),
                resultSet.getString("sku_variant_snapshot"),
                resultSet.getObject("warehouse_id", UUID.class),
                resultSet.getString("warehouse_code_snapshot"),
                resultSet.getString("warehouse_name_snapshot"),
                resultSet.getObject("location_id", UUID.class),
                resultSet.getString("location_code_snapshot"),
                resultSet.getString("location_name_snapshot"),
                resultSet.getLong("quantity"), resultSet.getString("reason"),
                resultSet.getObject("inventory_event_id", UUID.class),
                resultSet.getLong("ledger_sequence"),
                resultSet.getLong("balance_after"),
                resultSet.getString("returned_by_display_name"),
                instant(resultSet, "returned_at"));
    }

    private static ProcurementReturnableOrderView mapReturnable(
            ResultSet resultSet, int rowNumber) throws SQLException {
        return new ProcurementReturnableOrderView(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("purchase_no"),
                resultSet.getString("supplier_code_snapshot"),
                resultSet.getString("supplier_name_snapshot"),
                resultSet.getObject("sku_id", UUID.class),
                resultSet.getString("sku_code_snapshot"),
                resultSet.getString("sku_name_snapshot"),
                resultSet.getString("sku_variant_snapshot"),
                resultSet.getObject("warehouse_id", UUID.class),
                resultSet.getString("warehouse_code_snapshot"),
                resultSet.getString("warehouse_name_snapshot"),
                resultSet.getObject("location_id", UUID.class),
                resultSet.getString("location_code_snapshot"),
                resultSet.getString("location_name_snapshot"),
                resultSet.getLong("received_quantity"),
                resultSet.getLong("returned_quantity"),
                resultSet.getLong("returnable_quantity"),
                resultSet.getLong("version"));
    }

    private static Instant instant(ResultSet resultSet, String column)
            throws SQLException {
        return resultSet.getObject(column, OffsetDateTime.class)
                .withOffsetSameInstant(ZoneOffset.UTC).toInstant();
    }

    private <T> Optional<T> optionalQuery(
            String sql, Object parameters,
            org.springframework.jdbc.core.RowMapper<T> mapper) {
        try {
            T result;
            if (parameters instanceof MapSqlParameterSource source) {
                result = jdbc.queryForObject(sql, source, mapper);
            } else {
                @SuppressWarnings("unchecked")
                Map<String, ?> values = (Map<String, ?>) parameters;
                result = jdbc.queryForObject(sql, values, mapper);
            }
            return Optional.ofNullable(result);
        } catch (EmptyResultDataAccessException exception) {
            return Optional.empty();
        }
    }

    public record ReturnCommandRecord(
            UUID purchaseReturnId, String fingerprint) {
    }
}
