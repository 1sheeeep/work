package cn.xzkj.erp.logistics.statistics;

import cn.xzkj.erp.logistics.statistics.LogisticsStatisticsView.Dimension;
import cn.xzkj.erp.logistics.statistics.LogisticsStatisticsView.StatusCount;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class LogisticsStatisticsRepository {
    private static final String FROM = """
            FROM tenant_orders orders
            LEFT JOIN tenant_order_profiles profile
              ON profile.tenant_id = orders.tenant_id
             AND profile.order_id = orders.id
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public LogisticsStatisticsRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public LogisticsStatisticsResult summarize(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            Dimension dimension,
            String value,
            Instant shippedFrom,
            Instant shippedToExclusive,
            Pageable pageable) {
        String groupExpression = groupExpression(dimension);
        String filtered = filtered(
                groupExpression, allWarehouses, value, shippedFrom,
                shippedToExclusive);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("value", literalPattern(value))
                .addValue("shippedFrom", shippedFrom == null
                        ? null : Timestamp.from(shippedFrom))
                .addValue("shippedToExclusive", shippedToExclusive == null
                        ? null : Timestamp.from(shippedToExclusive))
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());

        Totals totals = jdbc.queryForObject(
                filtered + """
                        SELECT count(*) AS total_records,
                               (SELECT count(*)
                                  FROM (SELECT group_value
                                          FROM filtered
                                         GROUP BY group_value) grouped)
                                   AS total_groups
                          FROM filtered
                        """,
                parameters,
                (resultSet, rowNumber) -> new Totals(
                        resultSet.getLong("total_records"),
                        resultSet.getLong("total_groups")));
        if (totals == null || totals.totalGroups() == 0) {
            return LogisticsStatisticsResult.empty();
        }

        List<StatusCount> totalStatuses = jdbc.query(
                filtered + """
                        SELECT tracking_status,
                               count(*) AS status_record_count
                          FROM filtered
                         GROUP BY tracking_status
                         ORDER BY status_record_count DESC,
                                  tracking_status ASC NULLS LAST
                        """,
                parameters,
                (resultSet, rowNumber) -> new StatusCount(
                        resultSet.getString("tracking_status"),
                        resultSet.getLong("status_record_count")));

        List<GroupStatusRow> rows = jdbc.query(
                filtered + """
                        , selected_groups AS (
                            SELECT group_value, count(*) AS record_count
                              FROM filtered
                             GROUP BY group_value
                             ORDER BY record_count DESC, group_value ASC NULLS LAST
                             LIMIT :limit OFFSET :offset
                        )
                        SELECT selected.group_value,
                               selected.record_count,
                               filtered.tracking_status,
                               count(*) AS status_record_count
                          FROM selected_groups selected
                          JOIN filtered
                            ON filtered.group_value IS NOT DISTINCT FROM selected.group_value
                         GROUP BY selected.group_value, selected.record_count,
                                  filtered.tracking_status
                         ORDER BY selected.record_count DESC,
                                  selected.group_value ASC NULLS LAST,
                                  status_record_count DESC,
                                  filtered.tracking_status ASC NULLS LAST
                        """,
                parameters,
                (resultSet, rowNumber) -> new GroupStatusRow(
                        resultSet.getString("group_value"),
                        resultSet.getLong("record_count"),
                        resultSet.getString("tracking_status"),
                        resultSet.getLong("status_record_count")));

        Map<String, GroupAccumulator> groups = new LinkedHashMap<>();
        for (GroupStatusRow row : rows) {
            GroupAccumulator group = groups.computeIfAbsent(
                    row.groupValue(),
                    ignored -> new GroupAccumulator(
                            row.groupValue(), row.recordCount()));
            group.statuses().add(new StatusCount(
                    row.trackingStatus(), row.statusRecordCount()));
        }
        List<LogisticsStatisticsView> items = groups.values().stream()
                .map(group -> new LogisticsStatisticsView(
                        group.groupValue(), group.recordCount(),
                        group.statuses()))
                .toList();
        return new LogisticsStatisticsResult(
                items, totalStatuses, totals.totalRecords(),
                totals.totalGroups());
    }

    private static String filtered(
            String groupExpression,
            boolean allWarehouses,
            String value,
            Instant shippedFrom,
            Instant shippedToExclusive) {
        StringBuilder where = new StringBuilder("""
                WHERE orders.tenant_id = :tenantId
                  AND (
                    nullif(btrim(profile.tracking_reference), '') IS NOT NULL
                    OR nullif(btrim(profile.secondary_tracking_reference), '') IS NOT NULL
                  )
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
        if (value != null) {
            where.append(" AND lower(coalesce(")
                    .append(groupExpression)
                    .append(", '')) LIKE :value ESCAPE '\\'");
        }
        if (shippedFrom != null) {
            where.append(" AND orders.shipped_at >= :shippedFrom");
        }
        if (shippedToExclusive != null) {
            where.append(" AND orders.shipped_at < :shippedToExclusive");
        }
        return "WITH filtered AS (SELECT " + groupExpression
                + " AS group_value,"
                + " nullif(upper(btrim(orders.tracking_status)), '')"
                + " AS tracking_status " + FROM + where + ") ";
    }

    private static String groupExpression(Dimension dimension) {
        return dimension == Dimension.CHANNEL
                ? "coalesce(nullif(btrim(orders.logistics_channel), ''),"
                    + " nullif(btrim(profile.shipping_service), ''))"
                : "nullif(upper(btrim(orders.country_code)), '')";
    }

    private static String literalPattern(String value) {
        if (value == null) return null;
        return "%" + value.replace("\\", "\\\\")
                .replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private record Totals(long totalRecords, long totalGroups) {}

    private record GroupStatusRow(
            String groupValue,
            long recordCount,
            String trackingStatus,
            long statusRecordCount) {}

    private record GroupAccumulator(
            String groupValue,
            long recordCount,
            List<StatusCount> statuses) {
        private GroupAccumulator(String groupValue, long recordCount) {
            this(groupValue, recordCount, new ArrayList<>());
        }
    }
}
