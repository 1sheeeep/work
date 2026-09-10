package cn.xzkj.erp.inventory.repository;

import cn.xzkj.erp.inventory.domain.WarehouseTransferAllocationMethod;
import cn.xzkj.erp.inventory.domain.WarehouseTransferStatus;
import cn.xzkj.erp.inventory.domain.WarehouseTransferTransportMode;
import cn.xzkj.erp.inventory.service.WarehouseTransferDetail;
import cn.xzkj.erp.inventory.service.WarehouseTransferLineView;
import cn.xzkj.erp.inventory.service.WarehouseTransferSearchField;
import cn.xzkj.erp.inventory.service.WarehouseTransferSummary;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
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
public class WarehouseTransferRepository {
    private static final String SUMMARY_SELECT = """
            SELECT transfer.id, transfer.transfer_no, transfer.status,
                   transfer.transfer_date, transfer.source_warehouse_id,
                   source.business_code AS source_warehouse_code,
                   source.name AS source_warehouse_name,
                   transfer.target_warehouse_id,
                   target.business_code AS target_warehouse_code,
                   target.name AS target_warehouse_name,
                   transfer.transport_mode, transfer.freight_amount_minor,
                   transfer.currency_code, transfer.logistics_channel,
                   transfer.tracking_no, transfer.allocation_method,
                   transfer.expected_ship_at, transfer.expected_arrival_at,
                   transfer.note, transfer.version,
                   transfer.operator_display_name,
                   transfer.approver_display_name,
                   transfer.shipper_display_name,
                   transfer.receiver_display_name,
                   transfer.created_at, transfer.updated_at,
                   count(line.id) AS line_count,
                   coalesce(sum(line.quantity), 0) AS total_quantity
            FROM inventory_warehouse_transfers transfer
            JOIN tenant_warehouses source
              ON source.tenant_id = transfer.tenant_id
             AND source.id = transfer.source_warehouse_id
            JOIN tenant_warehouses target
              ON target.tenant_id = transfer.tenant_id
             AND target.id = transfer.target_warehouse_id
            LEFT JOIN inventory_warehouse_transfer_lines line
              ON line.tenant_id = transfer.tenant_id
             AND line.transfer_id = transfer.id
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public WarehouseTransferRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Page<WarehouseTransferSummary> list(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            UUID sourceWarehouseId,
            UUID targetWarehouseId,
            List<WarehouseTransferStatus> statuses,
            WarehouseTransferTransportMode transportMode,
            WarehouseTransferSearchField searchField,
            String keyword,
            LocalDate from,
            LocalDate to,
            Pageable pageable) {
        String where = where(
                allWarehouses, sourceWarehouseId, targetWarehouseId,
                statuses, transportMode, searchField, keyword, from, to);
        String group = """
                 GROUP BY transfer.id, source.business_code, source.name,
                          target.business_code, target.name
                """;
        MapSqlParameterSource parameters = parameters(
                tenantId, warehouseScope, sourceWarehouseId,
                targetWarehouseId, statuses, transportMode, keyword, from, to)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<WarehouseTransferSummary> rows = jdbc.query(
                SUMMARY_SELECT + where + group
                        + " ORDER BY transfer.transfer_date DESC,"
                        + " transfer.created_at DESC, transfer.id"
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                WarehouseTransferRepository::mapSummary);
        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM (" + SUMMARY_SELECT + where + group
                        + ") transfers",
                parameters,
                Long.class);
        return new PageImpl<>(rows, pageable, total == null ? 0 : total);
    }

    public Optional<WarehouseTransferDetail> find(
            UUID tenantId, UUID transferId) {
        Optional<WarehouseTransferSummary> summary = optionalQuery(
                SUMMARY_SELECT
                        + " WHERE transfer.tenant_id = :tenantId"
                        + " AND transfer.id = :transferId"
                        + " GROUP BY transfer.id, source.business_code,"
                        + " source.name, target.business_code, target.name",
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("transferId", transferId),
                WarehouseTransferRepository::mapSummary);
        return summary.map(value -> new WarehouseTransferDetail(
                value, listLines(tenantId, transferId)));
    }

    public Optional<WarehouseTransferSummary> lock(
            UUID tenantId, UUID transferId) {
        jdbc.query(
                "SELECT id FROM inventory_warehouse_transfers"
                        + " WHERE tenant_id = :tenantId AND id = :transferId"
                        + " FOR UPDATE",
                Map.of("tenantId", tenantId, "transferId", transferId),
                (resultSet, rowNumber) -> resultSet.getObject(1, UUID.class));
        return find(tenantId, transferId).map(WarehouseTransferDetail::summary);
    }

    public void insertTransfer(
            UUID id,
            UUID tenantId,
            String transferNo,
            LocalDate transferDate,
            UUID sourceWarehouseId,
            UUID targetWarehouseId,
            WarehouseTransferTransportMode transportMode,
            Long freightAmountMinor,
            String currencyCode,
            String logisticsChannel,
            String trackingNo,
            WarehouseTransferAllocationMethod allocationMethod,
            Instant expectedShipAt,
            Instant expectedArrivalAt,
            String note,
            String operatorDisplayName,
            UUID actorUserId,
            UUID actorSystemAdminId) {
        jdbc.update(
                """
                INSERT INTO inventory_warehouse_transfers (
                    id, tenant_id, transfer_no, transfer_date,
                    source_warehouse_id, target_warehouse_id,
                    transport_mode, freight_amount_minor, currency_code,
                    logistics_channel, tracking_no, allocation_method,
                    expected_ship_at, expected_arrival_at, note,
                    operator_display_name, created_by_user_id,
                    created_by_system_admin_id
                ) VALUES (
                    :id, :tenantId, :transferNo, :transferDate,
                    :sourceWarehouseId, :targetWarehouseId,
                    :transportMode, :freightAmountMinor, :currencyCode,
                    :logisticsChannel, :trackingNo, :allocationMethod,
                    :expectedShipAt, :expectedArrivalAt, :note,
                    :operatorDisplayName, :actorUserId,
                    :actorSystemAdminId
                )
                """,
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("tenantId", tenantId)
                        .addValue("transferNo", transferNo)
                        .addValue("transferDate", transferDate)
                        .addValue("sourceWarehouseId", sourceWarehouseId)
                        .addValue("targetWarehouseId", targetWarehouseId)
                        .addValue("transportMode", transportMode.name())
                        .addValue("freightAmountMinor", freightAmountMinor)
                        .addValue("currencyCode", currencyCode)
                        .addValue("logisticsChannel", logisticsChannel)
                        .addValue("trackingNo", trackingNo)
                        .addValue("allocationMethod", allocationMethod.name())
                        .addValue("expectedShipAt", expectedShipAt)
                        .addValue("expectedArrivalAt", expectedArrivalAt)
                        .addValue("note", note)
                        .addValue("operatorDisplayName", operatorDisplayName)
                        .addValue("actorUserId", actorUserId)
                        .addValue("actorSystemAdminId", actorSystemAdminId));
    }

    public void insertLine(
            UUID id,
            UUID tenantId,
            UUID transferId,
            UUID sourceBalanceId,
            UUID skuId,
            UUID sourceWarehouseId,
            UUID targetWarehouseId,
            long snapshotBalanceVersion,
            long snapshotOnHand,
            long snapshotReserved,
            long quantity) {
        jdbc.update(
                """
                INSERT INTO inventory_warehouse_transfer_lines (
                    id, tenant_id, transfer_id, source_balance_id, sku_id,
                    source_warehouse_id, target_warehouse_id,
                    snapshot_balance_version, snapshot_on_hand,
                    snapshot_reserved, quantity
                ) VALUES (
                    :id, :tenantId, :transferId, :sourceBalanceId, :skuId,
                    :sourceWarehouseId, :targetWarehouseId,
                    :snapshotBalanceVersion, :snapshotOnHand,
                    :snapshotReserved, :quantity
                )
                """,
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("tenantId", tenantId)
                        .addValue("transferId", transferId)
                        .addValue("sourceBalanceId", sourceBalanceId)
                        .addValue("skuId", skuId)
                        .addValue("sourceWarehouseId", sourceWarehouseId)
                        .addValue("targetWarehouseId", targetWarehouseId)
                        .addValue("snapshotBalanceVersion", snapshotBalanceVersion)
                        .addValue("snapshotOnHand", snapshotOnHand)
                        .addValue("snapshotReserved", snapshotReserved)
                        .addValue("quantity", quantity));
    }

    public List<WarehouseTransferLineView> listLines(
            UUID tenantId, UUID transferId) {
        return jdbc.query(
                """
                SELECT line.id, line.source_balance_id, line.sku_id,
                       sku.business_code AS sku_code, sku.name AS sku_name,
                       line.snapshot_balance_version,
                       line.snapshot_on_hand, line.snapshot_reserved,
                       line.quantity, line.received_quantity,
                       line.shipment_event_id,
                       line.receipt_event_id
                FROM inventory_warehouse_transfer_lines line
                JOIN tenant_product_skus sku
                  ON sku.tenant_id = line.tenant_id
                 AND sku.id = line.sku_id
                WHERE line.tenant_id = :tenantId
                  AND line.transfer_id = :transferId
                ORDER BY sku.business_code, line.id
                """,
                Map.of("tenantId", tenantId, "transferId", transferId),
                WarehouseTransferRepository::mapLine);
    }

    public int transition(
            UUID tenantId,
            UUID transferId,
            long expectedVersion,
            WarehouseTransferStatus expectedStatus,
            WarehouseTransferStatus nextStatus,
            String actorDisplayName,
            UUID actorUserId,
            UUID actorSystemAdminId) {
        return jdbc.update(
                """
                UPDATE inventory_warehouse_transfers
                SET status = :nextStatus,
                    version = version + 1,
                    submitted_at = CASE WHEN :nextStatus = 'APPROVAL'
                        THEN now() ELSE submitted_at END,
                    approved_at = CASE WHEN :nextStatus = 'READY_TO_SHIP'
                        THEN now() ELSE approved_at END,
                    shipped_at = CASE WHEN :nextStatus = 'IN_TRANSIT'
                        THEN now() ELSE shipped_at END,
                    received_at = CASE WHEN :nextStatus = 'RECEIVED'
                        THEN now() ELSE received_at END,
                    rejected_at = CASE WHEN :nextStatus = 'REJECTED'
                        THEN now() ELSE rejected_at END,
                    cancelled_at = CASE WHEN :nextStatus = 'CANCELLED'
                        THEN now() ELSE cancelled_at END,
                    approver_display_name = CASE
                        WHEN :nextStatus = 'READY_TO_SHIP'
                        THEN :actorDisplayName ELSE approver_display_name END,
                    approved_by_user_id = CASE
                        WHEN :nextStatus = 'READY_TO_SHIP'
                        THEN :actorUserId ELSE approved_by_user_id END,
                    approved_by_system_admin_id = CASE
                        WHEN :nextStatus = 'READY_TO_SHIP'
                        THEN :actorSystemAdminId
                        ELSE approved_by_system_admin_id END,
                    shipper_display_name = CASE
                        WHEN :nextStatus = 'IN_TRANSIT'
                        THEN :actorDisplayName ELSE shipper_display_name END,
                    shipped_by_user_id = CASE
                        WHEN :nextStatus = 'IN_TRANSIT'
                        THEN :actorUserId ELSE shipped_by_user_id END,
                    shipped_by_system_admin_id = CASE
                        WHEN :nextStatus = 'IN_TRANSIT'
                        THEN :actorSystemAdminId
                        ELSE shipped_by_system_admin_id END,
                    receiver_display_name = CASE
                        WHEN :nextStatus IN ('PARTIALLY_RECEIVED', 'RECEIVED')
                        THEN :actorDisplayName ELSE receiver_display_name END,
                    received_by_user_id = CASE
                        WHEN :nextStatus IN ('PARTIALLY_RECEIVED', 'RECEIVED')
                        THEN :actorUserId ELSE received_by_user_id END,
                    received_by_system_admin_id = CASE
                        WHEN :nextStatus IN ('PARTIALLY_RECEIVED', 'RECEIVED')
                        THEN :actorSystemAdminId
                        ELSE received_by_system_admin_id END,
                    updated_at = now()
                WHERE tenant_id = :tenantId AND id = :transferId
                  AND version = :expectedVersion AND status = :expectedStatus
                """,
                new MapSqlParameterSource()
                        .addValue("nextStatus", nextStatus.name())
                        .addValue("actorDisplayName", actorDisplayName)
                        .addValue("actorUserId", actorUserId)
                        .addValue("actorSystemAdminId", actorSystemAdminId)
                        .addValue("tenantId", tenantId)
                        .addValue("transferId", transferId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("expectedStatus", expectedStatus.name()));
    }

    public void setShipmentEvent(UUID tenantId, UUID lineId, UUID eventId) {
        setEvent(tenantId, lineId, eventId, "shipment_event_id");
    }

    public void recordReceipt(
            UUID tenantId,
            UUID transferId,
            UUID lineId,
            long quantity,
            UUID eventId,
            UUID commandId,
            String receiverDisplayName,
            UUID actorUserId,
            UUID actorSystemAdminId) {
        int updated = jdbc.update(
                """
                UPDATE inventory_warehouse_transfer_lines
                SET received_quantity = received_quantity + :quantity,
                    receipt_event_id = :eventId
                WHERE tenant_id = :tenantId
                  AND transfer_id = :transferId
                  AND id = :lineId
                  AND received_quantity + :quantity <= quantity
                """,
                new MapSqlParameterSource()
                        .addValue("quantity", quantity)
                        .addValue("eventId", eventId)
                        .addValue("tenantId", tenantId)
                        .addValue("transferId", transferId)
                        .addValue("lineId", lineId));
        if (updated != 1) {
            throw new IllegalStateException("Warehouse transfer receipt conflict");
        }
        jdbc.update(
                """
                INSERT INTO inventory_warehouse_transfer_receipts (
                    id, tenant_id, transfer_id, line_id, quantity,
                    inventory_event_id, command_id,
                    received_by_user_id, received_by_system_admin_id,
                    receiver_display_name
                ) VALUES (
                    :id, :tenantId, :transferId, :lineId, :quantity,
                    :eventId, :commandId,
                    :actorUserId, :actorSystemAdminId,
                    :receiverDisplayName
                )
                """,
                new MapSqlParameterSource()
                        .addValue("id", UUID.randomUUID())
                        .addValue("tenantId", tenantId)
                        .addValue("transferId", transferId)
                        .addValue("lineId", lineId)
                        .addValue("quantity", quantity)
                        .addValue("eventId", eventId)
                        .addValue("commandId", commandId)
                        .addValue("actorUserId", actorUserId)
                        .addValue("actorSystemAdminId", actorSystemAdminId)
                        .addValue("receiverDisplayName", receiverDisplayName));
    }

    private void setEvent(
            UUID tenantId, UUID lineId, UUID eventId, String column) {
        if (!column.equals("shipment_event_id")) {
            throw new IllegalArgumentException("Invalid transfer event column");
        }
        int updated = jdbc.update(
                "UPDATE inventory_warehouse_transfer_lines SET " + column
                        + " = :eventId WHERE tenant_id = :tenantId"
                        + " AND id = :lineId AND " + column + " IS NULL",
                Map.of(
                        "eventId", eventId,
                        "tenantId", tenantId,
                        "lineId", lineId));
        if (updated != 1) {
            throw new IllegalStateException("Warehouse transfer event conflict");
        }
    }

    public void lockCommand(UUID tenantId, UUID commandId) {
        jdbc.queryForObject(
                "SELECT pg_advisory_xact_lock(hashtextextended(:value, 0))",
                Map.of("value", tenantId + ":warehouse-transfer:" + commandId),
                Object.class);
    }

    public Optional<CommandRecord> findCommand(
            UUID tenantId, UUID commandId) {
        return optionalQuery(
                """
                SELECT transfer_id, operation, request_fingerprint,
                       result_status, result_version
                FROM inventory_warehouse_transfer_commands
                WHERE tenant_id = :tenantId AND command_id = :commandId
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("commandId", commandId),
                (resultSet, rowNumber) -> new CommandRecord(
                        resultSet.getObject("transfer_id", UUID.class),
                        resultSet.getString("operation"),
                        resultSet.getString("request_fingerprint"),
                        WarehouseTransferStatus.valueOf(
                                resultSet.getString("result_status")),
                        resultSet.getLong("result_version")));
    }

    public void insertCommand(
            UUID tenantId,
            UUID commandId,
            UUID transferId,
            String operation,
            String fingerprint,
            WarehouseTransferStatus status,
            long version) {
        jdbc.update(
                """
                INSERT INTO inventory_warehouse_transfer_commands (
                    tenant_id, command_id, transfer_id, operation,
                    request_fingerprint, result_status, result_version
                ) VALUES (
                    :tenantId, :commandId, :transferId, :operation,
                    :fingerprint, :status, :version
                )
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("commandId", commandId)
                        .addValue("transferId", transferId)
                        .addValue("operation", operation)
                        .addValue("fingerprint", fingerprint)
                        .addValue("status", status.name())
                        .addValue("version", version));
    }

    private static String where(
            boolean allWarehouses,
            UUID sourceWarehouseId,
            UUID targetWarehouseId,
            List<WarehouseTransferStatus> statuses,
            WarehouseTransferTransportMode transportMode,
            WarehouseTransferSearchField searchField,
            String keyword,
            LocalDate from,
            LocalDate to) {
        StringBuilder where = new StringBuilder(
                " WHERE transfer.tenant_id = :tenantId");
        if (!allWarehouses) {
            where.append(" AND transfer.source_warehouse_id IN (:warehouseScope)")
                    .append(" AND transfer.target_warehouse_id IN (:warehouseScope)");
        }
        if (sourceWarehouseId != null) {
            where.append(" AND transfer.source_warehouse_id = :sourceWarehouseId");
        }
        if (targetWarehouseId != null) {
            where.append(" AND transfer.target_warehouse_id = :targetWarehouseId");
        }
        if (statuses != null && !statuses.isEmpty()) {
            where.append(" AND transfer.status IN (:statuses)");
        }
        if (transportMode != null) {
            where.append(" AND transfer.transport_mode = :transportMode");
        }
        if (from != null) where.append(" AND transfer.transfer_date >= :from");
        if (to != null) where.append(" AND transfer.transfer_date <= :to");
        if (keyword != null) {
            where.append(" AND (");
            if (searchField == WarehouseTransferSearchField.SKU) {
                where.append("EXISTS (SELECT 1"
                        + " FROM inventory_warehouse_transfer_lines keyword_line"
                        + " JOIN tenant_product_skus keyword_sku"
                        + " ON keyword_sku.tenant_id = keyword_line.tenant_id"
                        + " AND keyword_sku.id = keyword_line.sku_id"
                        + " WHERE keyword_line.tenant_id = transfer.tenant_id"
                        + " AND keyword_line.transfer_id = transfer.id"
                        + " AND lower(keyword_sku.business_code) LIKE :keyword)");
            } else if (searchField == WarehouseTransferSearchField.REMARK) {
                where.append("lower(coalesce(transfer.note, '')) LIKE :keyword");
            } else if (searchField == WarehouseTransferSearchField.OPERATOR) {
                where.append("lower(transfer.operator_display_name) LIKE :keyword");
            } else {
                where.append("lower(transfer.transfer_no) LIKE :keyword");
            }
            where.append(")");
        }
        return where.toString();
    }

    private static MapSqlParameterSource parameters(
            UUID tenantId,
            Set<UUID> warehouseScope,
            UUID sourceWarehouseId,
            UUID targetWarehouseId,
            List<WarehouseTransferStatus> statuses,
            WarehouseTransferTransportMode transportMode,
            String keyword,
            LocalDate from,
            LocalDate to) {
        return new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("sourceWarehouseId", sourceWarehouseId)
                .addValue("targetWarehouseId", targetWarehouseId)
                .addValue("statuses", statuses == null
                        ? List.of()
                        : statuses.stream().map(Enum::name).toList())
                .addValue("transportMode",
                        transportMode == null ? null : transportMode.name())
                .addValue("keyword", keyword == null ? null : "%" + keyword + "%")
                .addValue("from", from)
                .addValue("to", to);
    }

    private static WarehouseTransferSummary mapSummary(
            ResultSet resultSet, int rowNumber) throws SQLException {
        Long freight = resultSet.getObject("freight_amount_minor", Long.class);
        return new WarehouseTransferSummary(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("transfer_no"),
                WarehouseTransferStatus.valueOf(resultSet.getString("status")),
                resultSet.getObject("transfer_date", LocalDate.class),
                resultSet.getObject("source_warehouse_id", UUID.class),
                resultSet.getString("source_warehouse_code"),
                resultSet.getString("source_warehouse_name"),
                resultSet.getObject("target_warehouse_id", UUID.class),
                resultSet.getString("target_warehouse_code"),
                resultSet.getString("target_warehouse_name"),
                WarehouseTransferTransportMode.valueOf(
                        resultSet.getString("transport_mode")),
                freight,
                resultSet.getString("currency_code"),
                resultSet.getString("logistics_channel"),
                resultSet.getString("tracking_no"),
                WarehouseTransferAllocationMethod.valueOf(
                        resultSet.getString("allocation_method")),
                instant(resultSet, "expected_ship_at"),
                instant(resultSet, "expected_arrival_at"),
                resultSet.getString("note"),
                resultSet.getInt("line_count"),
                resultSet.getLong("total_quantity"),
                resultSet.getLong("version"),
                resultSet.getString("operator_display_name"),
                resultSet.getString("approver_display_name"),
                resultSet.getString("shipper_display_name"),
                resultSet.getString("receiver_display_name"),
                instant(resultSet, "created_at"),
                instant(resultSet, "updated_at"));
    }

    private static WarehouseTransferLineView mapLine(
            ResultSet resultSet, int rowNumber) throws SQLException {
        long onHand = resultSet.getLong("snapshot_on_hand");
        long reserved = resultSet.getLong("snapshot_reserved");
        long quantity = resultSet.getLong("quantity");
        long receivedQuantity = resultSet.getLong("received_quantity");
        return new WarehouseTransferLineView(
                resultSet.getObject("id", UUID.class),
                resultSet.getObject("source_balance_id", UUID.class),
                resultSet.getObject("sku_id", UUID.class),
                resultSet.getString("sku_code"),
                resultSet.getString("sku_name"),
                resultSet.getLong("snapshot_balance_version"),
                onHand,
                reserved,
                Math.subtractExact(onHand, reserved),
                quantity,
                receivedQuantity,
                Math.subtractExact(quantity, receivedQuantity),
                resultSet.getObject("shipment_event_id", UUID.class),
                resultSet.getObject("receipt_event_id", UUID.class));
    }

    private static Instant instant(ResultSet resultSet, String column)
            throws SQLException {
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value == null
                ? null
                : value.withOffsetSameInstant(ZoneOffset.UTC).toInstant();
    }

    private <T> Optional<T> optionalQuery(
            String sql,
            MapSqlParameterSource parameters,
            org.springframework.jdbc.core.RowMapper<T> mapper) {
        try {
            return Optional.ofNullable(jdbc.queryForObject(
                    sql, parameters, mapper));
        } catch (EmptyResultDataAccessException exception) {
            return Optional.empty();
        }
    }

    public record CommandRecord(
            UUID transferId,
            String operation,
            String fingerprint,
            WarehouseTransferStatus status,
            long version) {
    }
}
