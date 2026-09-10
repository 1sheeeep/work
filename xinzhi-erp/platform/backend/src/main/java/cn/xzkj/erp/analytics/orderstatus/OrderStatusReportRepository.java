package cn.xzkj.erp.analytics.orderstatus;

import cn.xzkj.erp.analytics.orderstatus.OrderStatusReportView.StatusCount;
import cn.xzkj.erp.order.domain.OrderStatus;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
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
public class OrderStatusReportRepository {
    private final NamedParameterJdbcTemplate jdbc;

    public OrderStatusReportRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public OrderStatusReportResult summarize(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            String shop,
            Instant placedFrom,
            Instant placedToExclusive,
            Pageable pageable) {
        String filtered = filtered(
                allWarehouses, shop, placedFrom, placedToExclusive);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("shop", literalPattern(shop))
                .addValue("placedFrom", placedFrom == null
                        ? null : Timestamp.from(placedFrom))
                .addValue("placedToExclusive", placedToExclusive == null
                        ? null : Timestamp.from(placedToExclusive))
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());

        Totals totals = jdbc.queryForObject(
                filtered + """
                        SELECT count(*) AS total_orders,
                               count(DISTINCT report_date) AS total_days
                          FROM filtered
                        """,
                parameters,
                (resultSet, rowNumber) -> new Totals(
                        resultSet.getLong("total_orders"),
                        resultSet.getLong("total_days")));
        if (totals == null || totals.totalDays() == 0) {
            return OrderStatusReportResult.empty();
        }

        List<DayStatusRow> rows = jdbc.query(
                filtered + """
                        , selected_days AS (
                            SELECT report_date, count(*) AS order_count
                              FROM filtered
                             GROUP BY report_date
                             ORDER BY report_date DESC
                             LIMIT :limit OFFSET :offset
                        )
                        SELECT selected.report_date,
                               selected.order_count,
                               filtered.status,
                               count(*) AS status_order_count
                          FROM selected_days selected
                          JOIN filtered USING (report_date)
                         GROUP BY selected.report_date, selected.order_count,
                                  filtered.status
                         ORDER BY selected.report_date DESC,
                                  status_order_count DESC,
                                  filtered.status ASC
                        """,
                parameters,
                (resultSet, rowNumber) -> new DayStatusRow(
                        resultSet.getObject("report_date", LocalDate.class),
                        resultSet.getLong("order_count"),
                        OrderStatus.valueOf(resultSet.getString("status")),
                        resultSet.getLong("status_order_count")));

        Map<LocalDate, DayAccumulator> days = new LinkedHashMap<>();
        for (DayStatusRow row : rows) {
            DayAccumulator day = days.computeIfAbsent(
                    row.reportDate(),
                    ignored -> new DayAccumulator(
                            row.reportDate(), row.orderCount()));
            day.statuses().add(new StatusCount(
                    row.status(), row.statusOrderCount()));
        }
        List<OrderStatusReportView> items = days.values().stream()
                .map(day -> new OrderStatusReportView(
                        day.reportDate(), day.orderCount(), day.statuses()))
                .toList();
        return new OrderStatusReportResult(
                items, totals.totalOrders(), totals.totalDays());
    }

    private static String filtered(
            boolean allWarehouses,
            String shop,
            Instant placedFrom,
            Instant placedToExclusive) {
        StringBuilder where = new StringBuilder("""
                WHERE orders.tenant_id = :tenantId
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
        if (shop != null) {
            where.append("""
                    AND lower(platform.display_name || ' ' || shop.display_name)
                        LIKE :shop ESCAPE '\\'
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
                    SELECT (orders.placed_at AT TIME ZONE 'UTC')::date
                               AS report_date,
                           orders.status
                      FROM tenant_orders orders
                      JOIN tenant_shops shop
                        ON shop.tenant_id = orders.tenant_id
                       AND shop.id = orders.shop_id
                      JOIN platform_catalog platform
                        ON platform.id = shop.platform_id
                """ + where + ") ";
    }

    private static String literalPattern(String value) {
        if (value == null) return null;
        return "%" + value.replace("\\", "\\\\")
                .replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private record Totals(long totalOrders, long totalDays) {}

    private record DayStatusRow(
            LocalDate reportDate,
            long orderCount,
            OrderStatus status,
            long statusOrderCount) {}

    private record DayAccumulator(
            LocalDate reportDate,
            long orderCount,
            List<StatusCount> statuses) {
        private DayAccumulator(LocalDate reportDate, long orderCount) {
            this(reportDate, orderCount, new ArrayList<>());
        }
    }
}
