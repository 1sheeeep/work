package cn.xzkj.erp.analytics.listingsales;

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
public class ListingRealtimeSalesRepository {
    private final NamedParameterJdbcTemplate jdbc;

    public ListingRealtimeSalesRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public ListingRealtimeSalesResult summarize(
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
                        SELECT count(*) AS total_listings,
                               coalesce(sum(range_sales_quantity), 0)
                                   AS total_range_sales_quantity
                          FROM filtered
                        """,
                parameters,
                (resultSet, rowNumber) -> new Totals(
                        resultSet.getLong("total_listings"),
                        resultSet.getLong("total_range_sales_quantity")));
        if (totals == null || totals.totalListingCount() == 0) {
            return ListingRealtimeSalesResult.empty();
        }

        List<ListingRealtimeSalesItem> items = jdbc.query(
                filtered + """
                        SELECT listing_id, platform_code, platform_name,
                               shop_id, shop_name, external_listing_ref,
                               external_variant_ref, sku_id, sku_code,
                               sku_name, variant_summary,
                               range_sales_quantity, range_order_count,
                               today_sales_quantity,
                               yesterday_sales_quantity,
                               last_7_days_sales_quantity,
                               last_28_days_sales_quantity,
                               last_42_days_sales_quantity,
                               last_placed_at
                          FROM filtered
                         ORDER BY range_sales_quantity DESC,
                                  platform_code ASC, shop_name ASC,
                                  external_listing_ref ASC, listing_id ASC
                         LIMIT :limit OFFSET :offset
                        """,
                parameters,
                (resultSet, rowNumber) -> new ListingRealtimeSalesItem(
                        resultSet.getObject("listing_id", UUID.class),
                        resultSet.getString("platform_code"),
                        resultSet.getString("platform_name"),
                        resultSet.getObject("shop_id", UUID.class),
                        resultSet.getString("shop_name"),
                        resultSet.getString("external_listing_ref"),
                        resultSet.getString("external_variant_ref"),
                        resultSet.getObject("sku_id", UUID.class),
                        resultSet.getString("sku_code"),
                        resultSet.getString("sku_name"),
                        resultSet.getString("variant_summary"),
                        resultSet.getLong("range_sales_quantity"),
                        resultSet.getLong("range_order_count"),
                        resultSet.getLong("today_sales_quantity"),
                        resultSet.getLong("yesterday_sales_quantity"),
                        resultSet.getLong("last_7_days_sales_quantity"),
                        resultSet.getLong("last_28_days_sales_quantity"),
                        resultSet.getLong("last_42_days_sales_quantity"),
                        instant(resultSet.getObject(
                                "last_placed_at", OffsetDateTime.class))));
        return new ListingRealtimeSalesResult(
                items, totals.totalListingCount(),
                totals.totalRangeSalesQuantity());
    }

    private static String filtered(boolean allWarehouses, String keyword) {
        StringBuilder salesWhere = new StringBuilder("""
                WHERE orders.tenant_id = :tenantId
                  AND orders.status <> 'CANCELLED'
                  AND orders.placed_at < :asOf
                  AND orders.placed_at >= least(
                      coalesce(:rangeFrom,
                          CAST(:asOf AS timestamptz) - interval '42 days'),
                      CAST(:asOf AS timestamptz) - interval '42 days')
                """);
        if (!allWarehouses) {
            salesWhere.append("""
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
        String keywordClause = keyword == null ? "" : """
                WHERE lower(platform_code || ' ' || platform_name || ' '
                    || shop_name || ' ' || external_listing_ref || ' '
                    || coalesce(external_variant_ref, '') || ' '
                    || sku_code || ' ' || sku_name)
                    LIKE :keyword ESCAPE '\\'
                """;
        return """
                WITH unique_mappings AS (
                    SELECT listing.tenant_id, listing.shop_id, listing.sku_id,
                           min(listing.id::text)::uuid AS listing_id
                      FROM tenant_product_listings listing
                     WHERE listing.tenant_id = :tenantId
                     GROUP BY listing.tenant_id, listing.shop_id,
                              listing.sku_id
                    HAVING count(*) = 1
                ), sales AS (
                    SELECT listing.id AS listing_id,
                           platform.code AS platform_code,
                           platform.display_name AS platform_name,
                           shop.id AS shop_id,
                           shop.display_name AS shop_name,
                           listing.external_listing_ref,
                           listing.external_variant_ref,
                           sku.id AS sku_id,
                           sku.business_code AS sku_code,
                           sku.name AS sku_name,
                           sku.variant_summary,
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
                           ), 0)::bigint AS last_42_days_sales_quantity,
                           max(orders.placed_at) AS last_placed_at
                      FROM tenant_order_lines line
                      JOIN tenant_orders orders
                        ON orders.tenant_id = line.tenant_id
                       AND orders.id = line.order_id
                      JOIN unique_mappings mapping
                        ON mapping.tenant_id = line.tenant_id
                       AND mapping.shop_id = orders.shop_id
                       AND mapping.sku_id = line.sku_id
                      JOIN tenant_product_listings listing
                        ON listing.tenant_id = mapping.tenant_id
                       AND listing.id = mapping.listing_id
                      JOIN tenant_product_skus sku
                        ON sku.tenant_id = listing.tenant_id
                       AND sku.id = listing.sku_id
                      JOIN tenant_shops shop
                        ON shop.tenant_id = listing.tenant_id
                       AND shop.id = listing.shop_id
                      JOIN platform_catalog platform
                        ON platform.id = listing.platform_id
                """ + salesWhere + """
                     GROUP BY listing.id, platform.code,
                              platform.display_name, shop.id,
                              shop.display_name, listing.external_listing_ref,
                              listing.external_variant_ref, sku.id,
                              sku.business_code, sku.name,
                              sku.variant_summary
                ), filtered AS (
                    SELECT * FROM sales
                """ + keywordClause + ") ";
    }

    private static String literalPattern(String value) {
        if (value == null) return null;
        return "%" + value.replace("\\", "\\\\")
                .replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private static Instant instant(OffsetDateTime value) {
        return value.withOffsetSameInstant(ZoneOffset.UTC).toInstant();
    }

    private record Totals(
            long totalListingCount,
            long totalRangeSalesQuantity) {
    }
}
