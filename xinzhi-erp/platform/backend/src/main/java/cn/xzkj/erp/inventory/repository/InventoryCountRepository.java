package cn.xzkj.erp.inventory.repository;

import cn.xzkj.erp.inventory.domain.InventoryCountStatus;
import cn.xzkj.erp.inventory.service.InventoryCountDetail;
import cn.xzkj.erp.inventory.service.InventoryCountLineView;
import cn.xzkj.erp.inventory.service.InventoryCountSearchField;
import cn.xzkj.erp.inventory.service.InventoryCountSummary;
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
public class InventoryCountRepository {
    private static final String SUMMARY_SELECT = """
            SELECT count_batch.id, count_batch.count_no,
                   count_batch.warehouse_id,
                   warehouse.business_code AS warehouse_code,
                   warehouse.name AS warehouse_name,
                   count_batch.status, count_batch.count_date,
                   count_batch.note, count_batch.version,
                   count_batch.operator_display_name,
                   count_batch.approver_display_name,
                   count_batch.created_at, count_batch.updated_at,
                   count(count_line.id) AS line_count,
                   coalesce(sum(count_line.difference), 0) AS total_difference
            FROM inventory_count_batches count_batch
            JOIN tenant_warehouses warehouse
              ON warehouse.tenant_id = count_batch.tenant_id
             AND warehouse.id = count_batch.warehouse_id
            LEFT JOIN inventory_count_lines count_line
              ON count_line.tenant_id = count_batch.tenant_id
             AND count_line.count_id = count_batch.id
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public InventoryCountRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Page<InventoryCountSummary> list(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            UUID warehouseId,
            InventoryCountStatus status,
            InventoryCountSearchField searchField,
            String keyword,
            LocalDate from,
            LocalDate to,
            Long differenceMin,
            Long differenceMax,
            Pageable pageable) {
        String where = where(
                allWarehouses,
                warehouseId,
                status,
                searchField,
                keyword,
                from,
                to);
        String having = having(differenceMin, differenceMax);
        MapSqlParameterSource parameters = parameters(
                tenantId,
                warehouseScope,
                warehouseId,
                status,
                searchField,
                keyword,
                from,
                to,
                differenceMin,
                differenceMax)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        String group = """
                 GROUP BY count_batch.id, warehouse.business_code,
                          warehouse.name
                """;
        List<InventoryCountSummary> rows = jdbc.query(
                SUMMARY_SELECT + where + group + having
                        + " ORDER BY count_batch.count_date DESC,"
                        + " count_batch.created_at DESC, count_batch.id"
                        + " LIMIT :limit OFFSET :offset",
                parameters,
                InventoryCountRepository::mapSummary);
        Long total = jdbc.queryForObject(
                "SELECT count(*) FROM ("
                        + SUMMARY_SELECT + where + group + having
                        + ") counted",
                parameters,
                Long.class);
        return new PageImpl<>(rows, pageable, total == null ? 0 : total);
    }

    public Optional<InventoryCountDetail> find(UUID tenantId, UUID countId) {
        Optional<InventoryCountSummary> summary = optionalQuery(
                SUMMARY_SELECT
                        + " WHERE count_batch.tenant_id = :tenantId"
                        + " AND count_batch.id = :countId"
                        + " GROUP BY count_batch.id, warehouse.business_code,"
                        + " warehouse.name",
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("countId", countId),
                InventoryCountRepository::mapSummary);
        return summary.map(value -> new InventoryCountDetail(
                value, listLines(tenantId, countId)));
    }

    public Optional<InventoryCountSummary> lock(UUID tenantId, UUID countId) {
        jdbc.query(
                "SELECT id FROM inventory_count_batches"
                        + " WHERE tenant_id = :tenantId AND id = :countId"
                        + " FOR UPDATE",
                Map.of("tenantId", tenantId, "countId", countId),
                (resultSet, rowNumber) -> resultSet.getObject(1, UUID.class));
        return find(tenantId, countId).map(InventoryCountDetail::summary);
    }

    public InventoryCountSummary insertBatch(
            UUID id,
            UUID tenantId,
            String countNo,
            UUID warehouseId,
            LocalDate countDate,
            String note,
            String operatorDisplayName,
            UUID actorUserId,
            UUID actorSystemAdminId) {
        jdbc.update(
                """
                INSERT INTO inventory_count_batches (
                    id, tenant_id, count_no, warehouse_id, count_date,
                    note, operator_display_name, created_by_user_id,
                    created_by_system_admin_id
                ) VALUES (
                    :id, :tenantId, :countNo, :warehouseId, :countDate,
                    :note, :operatorDisplayName, :actorUserId,
                    :actorSystemAdminId
                )
                """,
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("tenantId", tenantId)
                        .addValue("countNo", countNo)
                        .addValue("warehouseId", warehouseId)
                        .addValue("countDate", countDate)
                        .addValue("note", note)
                        .addValue("operatorDisplayName", operatorDisplayName)
                        .addValue("actorUserId", actorUserId)
                        .addValue("actorSystemAdminId", actorSystemAdminId));
        return find(tenantId, id).orElseThrow().summary();
    }

    public void insertLine(
            UUID id,
            UUID tenantId,
            UUID countId,
            UUID balanceId,
            UUID skuId,
            UUID warehouseId,
            long expectedVersion,
            long snapshotOnHand,
            long snapshotReserved,
            long countedOnHand) {
        jdbc.update(
                """
                INSERT INTO inventory_count_lines (
                    id, tenant_id, count_id, balance_id, sku_id,
                    warehouse_id, expected_balance_version,
                    snapshot_on_hand, snapshot_reserved, counted_on_hand,
                    difference
                ) VALUES (
                    :id, :tenantId, :countId, :balanceId, :skuId,
                    :warehouseId, :expectedVersion,
                    :snapshotOnHand, :snapshotReserved, :countedOnHand,
                    :countedOnHand - :snapshotOnHand
                )
                """,
                new MapSqlParameterSource()
                        .addValue("id", id)
                        .addValue("tenantId", tenantId)
                        .addValue("countId", countId)
                        .addValue("balanceId", balanceId)
                        .addValue("skuId", skuId)
                        .addValue("warehouseId", warehouseId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("snapshotOnHand", snapshotOnHand)
                        .addValue("snapshotReserved", snapshotReserved)
                        .addValue("countedOnHand", countedOnHand));
    }

    public List<InventoryCountLineView> listLines(UUID tenantId, UUID countId) {
        return jdbc.query(
                """
                SELECT count_line.id, count_line.balance_id,
                       count_line.sku_id, sku.business_code AS sku_code,
                       sku.name AS sku_name,
                       count_line.expected_balance_version,
                       count_line.snapshot_on_hand,
                       count_line.snapshot_reserved,
                       count_line.counted_on_hand, count_line.difference,
                       count_line.result_event_id
                FROM inventory_count_lines count_line
                JOIN tenant_product_skus sku
                  ON sku.tenant_id = count_line.tenant_id
                 AND sku.id = count_line.sku_id
                WHERE count_line.tenant_id = :tenantId
                  AND count_line.count_id = :countId
                ORDER BY sku.business_code, count_line.id
                """,
                Map.of("tenantId", tenantId, "countId", countId),
                InventoryCountRepository::mapLine);
    }

    public int transition(
            UUID tenantId,
            UUID countId,
            long expectedVersion,
            InventoryCountStatus expectedStatus,
            InventoryCountStatus nextStatus,
            String approverDisplayName,
            UUID reviewerUserId,
            UUID reviewerSystemAdminId) {
        boolean reviewed = nextStatus == InventoryCountStatus.COMPLETED
                || nextStatus == InventoryCountStatus.REJECTED;
        return jdbc.update(
                """
                UPDATE inventory_count_batches
                SET status = :nextStatus,
                    version = version + 1,
                    submitted_at = CASE WHEN :nextStatus = 'APPROVAL'
                        THEN now() ELSE submitted_at END,
                    reviewed_at = CASE WHEN :reviewed THEN now()
                        ELSE reviewed_at END,
                    cancelled_at = CASE WHEN :nextStatus = 'CANCELLED'
                        THEN now() ELSE cancelled_at END,
                    approver_display_name = CASE WHEN :reviewed
                        THEN :approverDisplayName ELSE approver_display_name END,
                    reviewed_by_user_id = CASE WHEN :reviewed
                        THEN :reviewerUserId ELSE reviewed_by_user_id END,
                    reviewed_by_system_admin_id = CASE WHEN :reviewed
                        THEN :reviewerSystemAdminId ELSE reviewed_by_system_admin_id END,
                    updated_at = now()
                WHERE tenant_id = :tenantId AND id = :countId
                  AND version = :expectedVersion AND status = :expectedStatus
                """,
                new MapSqlParameterSource()
                        .addValue("nextStatus", nextStatus.name())
                        .addValue("reviewed", reviewed)
                        .addValue("approverDisplayName", approverDisplayName)
                        .addValue("reviewerUserId", reviewerUserId)
                        .addValue("reviewerSystemAdminId", reviewerSystemAdminId)
                        .addValue("tenantId", tenantId)
                        .addValue("countId", countId)
                        .addValue("expectedVersion", expectedVersion)
                        .addValue("expectedStatus", expectedStatus.name()));
    }

    public void setResultEvent(UUID tenantId, UUID lineId, UUID eventId) {
        int updated = jdbc.update(
                "UPDATE inventory_count_lines SET result_event_id = :eventId"
                        + " WHERE tenant_id = :tenantId AND id = :lineId"
                        + " AND result_event_id IS NULL",
                Map.of("eventId", eventId, "tenantId", tenantId, "lineId", lineId));
        if (updated != 1) {
            throw new IllegalStateException("Inventory count result event conflict");
        }
    }

    public void lockCommand(UUID tenantId, UUID commandId) {
        jdbc.queryForObject(
                "SELECT pg_advisory_xact_lock(hashtextextended(:value, 0))",
                Map.of("value", tenantId + ":inventory-count:" + commandId),
                Object.class);
    }

    public Optional<CommandRecord> findCommand(UUID tenantId, UUID commandId) {
        return optionalQuery(
                """
                SELECT count_id, operation, request_fingerprint,
                       result_status, result_version
                FROM inventory_count_commands
                WHERE tenant_id = :tenantId AND command_id = :commandId
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("commandId", commandId),
                (resultSet, rowNumber) -> new CommandRecord(
                        resultSet.getObject("count_id", UUID.class),
                        resultSet.getString("operation"),
                        resultSet.getString("request_fingerprint"),
                        InventoryCountStatus.valueOf(
                                resultSet.getString("result_status")),
                        resultSet.getLong("result_version")));
    }

    public void insertCommand(
            UUID tenantId,
            UUID commandId,
            UUID countId,
            String operation,
            String fingerprint,
            InventoryCountStatus status,
            long version) {
        jdbc.update(
                """
                INSERT INTO inventory_count_commands (
                    tenant_id, command_id, count_id, operation,
                    request_fingerprint, result_status, result_version
                ) VALUES (
                    :tenantId, :commandId, :countId, :operation,
                    :fingerprint, :status, :version
                )
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("commandId", commandId)
                        .addValue("countId", countId)
                        .addValue("operation", operation)
                        .addValue("fingerprint", fingerprint)
                        .addValue("status", status.name())
                        .addValue("version", version));
    }

    private static String where(
            boolean allWarehouses,
            UUID warehouseId,
            InventoryCountStatus status,
            InventoryCountSearchField searchField,
            String keyword,
            LocalDate from,
            LocalDate to) {
        StringBuilder where = new StringBuilder(
                " WHERE count_batch.tenant_id = :tenantId");
        if (!allWarehouses) where.append(" AND count_batch.warehouse_id IN (:warehouseScope)");
        if (warehouseId != null) where.append(" AND count_batch.warehouse_id = :warehouseId");
        if (status != null) where.append(" AND count_batch.status = :status");
        if (from != null) where.append(" AND count_batch.count_date >= :from");
        if (to != null) where.append(" AND count_batch.count_date <= :to");
        if (keyword != null) {
            where.append(" AND (");
            if (searchField == InventoryCountSearchField.SKU) {
                where.append("EXISTS (SELECT 1 FROM inventory_count_lines keyword_line"
                        + " JOIN tenant_product_skus keyword_sku"
                        + " ON keyword_sku.tenant_id = keyword_line.tenant_id"
                        + " AND keyword_sku.id = keyword_line.sku_id"
                        + " WHERE keyword_line.tenant_id = count_batch.tenant_id"
                        + " AND keyword_line.count_id = count_batch.id"
                        + " AND lower(keyword_sku.business_code) LIKE :keyword)");
            } else if (searchField == InventoryCountSearchField.REMARK) {
                where.append("lower(coalesce(count_batch.note, '')) LIKE :keyword");
            } else if (searchField == InventoryCountSearchField.OPERATOR) {
                where.append("lower(count_batch.operator_display_name) LIKE :keyword");
            } else {
                where.append("lower(count_batch.count_no) LIKE :keyword");
            }
            where.append(")");
        }
        return where.toString();
    }

    private static String having(Long minimum, Long maximum) {
        StringBuilder having = new StringBuilder();
        if (minimum != null || maximum != null) having.append(" HAVING true");
        if (minimum != null) having.append(" AND coalesce(sum(count_line.difference), 0) >= :differenceMin");
        if (maximum != null) having.append(" AND coalesce(sum(count_line.difference), 0) <= :differenceMax");
        return having.toString();
    }

    private static MapSqlParameterSource parameters(
            UUID tenantId,
            Set<UUID> warehouseScope,
            UUID warehouseId,
            InventoryCountStatus status,
            InventoryCountSearchField searchField,
            String keyword,
            LocalDate from,
            LocalDate to,
            Long differenceMin,
            Long differenceMax) {
        return new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("warehouseId", warehouseId)
                .addValue("status", status == null ? null : status.name())
                .addValue("searchField", searchField.name())
                .addValue("keyword", keyword == null ? null : "%" + keyword + "%")
                .addValue("from", from)
                .addValue("to", to)
                .addValue("differenceMin", differenceMin)
                .addValue("differenceMax", differenceMax);
    }

    private static InventoryCountSummary mapSummary(ResultSet resultSet, int rowNumber)
            throws SQLException {
        return new InventoryCountSummary(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("count_no"),
                resultSet.getObject("warehouse_id", UUID.class),
                resultSet.getString("warehouse_code"),
                resultSet.getString("warehouse_name"),
                InventoryCountStatus.valueOf(resultSet.getString("status")),
                resultSet.getObject("count_date", LocalDate.class),
                resultSet.getString("note"),
                resultSet.getInt("line_count"),
                resultSet.getLong("total_difference"),
                resultSet.getLong("version"),
                resultSet.getString("operator_display_name"),
                resultSet.getString("approver_display_name"),
                instant(resultSet, "created_at"),
                instant(resultSet, "updated_at"));
    }

    private static InventoryCountLineView mapLine(ResultSet resultSet, int rowNumber)
            throws SQLException {
        long onHand = resultSet.getLong("snapshot_on_hand");
        long reserved = resultSet.getLong("snapshot_reserved");
        return new InventoryCountLineView(
                resultSet.getObject("id", UUID.class),
                resultSet.getObject("balance_id", UUID.class),
                resultSet.getObject("sku_id", UUID.class),
                resultSet.getString("sku_code"),
                resultSet.getString("sku_name"),
                resultSet.getLong("expected_balance_version"),
                onHand,
                reserved,
                Math.subtractExact(onHand, reserved),
                resultSet.getLong("counted_on_hand"),
                resultSet.getLong("difference"),
                resultSet.getObject("result_event_id", UUID.class));
    }

    private static Instant instant(ResultSet resultSet, String column)
            throws SQLException {
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.withOffsetSameInstant(ZoneOffset.UTC).toInstant();
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

    public record CommandRecord(
            UUID countId,
            String operation,
            String fingerprint,
            InventoryCountStatus status,
            long version) {
    }

}
