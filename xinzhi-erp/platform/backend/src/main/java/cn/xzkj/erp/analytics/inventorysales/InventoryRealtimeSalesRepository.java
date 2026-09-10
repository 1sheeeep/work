package cn.xzkj.erp.analytics.inventorysales;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class InventoryRealtimeSalesRepository {
    private final NamedParameterJdbcTemplate jdbc;

    public InventoryRealtimeSalesRepository(
            NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public InventoryRealtimeSalesResult summarize(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            String keyword,
            Instant rangeFrom,
            Instant asOf,
            Pageable pageable) {
        String filtered = filtered(allWarehouses, keyword);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("keyword", literalPattern(keyword))
                .addValue("rangeFrom", rangeFrom == null
                        ? null : Timestamp.from(rangeFrom))
                .addValue("asOf", Timestamp.from(asOf))
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());

        Totals totals = jdbc.queryForObject(
                filtered + """
                        SELECT count(*) AS total_balance_count,
                               coalesce(sum(on_hand), 0)::bigint
                                   AS total_on_hand,
                               coalesce(sum(reserved), 0)::bigint
                                   AS total_reserved,
                               coalesce(sum(available), 0)::bigint
                                   AS total_available,
                               coalesce(sum(range_sales_quantity), 0)::bigint
                                   AS total_range_sales_quantity
                          FROM filtered
                        """,
                parameters,
                (resultSet, rowNumber) -> new Totals(
                        resultSet.getLong("total_balance_count"),
                        resultSet.getLong("total_on_hand"),
                        resultSet.getLong("total_reserved"),
                        resultSet.getLong("total_available"),
                        resultSet.getLong("total_range_sales_quantity")));
        if (totals == null || totals.totalBalanceCount() == 0) {
            return InventoryRealtimeSalesResult.empty();
        }

        List<InventoryRealtimeSalesItem> items = jdbc.query(
                filtered + """
                        SELECT balance_id, sku_id, sku_code, sku_name,
                               variant_summary, warehouse_id,
                               warehouse_code, warehouse_name,
                               on_hand, reserved, available,
                               range_sales_quantity, range_order_count,
                               today_sales_quantity,
                               yesterday_sales_quantity,
                               last_7_days_sales_quantity,
                               last_28_days_sales_quantity,
                               last_42_days_sales_quantity, updated_at
                          FROM filtered
                         ORDER BY last_42_days_sales_quantity DESC,
                                  warehouse_code ASC, sku_code ASC,
                                  balance_id ASC
                         LIMIT :limit OFFSET :offset
                        """,
                parameters,
                (resultSet, rowNumber) -> new InventoryRealtimeSalesItem(
                        resultSet.getObject("balance_id", UUID.class),
                        resultSet.getObject("sku_id", UUID.class),
                        resultSet.getString("sku_code"),
                        resultSet.getString("sku_name"),
                        resultSet.getString("variant_summary"),
                        resultSet.getObject("warehouse_id", UUID.class),
                        resultSet.getString("warehouse_code"),
                        resultSet.getString("warehouse_name"),
                        resultSet.getLong("on_hand"),
                        resultSet.getLong("reserved"),
                        resultSet.getLong("available"),
                        resultSet.getLong("range_sales_quantity"),
                        resultSet.getLong("range_order_count"),
                        resultSet.getLong("today_sales_quantity"),
                        resultSet.getLong("yesterday_sales_quantity"),
                        resultSet.getLong("last_7_days_sales_quantity"),
                        resultSet.getLong("last_28_days_sales_quantity"),
                        resultSet.getLong("last_42_days_sales_quantity"),
                        resultSet.getObject(
                                "updated_at", OffsetDateTime.class).toInstant()));
        return new InventoryRealtimeSalesResult(
                items, totals.totalBalanceCount(), totals.totalOnHand(),
                totals.totalReserved(), totals.totalAvailable(),
                totals.totalRangeSalesQuantity());
    }

    private static String filtered(
            boolean allWarehouses, String keyword) {
        StringBuilder balanceWhere = new StringBuilder("""
                WHERE balance.tenant_id = :tenantId
                """);
        if (!allWarehouses) {
            balanceWhere.append(
                    " AND balance.warehouse_id IN (:warehouseScope)");
        }
        String keywordClause = keyword == null ? "" : """
                WHERE lower(report_rows.sku_code || ' '
                    || report_rows.sku_name || ' '
                    || report_rows.warehouse_code || ' '
                    || report_rows.warehouse_name)
                    LIKE :keyword ESCAPE '\\'
                """;
        return """
                WITH reservation_totals AS (
                    SELECT reservation.sku_id,
                           reservation.warehouse_id,
                           sum(reservation.quantity
                               - reservation.consumed_quantity
                               - reservation.released_quantity)::bigint
                               AS reserved
                      FROM tenant_inventory_reservations reservation
                     WHERE reservation.tenant_id = :tenantId
                     GROUP BY reservation.sku_id,
                              reservation.warehouse_id
                ), sales AS (
                    SELECT line.sku_id, line.warehouse_id,
                           coalesce(sum(line.quantity) FILTER (
                               WHERE orders.placed_at >= coalesce(
                                   :rangeFrom,
                                   CAST(:asOf AS timestamptz)
                                       - interval '42 days')
                           ), 0)::bigint AS range_sales_quantity,
                           count(DISTINCT orders.id) FILTER (
                               WHERE orders.placed_at >= coalesce(
                                   :rangeFrom,
                                   CAST(:asOf AS timestamptz)
                                       - interval '42 days')
                           )::bigint AS range_order_count,
                           coalesce(sum(line.quantity) FILTER (
                               WHERE orders.placed_at >= (
                                   date_trunc('day',
                                       CAST(:asOf AS timestamptz)
                                           AT TIME ZONE 'UTC')
                                       AT TIME ZONE 'UTC')
                           ), 0)::bigint AS today_sales_quantity,
                           coalesce(sum(line.quantity) FILTER (
                               WHERE orders.placed_at >= (
                                   date_trunc('day',
                                       CAST(:asOf AS timestamptz)
                                           AT TIME ZONE 'UTC')
                                       AT TIME ZONE 'UTC') - interval '1 day'
                                 AND orders.placed_at < (
                                   date_trunc('day',
                                       CAST(:asOf AS timestamptz)
                                           AT TIME ZONE 'UTC')
                                       AT TIME ZONE 'UTC')
                           ), 0)::bigint AS yesterday_sales_quantity,
                           coalesce(sum(line.quantity) FILTER (
                               WHERE orders.placed_at >=
                                   CAST(:asOf AS timestamptz)
                                       - interval '7 days'
                           ), 0)::bigint AS last_7_days_sales_quantity,
                           coalesce(sum(line.quantity) FILTER (
                               WHERE orders.placed_at >=
                                   CAST(:asOf AS timestamptz)
                                       - interval '28 days'
                           ), 0)::bigint AS last_28_days_sales_quantity,
                           coalesce(sum(line.quantity) FILTER (
                               WHERE orders.placed_at >=
                                   CAST(:asOf AS timestamptz)
                                       - interval '42 days'
                           ), 0)::bigint AS last_42_days_sales_quantity
                      FROM tenant_order_lines line
                      JOIN tenant_orders orders
                        ON orders.tenant_id = line.tenant_id
                       AND orders.id = line.order_id
                     WHERE line.tenant_id = :tenantId
                       AND line.sku_id IS NOT NULL
                       AND line.warehouse_id IS NOT NULL
                       AND orders.status <> 'CANCELLED'
                       AND orders.placed_at < :asOf
                       AND orders.placed_at >= least(
                           coalesce(:rangeFrom,
                               CAST(:asOf AS timestamptz)
                                   - interval '42 days'),
                           CAST(:asOf AS timestamptz)
                               - interval '42 days')
                     GROUP BY line.sku_id, line.warehouse_id
                ), report_rows AS (
                    SELECT balance.id AS balance_id,
                           balance.sku_id,
                           sku.business_code AS sku_code,
                           sku.name AS sku_name,
                           sku.variant_summary,
                           balance.warehouse_id,
                           warehouse.business_code AS warehouse_code,
                           warehouse.name AS warehouse_name,
                           balance.on_hand,
                           coalesce(reservation.reserved, 0)::bigint
                               AS reserved,
                           (balance.on_hand
                               - coalesce(reservation.reserved, 0))::bigint
                               AS available,
                           coalesce(sales.range_sales_quantity, 0)::bigint
                               AS range_sales_quantity,
                           coalesce(sales.range_order_count, 0)::bigint
                               AS range_order_count,
                           coalesce(sales.today_sales_quantity, 0)::bigint
                               AS today_sales_quantity,
                           coalesce(sales.yesterday_sales_quantity, 0)::bigint
                               AS yesterday_sales_quantity,
                           coalesce(sales.last_7_days_sales_quantity, 0)::bigint
                               AS last_7_days_sales_quantity,
                           coalesce(sales.last_28_days_sales_quantity, 0)::bigint
                               AS last_28_days_sales_quantity,
                           coalesce(sales.last_42_days_sales_quantity, 0)::bigint
                               AS last_42_days_sales_quantity,
                           balance.updated_at
                      FROM inventory_balances balance
                      JOIN tenant_product_skus sku
                        ON sku.tenant_id = balance.tenant_id
                       AND sku.id = balance.sku_id
                      JOIN tenant_warehouses warehouse
                        ON warehouse.tenant_id = balance.tenant_id
                       AND warehouse.id = balance.warehouse_id
                      LEFT JOIN reservation_totals reservation
                        ON reservation.sku_id = balance.sku_id
                       AND reservation.warehouse_id = balance.warehouse_id
                      LEFT JOIN sales
                        ON sales.sku_id = balance.sku_id
                       AND sales.warehouse_id = balance.warehouse_id
                """ + balanceWhere + """
                ), filtered AS (
                    SELECT * FROM report_rows
                """ + keywordClause + ") ";
    }

    private static String literalPattern(String value) {
        if (value == null) return null;
        return "%" + value.replace("\\", "\\\\")
                .replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private record Totals(
            long totalBalanceCount,
            long totalOnHand,
            long totalReserved,
            long totalAvailable,
            long totalRangeSalesQuantity) {
    }
}
