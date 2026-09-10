package cn.xzkj.erp.logistics.tracking;

import cn.xzkj.erp.logistics.tracking.LogisticsTrackingView.PackageStatus;
import cn.xzkj.erp.logistics.tracking.LogisticsTrackingView.SearchField;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class LogisticsTrackingRepository {
    private static final String FROM = """
            FROM tenant_orders orders
            JOIN tenant_shops shop
              ON shop.tenant_id = orders.tenant_id
             AND shop.id = orders.shop_id
            JOIN platform_catalog platform
              ON platform.id = shop.platform_id
            LEFT JOIN tenant_order_profiles profile
              ON profile.tenant_id = orders.tenant_id
             AND profile.order_id = orders.id
            LEFT JOIN LATERAL (
                SELECT string_agg(
                           DISTINCT warehouse.business_code || ' · ' || warehouse.name,
                           ', ' ORDER BY warehouse.business_code || ' · ' || warehouse.name)
                           AS display_name
                FROM tenant_order_warehouse_facts fact
                JOIN tenant_warehouses warehouse
                  ON warehouse.tenant_id = fact.tenant_id
                 AND warehouse.id = fact.warehouse_id
                WHERE fact.tenant_id = orders.tenant_id
                  AND fact.order_id = orders.id
            ) warehouse_summary ON true
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public LogisticsTrackingRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Page<LogisticsTrackingView> list(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            String shop,
            String carrier,
            String country,
            String warehouse,
            String category,
            SearchField searchField,
            String keyword,
            PackageStatus status,
            Instant shippedFrom,
            Instant shippedTo,
            Pageable pageable) {
        String where = where(
                allWarehouses, shop, carrier, country, warehouse, category,
                searchField, keyword, status, shippedFrom, shippedTo);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("shop", literalPattern(shop))
                .addValue("carrier", literalPattern(carrier))
                .addValue("country", country)
                .addValue("warehouse", literalPattern(warehouse))
                .addValue("category", literalPattern(category))
                .addValue("keyword", literalPattern(keyword))
                .addValue("status", status == null ? null : status.name())
                .addValue("shippedFrom", shippedFrom == null
                        ? null : Timestamp.from(shippedFrom))
                .addValue("shippedTo", shippedTo == null
                        ? null : Timestamp.from(shippedTo))
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<LogisticsTrackingView> rows = jdbc.query(
                """
                SELECT orders.id AS order_id,
                       platform.code AS platform_code,
                       platform.display_name AS platform_name,
                       shop.display_name AS shop_name,
                       orders.external_order_ref AS order_no,
                       orders.country_code,
                       warehouse_summary.display_name AS warehouse_summary,
                       coalesce(nullif(btrim(orders.logistics_channel), ''),
                                nullif(btrim(profile.shipping_service), ''))
                           AS logistics_channel,
                       nullif(btrim(profile.tracking_reference), '')
                           AS tracking_reference,
                       nullif(btrim(profile.secondary_tracking_reference), '')
                           AS secondary_tracking_reference,
                       nullif(btrim(orders.tracking_status), '') AS tracking_status,
                       nullif(btrim(orders.fixed_category), '') AS fixed_category,
                       nullif(btrim(orders.custom_category), '') AS custom_category,
                       orders.shipped_at,
                       orders.updated_at
                """ + FROM + where
                        + " ORDER BY coalesce(orders.shipped_at, orders.updated_at) DESC,"
                        + " orders.id DESC LIMIT :limit OFFSET :offset",
                parameters,
                LogisticsTrackingRepository::map);
        Long total = jdbc.queryForObject(
                "SELECT count(*) " + FROM + where,
                parameters,
                Long.class);
        return new PageImpl<>(rows, pageable, total == null ? 0 : total);
    }

    private static String where(
            boolean allWarehouses,
            String shop,
            String carrier,
            String country,
            String warehouse,
            String category,
            SearchField searchField,
            String keyword,
            PackageStatus status,
            Instant shippedFrom,
            Instant shippedTo) {
        StringBuilder result = new StringBuilder("""
                WHERE orders.tenant_id = :tenantId
                  AND (
                    nullif(btrim(profile.tracking_reference), '') IS NOT NULL
                    OR nullif(btrim(profile.secondary_tracking_reference), '') IS NOT NULL
                  )
                """);
        if (!allWarehouses) {
            result.append("""
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
        contains(result, "lower(platform.display_name || ' ' || shop.display_name)",
                "shop", shop);
        contains(result,
                "lower(coalesce(orders.logistics_channel, '') || ' '"
                        + " || coalesce(profile.shipping_service, ''))",
                "carrier", carrier);
        if (country != null) result.append(" AND upper(orders.country_code) = :country");
        contains(result, "lower(coalesce(warehouse_summary.display_name, ''))",
                "warehouse", warehouse);
        contains(result,
                "lower(coalesce(orders.fixed_category, '') || ' '"
                        + " || coalesce(orders.custom_category, ''))",
                "category", category);
        if (keyword != null) {
            result.append(searchField == SearchField.TRACKING_NO
                    ? " AND lower(coalesce(profile.tracking_reference, '') || ' ' || coalesce(profile.secondary_tracking_reference, '')) LIKE :keyword ESCAPE '\\'"
                    : " AND lower(orders.external_order_ref) LIKE :keyword ESCAPE '\\'");
        }
        if (status != null) {
            result.append(" AND upper(btrim(orders.tracking_status)) = :status");
        }
        if (shippedFrom != null) result.append(" AND orders.shipped_at >= :shippedFrom");
        if (shippedTo != null) result.append(" AND orders.shipped_at <= :shippedTo");
        return result.toString();
    }

    private static void contains(
            StringBuilder where, String expression, String parameter, String value) {
        if (value != null) {
            where.append(" AND ").append(expression)
                    .append(" LIKE :").append(parameter).append(" ESCAPE '\\'");
        }
    }

    private static String literalPattern(String value) {
        if (value == null) return null;
        return "%" + value.replace("\\", "\\\\")
                .replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private static LogisticsTrackingView map(ResultSet resultSet, int rowNumber)
            throws SQLException {
        return new LogisticsTrackingView(
                resultSet.getObject("order_id", UUID.class),
                resultSet.getString("platform_code"),
                resultSet.getString("platform_name"),
                resultSet.getString("shop_name"),
                resultSet.getString("order_no"),
                resultSet.getString("country_code"),
                resultSet.getString("warehouse_summary"),
                resultSet.getString("logistics_channel"),
                resultSet.getString("tracking_reference"),
                resultSet.getString("secondary_tracking_reference"),
                resultSet.getString("tracking_status"),
                resultSet.getString("fixed_category"),
                resultSet.getString("custom_category"),
                instant(resultSet, "shipped_at"),
                instant(resultSet, "updated_at"));
    }

    private static Instant instant(ResultSet resultSet, String column)
            throws SQLException {
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
