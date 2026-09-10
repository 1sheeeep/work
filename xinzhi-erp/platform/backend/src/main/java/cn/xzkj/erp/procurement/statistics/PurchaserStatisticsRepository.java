package cn.xzkj.erp.procurement.statistics;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class PurchaserStatisticsRepository {
    private final NamedParameterJdbcTemplate jdbc;

    public PurchaserStatisticsRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public PurchaserStatisticsResult summarize(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            PurchaserStatisticsGranularity granularity,
            String purchaser,
            Instant orderedFrom,
            Instant orderedToExclusive,
            Pageable pageable) {
        String filtered = filtered(
                allWarehouses, purchaser, orderedFrom, orderedToExclusive);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("granularity", granularity.name())
                .addValue("purchaser", literalPattern(purchaser))
                .addValue("orderedFrom", orderedFrom == null
                        ? null : Timestamp.from(orderedFrom))
                .addValue("orderedToExclusive", orderedToExclusive == null
                        ? null : Timestamp.from(orderedToExclusive))
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());

        Totals totals = jdbc.queryForObject(
                filtered + """
                        SELECT count(*) AS total_orders,
                               coalesce(sum(quantity), 0) AS total_ordered,
                               coalesce(sum(received_quantity), 0)
                                   AS total_received,
                               coalesce(sum(quantity - received_quantity), 0)
                                   AS total_outstanding,
                               (
                                 SELECT count(*)
                                 FROM (
                                   SELECT 1
                                   FROM filtered grouped
                                   GROUP BY grouped.period_start,
                                            grouped.purchaser_display_name
                                 ) report_groups
                               ) AS total_groups
                          FROM filtered
                        """,
                parameters,
                (resultSet, rowNumber) -> new Totals(
                        resultSet.getLong("total_orders"),
                        resultSet.getLong("total_ordered"),
                        resultSet.getLong("total_received"),
                        resultSet.getLong("total_outstanding"),
                        resultSet.getLong("total_groups")));
        if (totals == null || totals.totalGroups() == 0) {
            return PurchaserStatisticsResult.empty();
        }

        List<PurchaserStatisticsView> items = jdbc.query(
                filtered + """
                        SELECT period_start, purchaser_display_name,
                               count(*) AS order_count,
                               sum(quantity) AS ordered_quantity,
                               sum(received_quantity) AS received_quantity,
                               sum(quantity - received_quantity)
                                   AS outstanding_quantity,
                               count(*) FILTER (WHERE status = 'NEW_ORDER')
                                   AS new_order_count,
                               count(*) FILTER (WHERE status = 'APPROVED')
                                   AS approved_order_count,
                               count(*) FILTER (
                                   WHERE status = 'PARTIALLY_RECEIVED')
                                   AS partially_received_order_count,
                               count(*) FILTER (WHERE status = 'RECEIVED')
                                   AS received_order_count
                          FROM filtered
                         GROUP BY period_start, purchaser_display_name
                         ORDER BY period_start DESC,
                                  purchaser_display_name ASC
                         LIMIT :limit OFFSET :offset
                        """,
                parameters,
                (resultSet, rowNumber) -> new PurchaserStatisticsView(
                        resultSet.getObject("period_start", LocalDate.class),
                        resultSet.getString("purchaser_display_name"),
                        resultSet.getLong("order_count"),
                        resultSet.getLong("ordered_quantity"),
                        resultSet.getLong("received_quantity"),
                        resultSet.getLong("outstanding_quantity"),
                        resultSet.getLong("new_order_count"),
                        resultSet.getLong("approved_order_count"),
                        resultSet.getLong("partially_received_order_count"),
                        resultSet.getLong("received_order_count")));
        return new PurchaserStatisticsResult(
                items, totals.totalOrders(), totals.totalOrderedQuantity(),
                totals.totalReceivedQuantity(), totals.totalOutstandingQuantity(),
                totals.totalGroups());
    }

    private static String filtered(
            boolean allWarehouses,
            String purchaser,
            Instant orderedFrom,
            Instant orderedToExclusive) {
        StringBuilder where = new StringBuilder("""
                WHERE purchase_order.tenant_id = :tenantId
                  AND purchase_order.status <> 'REJECTED'
                """);
        if (!allWarehouses) {
            where.append(" AND purchase_order.warehouse_id IN (:warehouseScope)");
        }
        if (purchaser != null) {
            where.append("""
                    AND lower(purchase_order.ordered_by_display_name)
                        LIKE :purchaser ESCAPE '\\'
                    """);
        }
        if (orderedFrom != null) {
            where.append(" AND purchase_order.created_at >= :orderedFrom");
        }
        if (orderedToExclusive != null) {
            where.append(" AND purchase_order.created_at < :orderedToExclusive");
        }
        return """
                WITH filtered AS (
                    SELECT CASE :granularity
                             WHEN 'MONTH' THEN date_trunc(
                                 'month', purchase_order.created_at
                                          AT TIME ZONE 'UTC')::date
                             ELSE (purchase_order.created_at
                                   AT TIME ZONE 'UTC')::date
                           END AS period_start,
                           purchase_order.ordered_by_display_name
                               AS purchaser_display_name,
                           purchase_order.status,
                           purchase_order.quantity,
                           purchase_order.received_quantity
                      FROM procurement_purchase_orders purchase_order
                """ + where + ") ";
    }

    private static String literalPattern(String value) {
        if (value == null) return null;
        return "%" + value.toLowerCase(Locale.ROOT)
                .replace("\\", "\\\\")
                .replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private record Totals(
            long totalOrders,
            long totalOrderedQuantity,
            long totalReceivedQuantity,
            long totalOutstandingQuantity,
            long totalGroups) {}
}
