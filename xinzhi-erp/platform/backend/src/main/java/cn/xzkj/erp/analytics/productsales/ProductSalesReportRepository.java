package cn.xzkj.erp.analytics.productsales;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ProductSalesReportRepository {
    private final NamedParameterJdbcTemplate jdbc;

    public ProductSalesReportRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public ProductSalesReportResult summarize(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            String keyword,
            Instant placedFrom,
            Instant placedToExclusive,
            Pageable pageable) {
        String filtered = filtered(
                allWarehouses, keyword, placedFrom, placedToExclusive);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("keyword", literalPattern(keyword))
                .addValue("placedFrom", placedFrom == null
                        ? null : Timestamp.from(placedFrom))
                .addValue("placedToExclusive", placedToExclusive == null
                        ? null : Timestamp.from(placedToExclusive))
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());

        Totals totals = jdbc.queryForObject(
                filtered + """
                        SELECT count(*) AS total_skus,
                               coalesce(sum(sales_quantity), 0)
                                   AS total_sales_quantity
                          FROM filtered
                        """,
                parameters,
                (resultSet, rowNumber) -> new Totals(
                        resultSet.getLong("total_skus"),
                        resultSet.getLong("total_sales_quantity")));
        if (totals == null || totals.totalSkuCount() == 0) {
            return ProductSalesReportResult.empty();
        }

        List<ProductSalesReportItem> items = jdbc.query(
                filtered + """
                        SELECT sku_id, sku_code, sku_name, variant_summary,
                               order_count, sales_quantity,
                               first_placed_at, last_placed_at
                          FROM filtered
                         ORDER BY sales_quantity DESC, sku_code ASC, sku_id ASC
                         LIMIT :limit OFFSET :offset
                        """,
                parameters,
                (resultSet, rowNumber) -> new ProductSalesReportItem(
                        resultSet.getObject("sku_id", UUID.class),
                        resultSet.getString("sku_code"),
                        resultSet.getString("sku_name"),
                        resultSet.getString("variant_summary"),
                        resultSet.getLong("order_count"),
                        resultSet.getLong("sales_quantity"),
                        instant(resultSet.getObject(
                                "first_placed_at", OffsetDateTime.class)),
                        instant(resultSet.getObject(
                                "last_placed_at", OffsetDateTime.class))));
        return new ProductSalesReportResult(
                items, totals.totalSkuCount(), totals.totalSalesQuantity());
    }

    private static String filtered(
            boolean allWarehouses,
            String keyword,
            Instant placedFrom,
            Instant placedToExclusive) {
        StringBuilder where = new StringBuilder("""
                WHERE orders.tenant_id = :tenantId
                  AND orders.status <> 'CANCELLED'
                """);
        if (!allWarehouses) {
            where.append("""
                    AND EXISTS (
                      SELECT 1 FROM tenant_order_warehouse_facts scoped_fact
                      WHERE scoped_fact.tenant_id = orders.tenant_id
                        AND scoped_fact.order_id = orders.id
                    )
                    AND NOT EXISTS (
                      SELECT 1 FROM tenant_order_warehouse_facts scoped_fact
                      WHERE scoped_fact.tenant_id = orders.tenant_id
                        AND scoped_fact.order_id = orders.id
                        AND scoped_fact.warehouse_id NOT IN (:warehouseScope)
                    )
                    """);
        }
        if (keyword != null) {
            where.append("""
                    AND lower(sku.business_code || ' ' || sku.name)
                        LIKE :keyword ESCAPE '\\'
                    """);
        }
        if (placedFrom != null) {
            where.append(" AND orders.placed_at >= :placedFrom");
        }
        if (placedToExclusive != null) {
            where.append(" AND orders.placed_at < :placedToExclusive");
        }
        return """
                WITH filtered AS (
                    SELECT sku.id AS sku_id,
                           sku.business_code AS sku_code,
                           sku.name AS sku_name,
                           sku.variant_summary,
                           count(DISTINCT orders.id) AS order_count,
                           sum(line.quantity) AS sales_quantity,
                           min(orders.placed_at) AS first_placed_at,
                           max(orders.placed_at) AS last_placed_at
                      FROM tenant_order_lines line
                      JOIN tenant_orders orders
                        ON orders.tenant_id = line.tenant_id
                       AND orders.id = line.order_id
                      JOIN tenant_product_skus sku
                        ON sku.tenant_id = line.tenant_id
                       AND sku.id = line.sku_id
                """ + where + """
                     GROUP BY sku.id, sku.business_code, sku.name,
                              sku.variant_summary
                )
                """;
    }

    private static String literalPattern(String value) {
        if (value == null) return null;
        return "%" + value.replace("\\", "\\\\")
                .replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private static Instant instant(OffsetDateTime value) {
        return value.withOffsetSameInstant(ZoneOffset.UTC).toInstant();
    }

    private record Totals(long totalSkuCount, long totalSalesQuantity) {
    }
}
