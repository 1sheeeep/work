package cn.xzkj.erp.analytics.inventoryperiod;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class InventoryPeriodReportRepository {
    private final NamedParameterJdbcTemplate jdbc;

    public InventoryPeriodReportRepository(
            NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public InventoryPeriodReportResult summarize(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            UUID warehouseId,
            String keyword,
            Instant periodFrom,
            Instant periodToExclusive,
            Pageable pageable) {
        String reportRows = reportRows(allWarehouses, warehouseId);
        String filtered = filtered(reportRows, keyword);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("warehouseId", warehouseId)
                .addValue("keyword", literalPattern(keyword))
                .addValue("periodFrom", Timestamp.from(periodFrom))
                .addValue(
                        "periodToExclusive",
                        Timestamp.from(periodToExclusive))
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());

        Totals totals = jdbc.queryForObject(
                filtered + """
                        SELECT count(*) AS total_elements,
                               coalesce(sum(opening_quantity), 0)::bigint
                                   AS total_opening_quantity,
                               coalesce(sum(increased_quantity), 0)::bigint
                                   AS total_increased_quantity,
                               coalesce(sum(decreased_quantity), 0)::bigint
                                   AS total_decreased_quantity,
                               coalesce(sum(closing_quantity), 0)::bigint
                                   AS total_closing_quantity
                          FROM filtered
                        """,
                parameters,
                (resultSet, rowNumber) -> new Totals(
                        resultSet.getLong("total_elements"),
                        resultSet.getLong("total_opening_quantity"),
                        resultSet.getLong("total_increased_quantity"),
                        resultSet.getLong("total_decreased_quantity"),
                        resultSet.getLong("total_closing_quantity")));
        if (totals == null || totals.totalElements() == 0) {
            return InventoryPeriodReportResult.empty();
        }

        List<InventoryPeriodReportItem> items = jdbc.query(
                filtered + """
                        SELECT sku_id, sku_code, sku_name,
                               warehouse_id, warehouse_code, warehouse_name,
                               opening_quantity, increased_quantity,
                               decreased_quantity, closing_quantity
                          FROM filtered
                         ORDER BY warehouse_code, sku_code, warehouse_id, sku_id
                         LIMIT :limit OFFSET :offset
                        """,
                parameters,
                (resultSet, rowNumber) -> new InventoryPeriodReportItem(
                        resultSet.getObject("sku_id", UUID.class),
                        resultSet.getString("sku_code"),
                        resultSet.getString("sku_name"),
                        resultSet.getObject("warehouse_id", UUID.class),
                        resultSet.getString("warehouse_code"),
                        resultSet.getString("warehouse_name"),
                        resultSet.getLong("opening_quantity"),
                        resultSet.getLong("increased_quantity"),
                        resultSet.getLong("decreased_quantity"),
                        resultSet.getLong("closing_quantity")));
        return new InventoryPeriodReportResult(
                items,
                totals.totalOpeningQuantity(),
                totals.totalIncreasedQuantity(),
                totals.totalDecreasedQuantity(),
                totals.totalClosingQuantity(),
                totals.totalElements());
    }

    private static String reportRows(
            boolean allWarehouses, UUID warehouseId) {
        StringBuilder where = new StringBuilder("""
                WHERE event.tenant_id = :tenantId
                  AND event.recorded_at < :periodToExclusive
                """);
        if (!allWarehouses) {
            where.append(" AND event.warehouse_id IN (:warehouseScope)");
        }
        if (warehouseId != null) {
            where.append(" AND event.warehouse_id = :warehouseId");
        }
        return """
                WITH report_rows AS (
                    SELECT event.sku_id, event.warehouse_id,
                           coalesce(sum(event.signed_delta) FILTER (
                               WHERE event.recorded_at < :periodFrom
                           ), 0)::bigint AS opening_quantity,
                           coalesce(sum(event.signed_delta) FILTER (
                               WHERE event.recorded_at >= :periodFrom
                                 AND event.signed_delta > 0
                           ), 0)::bigint AS increased_quantity,
                           coalesce(sum(-event.signed_delta) FILTER (
                               WHERE event.recorded_at >= :periodFrom
                                 AND event.signed_delta < 0
                           ), 0)::bigint AS decreased_quantity,
                           coalesce(sum(event.signed_delta), 0)::bigint
                               AS closing_quantity
                      FROM inventory_ledger_events event
                """ + where + """
                     GROUP BY event.sku_id, event.warehouse_id
                    HAVING coalesce(sum(event.signed_delta) FILTER (
                               WHERE event.recorded_at < :periodFrom
                           ), 0) <> 0
                        OR count(*) FILTER (
                               WHERE event.recorded_at >= :periodFrom
                           ) > 0
                )
                """;
    }

    private static String filtered(String reportRows, String keyword) {
        String keywordClause = keyword == null ? "" : """
                WHERE lower(sku.business_code || ' ' || sku.name || ' '
                    || warehouse.business_code || ' ' || warehouse.name)
                    LIKE :keyword ESCAPE '\\'
                """;
        return reportRows + """
                , filtered AS (
                    SELECT report_rows.sku_id,
                           sku.business_code AS sku_code,
                           sku.name AS sku_name,
                           report_rows.warehouse_id,
                           warehouse.business_code AS warehouse_code,
                           warehouse.name AS warehouse_name,
                           report_rows.opening_quantity,
                           report_rows.increased_quantity,
                           report_rows.decreased_quantity,
                           report_rows.closing_quantity
                      FROM report_rows
                      JOIN tenant_product_skus sku
                        ON sku.tenant_id = :tenantId
                       AND sku.id = report_rows.sku_id
                      JOIN tenant_warehouses warehouse
                        ON warehouse.tenant_id = :tenantId
                       AND warehouse.id = report_rows.warehouse_id
                """ + keywordClause + ") ";
    }

    private static String literalPattern(String value) {
        if (value == null) return null;
        return "%" + value.replace("\\", "\\\\")
                .replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private record Totals(
            long totalElements,
            long totalOpeningQuantity,
            long totalIncreasedQuantity,
            long totalDecreasedQuantity,
            long totalClosingQuantity) {}
}
