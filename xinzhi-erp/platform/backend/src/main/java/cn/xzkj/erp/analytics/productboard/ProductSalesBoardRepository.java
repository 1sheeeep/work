package cn.xzkj.erp.analytics.productboard;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ProductSalesBoardRepository {
    private final NamedParameterJdbcTemplate jdbc;

    public ProductSalesBoardRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public ProductSalesBoardResult summarize(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            Instant rangeFrom,
            Instant observedAt,
            int limit) {
        String candidates = candidates(allWarehouses);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("rangeFrom", Timestamp.from(rangeFrom))
                .addValue("observedAt", Timestamp.from(observedAt))
                .addValue("limit", limit);

        Totals totals = jdbc.queryForObject(
                candidates + """
                        SELECT count(*) AS active_sku_count,
                               count(*) FILTER (WHERE sales_quantity > 0)
                                   AS sold_sku_count,
                               coalesce(sum(sales_quantity), 0)
                                   AS sales_quantity
                          FROM candidates
                        """,
                parameters,
                (resultSet, rowNumber) -> new Totals(
                        resultSet.getLong("active_sku_count"),
                        resultSet.getLong("sold_sku_count"),
                        resultSet.getLong("sales_quantity")));
        if (totals == null || totals.activeSkuCount() == 0) {
            return ProductSalesBoardResult.empty();
        }

        List<ProductSalesBoardItem> hotItems = list(
                candidates + """
                        SELECT * FROM candidates
                         WHERE sales_quantity > 0
                         ORDER BY sales_quantity DESC, order_count DESC,
                                  sku_code ASC, sku_id ASC
                         LIMIT :limit
                        """,
                parameters);
        List<ProductSalesBoardItem> lowItems = list(
                candidates + """
                        SELECT * FROM candidates
                         ORDER BY sales_quantity ASC,
                                  last_placed_at ASC NULLS FIRST,
                                  sku_code ASC, sku_id ASC
                         LIMIT :limit
                        """,
                parameters);
        return new ProductSalesBoardResult(
                hotItems, lowItems, totals.activeSkuCount(),
                totals.soldSkuCount(), totals.salesQuantity());
    }

    private List<ProductSalesBoardItem> list(
            String sql, MapSqlParameterSource parameters) {
        return jdbc.query(sql, parameters, (resultSet, rowNumber) ->
                new ProductSalesBoardItem(
                        resultSet.getObject("sku_id", UUID.class),
                        resultSet.getString("sku_code"),
                        resultSet.getString("sku_name"),
                        resultSet.getString("variant_summary"),
                        resultSet.getLong("order_count"),
                        resultSet.getLong("sales_quantity"),
                        nullableInstant(resultSet.getObject(
                                "last_placed_at", OffsetDateTime.class))));
    }

    private static String candidates(boolean allWarehouses) {
        StringBuilder salesScope = new StringBuilder();
        String candidateScope = "";
        if (!allWarehouses) {
            salesScope.append("""
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
            candidateScope = """
                    AND (
                      sales.sku_id IS NOT NULL
                      OR EXISTS (
                        SELECT 1 FROM inventory_balances balance
                         WHERE balance.tenant_id = sku.tenant_id
                           AND balance.sku_id = sku.id
                           AND balance.warehouse_id IN (:warehouseScope)
                      )
                    )
                    """;
        }
        return """
                WITH sales AS (
                    SELECT line.sku_id,
                           count(DISTINCT orders.id)::bigint AS order_count,
                           coalesce(sum(line.quantity), 0)::bigint
                               AS sales_quantity,
                           max(orders.placed_at) AS last_placed_at
                      FROM tenant_order_lines line
                      JOIN tenant_orders orders
                        ON orders.tenant_id = line.tenant_id
                       AND orders.id = line.order_id
                     WHERE orders.tenant_id = :tenantId
                       AND orders.status <> 'CANCELLED'
                       AND orders.placed_at >= :rangeFrom
                       AND orders.placed_at < :observedAt
                """ + salesScope + """
                     GROUP BY line.sku_id
                ), candidates AS (
                    SELECT sku.id AS sku_id,
                           sku.business_code AS sku_code,
                           sku.name AS sku_name,
                           sku.variant_summary,
                           coalesce(sales.order_count, 0)::bigint
                               AS order_count,
                           coalesce(sales.sales_quantity, 0)::bigint
                               AS sales_quantity,
                           sales.last_placed_at
                      FROM tenant_product_skus sku
                      JOIN tenant_product_spus spu
                        ON spu.tenant_id = sku.tenant_id
                       AND spu.id = sku.spu_id
                      LEFT JOIN sales ON sales.sku_id = sku.id
                     WHERE sku.tenant_id = :tenantId
                       AND sku.status = 'ACTIVE'
                       AND spu.status = 'ACTIVE'
                """ + candidateScope + ") ";
    }

    private static Instant nullableInstant(OffsetDateTime value) {
        return value == null
                ? null
                : value.withOffsetSameInstant(ZoneOffset.UTC).toInstant();
    }

    private record Totals(
            long activeSkuCount,
            long soldSkuCount,
            long salesQuantity) {
    }
}
