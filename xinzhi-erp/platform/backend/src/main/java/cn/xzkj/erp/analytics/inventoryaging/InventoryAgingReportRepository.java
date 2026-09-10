package cn.xzkj.erp.analytics.inventoryaging;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class InventoryAgingReportRepository {
    private final NamedParameterJdbcTemplate jdbc;

    public InventoryAgingReportRepository(
            NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public InventoryAgingReportResult summarize(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            UUID warehouseId,
            String keyword,
            LocalDate cutoffDate,
            Instant cutoffExclusive,
            Pageable pageable) {
        String filtered = filtered(
                reportRows(allWarehouses, warehouseId), keyword);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("warehouseId", warehouseId)
                .addValue("keyword", literalPattern(keyword))
                .addValue("cutoffDate", Date.valueOf(cutoffDate))
                .addValue(
                        "cutoffExclusive",
                        Timestamp.from(cutoffExclusive))
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());

        Totals totals = jdbc.queryForObject(
                filtered + """
                        SELECT count(*) AS total_elements,
                               coalesce(sum(total_quantity), 0)::bigint
                                   AS total_quantity,
                               coalesce(sum(age_0_30_quantity), 0)::bigint
                                   AS age_0_30_quantity,
                               coalesce(sum(age_31_60_quantity), 0)::bigint
                                   AS age_31_60_quantity,
                               coalesce(sum(age_61_90_quantity), 0)::bigint
                                   AS age_61_90_quantity,
                               coalesce(sum(age_91_365_quantity), 0)::bigint
                                   AS age_91_365_quantity,
                               coalesce(sum(age_over_365_quantity), 0)::bigint
                                   AS age_over_365_quantity
                          FROM filtered
                        """,
                parameters,
                (resultSet, rowNumber) -> new Totals(
                        resultSet.getLong("total_elements"),
                        resultSet.getLong("total_quantity"),
                        resultSet.getLong("age_0_30_quantity"),
                        resultSet.getLong("age_31_60_quantity"),
                        resultSet.getLong("age_61_90_quantity"),
                        resultSet.getLong("age_91_365_quantity"),
                        resultSet.getLong("age_over_365_quantity")));
        if (totals == null || totals.totalElements() == 0) {
            return InventoryAgingReportResult.empty();
        }

        List<InventoryAgingReportItem> items = jdbc.query(
                filtered + """
                        SELECT sku_id, sku_code, sku_name,
                               warehouse_id, warehouse_code, warehouse_name,
                               oldest_inventory_date, maximum_age_days,
                               total_quantity, age_0_30_quantity,
                               age_31_60_quantity, age_61_90_quantity,
                               age_91_365_quantity, age_over_365_quantity
                          FROM filtered
                         ORDER BY maximum_age_days DESC,
                                  warehouse_code, sku_code,
                                  warehouse_id, sku_id
                         LIMIT :limit OFFSET :offset
                        """,
                parameters,
                (resultSet, rowNumber) -> new InventoryAgingReportItem(
                        resultSet.getObject("sku_id", UUID.class),
                        resultSet.getString("sku_code"),
                        resultSet.getString("sku_name"),
                        resultSet.getObject("warehouse_id", UUID.class),
                        resultSet.getString("warehouse_code"),
                        resultSet.getString("warehouse_name"),
                        resultSet.getObject(
                                "oldest_inventory_date", LocalDate.class),
                        resultSet.getInt("maximum_age_days"),
                        resultSet.getLong("total_quantity"),
                        resultSet.getLong("age_0_30_quantity"),
                        resultSet.getLong("age_31_60_quantity"),
                        resultSet.getLong("age_61_90_quantity"),
                        resultSet.getLong("age_91_365_quantity"),
                        resultSet.getLong("age_over_365_quantity")));
        return new InventoryAgingReportResult(
                items,
                totals.totalQuantity(),
                totals.age0To30Quantity(),
                totals.age31To60Quantity(),
                totals.age61To90Quantity(),
                totals.age91To365Quantity(),
                totals.ageOver365Quantity(),
                totals.totalElements());
    }

    private static String reportRows(
            boolean allWarehouses,
            UUID warehouseId) {
        StringBuilder scope = new StringBuilder();
        if (!allWarehouses) {
            scope.append(" AND event.warehouse_id IN (:warehouseScope)");
        }
        if (warehouseId != null) {
            scope.append(" AND event.warehouse_id = :warehouseId");
        }
        return """
                WITH as_of_balances AS (
                    SELECT event.sku_id, event.warehouse_id,
                           sum(event.signed_delta)::bigint AS on_hand
                      FROM inventory_ledger_events event
                     WHERE event.tenant_id = :tenantId
                       AND event.recorded_at < :cutoffExclusive
                """ + scope + """
                     GROUP BY event.sku_id, event.warehouse_id
                    HAVING sum(event.signed_delta) > 0
                ), positive_events AS (
                    SELECT event.sku_id, event.warehouse_id,
                           event.signed_delta, event.recorded_at,
                           event.ledger_sequence, balance.on_hand,
                           coalesce(sum(event.signed_delta) OVER (
                               PARTITION BY event.sku_id, event.warehouse_id
                               ORDER BY event.recorded_at DESC,
                                        event.ledger_sequence DESC
                               ROWS BETWEEN UNBOUNDED PRECEDING
                                        AND 1 PRECEDING
                           ), 0)::bigint AS newer_receipts,
                           (:cutoffDate
                               - (event.recorded_at AT TIME ZONE
                                  'Asia/Shanghai')::date)::integer
                               AS age_days,
                           (event.recorded_at AT TIME ZONE
                              'Asia/Shanghai')::date AS received_date
                      FROM inventory_ledger_events event
                      JOIN as_of_balances balance
                        ON balance.sku_id = event.sku_id
                       AND balance.warehouse_id = event.warehouse_id
                     WHERE event.tenant_id = :tenantId
                       AND event.recorded_at < :cutoffExclusive
                       AND event.signed_delta > 0
                ), allocated AS (
                    SELECT sku_id, warehouse_id, age_days, received_date,
                           greatest(least(
                               signed_delta,
                               on_hand - newer_receipts
                           ), 0)::bigint AS remaining_quantity
                      FROM positive_events
                ), report_rows AS (
                    SELECT sku_id, warehouse_id,
                           min(received_date) FILTER (
                               WHERE remaining_quantity > 0
                           ) AS oldest_inventory_date,
                           max(age_days) FILTER (
                               WHERE remaining_quantity > 0
                           )::integer AS maximum_age_days,
                           sum(remaining_quantity)::bigint AS total_quantity,
                           coalesce(sum(remaining_quantity) FILTER (
                               WHERE age_days BETWEEN 0 AND 30
                           ), 0)::bigint AS age_0_30_quantity,
                           coalesce(sum(remaining_quantity) FILTER (
                               WHERE age_days BETWEEN 31 AND 60
                           ), 0)::bigint AS age_31_60_quantity,
                           coalesce(sum(remaining_quantity) FILTER (
                               WHERE age_days BETWEEN 61 AND 90
                           ), 0)::bigint AS age_61_90_quantity,
                           coalesce(sum(remaining_quantity) FILTER (
                               WHERE age_days BETWEEN 91 AND 365
                           ), 0)::bigint AS age_91_365_quantity,
                           coalesce(sum(remaining_quantity) FILTER (
                               WHERE age_days > 365
                           ), 0)::bigint AS age_over_365_quantity
                      FROM allocated
                     WHERE remaining_quantity > 0
                     GROUP BY sku_id, warehouse_id
                    HAVING sum(remaining_quantity) > 0
                )
                """;
    }

    private static String filtered(
            String reportRows,
            String keyword) {
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
                           report_rows.oldest_inventory_date,
                           report_rows.maximum_age_days,
                           report_rows.total_quantity,
                           report_rows.age_0_30_quantity,
                           report_rows.age_31_60_quantity,
                           report_rows.age_61_90_quantity,
                           report_rows.age_91_365_quantity,
                           report_rows.age_over_365_quantity
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
            long totalQuantity,
            long age0To30Quantity,
            long age31To60Quantity,
            long age61To90Quantity,
            long age91To365Quantity,
            long ageOver365Quantity) {
    }
}
