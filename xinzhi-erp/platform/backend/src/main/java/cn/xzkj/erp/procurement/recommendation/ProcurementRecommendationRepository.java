package cn.xzkj.erp.procurement.recommendation;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ProcurementRecommendationRepository {
    static final int SALES_WINDOW_DAYS = 28;
    static final int DEFAULT_LEAD_TIME_DAYS = 28;
    static final int SAFETY_DAYS = 7;

    private final NamedParameterJdbcTemplate jdbc;

    public ProcurementRecommendationRepository(
            NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public ProcurementRecommendationResult summarize(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            String supplier,
            String keyword,
            boolean hideWithoutSupplier,
            boolean hideZeroRecommendation,
            Instant asOf,
            Pageable pageable) {
        String sql = recommendations(allWarehouses);
        String filter = filter(
                supplier, keyword, hideWithoutSupplier,
                hideZeroRecommendation);
        MapSqlParameterSource parameters = parameters(
                tenantId, warehouseScope, supplier, keyword, asOf)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());

        Totals totals = jdbc.queryForObject(
                sql + filter + """
                        SELECT count(*)::bigint AS total_elements,
                               count(*) FILTER (
                                   WHERE recommended_quantity > 0
                                     AND supplier_id IS NOT NULL
                                     AND active_location_count > 0
                               )::bigint AS actionable_count,
                               coalesce(sum(recommended_quantity), 0)::bigint
                                   AS total_recommended_quantity
                          FROM filtered
                        """,
                parameters,
                (resultSet, rowNumber) -> new Totals(
                        resultSet.getLong("total_elements"),
                        resultSet.getLong("actionable_count"),
                        resultSet.getLong("total_recommended_quantity")));
        if (totals == null || totals.totalElements() == 0) {
            return ProcurementRecommendationResult.empty();
        }

        List<ProcurementRecommendationItem> items = jdbc.query(
                sql + filter + """
                        SELECT *
                          FROM filtered
                         ORDER BY recommended_quantity DESC,
                                  last_28_days_sales_quantity DESC,
                                  warehouse_code ASC,
                                  sku_code ASC,
                                  sku_id ASC
                         LIMIT :limit OFFSET :offset
                        """,
                parameters,
                (resultSet, rowNumber) -> map(resultSet));
        Set<UUID> warehouseIds = items.stream()
                .map(ProcurementRecommendationItem::warehouseId)
                .collect(java.util.stream.Collectors.toSet());
        return new ProcurementRecommendationResult(
                items, locations(tenantId, warehouseIds),
                totals.totalElements(), totals.actionableCount(),
                totals.totalRecommendedQuantity());
    }

    public Optional<ProcurementRecommendationItem> find(
            UUID tenantId,
            Set<UUID> warehouseScope,
            boolean allWarehouses,
            UUID skuId,
            UUID warehouseId,
            Instant asOf) {
        List<ProcurementRecommendationItem> items = jdbc.query(
                recommendations(allWarehouses) + """
                        SELECT *
                          FROM recommendations
                         WHERE sku_id = :skuId
                           AND warehouse_id = :warehouseId
                        """,
                parameters(tenantId, warehouseScope, null, null, asOf)
                        .addValue("skuId", skuId)
                        .addValue("warehouseId", warehouseId),
                (resultSet, rowNumber) -> map(resultSet));
        if (items.size() > 1) {
            throw new IllegalStateException(
                    "Procurement recommendation identity is not unique");
        }
        return items.stream().findFirst();
    }

    public Optional<GeneratedReference> findGenerated(
            UUID tenantId, UUID orderCommandId) {
        List<GeneratedReference> rows = jdbc.query(
                """
                SELECT purchase.id AS purchase_order_id,
                       purchase.purchase_no,
                       purchase.plan_id,
                       purchase.plan_no_snapshot AS plan_no,
                       purchase.sku_id,
                       purchase.warehouse_id,
                       purchase.location_id,
                       purchase.supplier_id,
                       purchase.quantity
                  FROM procurement_purchase_order_commands command
                  JOIN procurement_purchase_orders purchase
                    ON purchase.tenant_id = command.tenant_id
                   AND purchase.id = command.purchase_order_id
                 WHERE command.tenant_id = :tenantId
                   AND command.command_id = :commandId
                """,
                Map.of("tenantId", tenantId, "commandId", orderCommandId),
                (resultSet, rowNumber) -> new GeneratedReference(
                        resultSet.getObject("purchase_order_id", UUID.class),
                        resultSet.getString("purchase_no"),
                        resultSet.getObject("plan_id", UUID.class),
                        resultSet.getString("plan_no"),
                        resultSet.getObject("sku_id", UUID.class),
                        resultSet.getObject("warehouse_id", UUID.class),
                        resultSet.getObject("location_id", UUID.class),
                        resultSet.getObject("supplier_id", UUID.class),
                        resultSet.getLong("quantity")));
        if (rows.size() > 1) {
            throw new IllegalStateException(
                    "Procurement generation command is not unique");
        }
        return rows.stream().findFirst();
    }

    public void lockSkus(UUID tenantId, Set<UUID> skuIds) {
        if (skuIds.isEmpty()) return;
        jdbc.queryForList(
                """
                SELECT sku.id
                  FROM tenant_product_skus sku
                 WHERE sku.tenant_id = :tenantId
                   AND sku.id IN (:skuIds)
                 ORDER BY sku.id
                   FOR UPDATE
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("skuIds", skuIds),
                UUID.class);
    }

    private List<ProcurementRecommendationLocation> locations(
            UUID tenantId, Set<UUID> warehouseIds) {
        if (warehouseIds.isEmpty()) return List.of();
        return jdbc.query(
                """
                SELECT location.id, location.warehouse_id,
                       location.business_code, location.name
                  FROM tenant_warehouse_locations location
                 WHERE location.tenant_id = :tenantId
                   AND location.warehouse_id IN (:warehouseIds)
                   AND location.status = 'ACTIVE'
                 ORDER BY location.warehouse_id,
                          location.business_code, location.id
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("warehouseIds", warehouseIds),
                (resultSet, rowNumber) ->
                        new ProcurementRecommendationLocation(
                                resultSet.getObject("id", UUID.class),
                                resultSet.getObject(
                                        "warehouse_id", UUID.class),
                                resultSet.getString("business_code"),
                                resultSet.getString("name")));
    }

    private static MapSqlParameterSource parameters(
            UUID tenantId,
            Set<UUID> warehouseScope,
            String supplier,
            String keyword,
            Instant asOf) {
        return new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("warehouseScope", warehouseScope)
                .addValue("supplier", pattern(supplier))
                .addValue("keyword", pattern(keyword))
                .addValue("asOf", Timestamp.from(asOf));
    }

    private static String recommendations(boolean allWarehouses) {
        String warehouseFilter = allWarehouses
                ? ""
                : " AND pair.warehouse_id IN (:warehouseScope)";
        return """
                WITH sales AS (
                    SELECT line.sku_id, line.warehouse_id,
                           sum(line.quantity)::bigint
                               AS last_28_days_sales_quantity
                      FROM tenant_order_lines line
                      JOIN tenant_orders orders
                        ON orders.tenant_id = line.tenant_id
                       AND orders.id = line.order_id
                     WHERE line.tenant_id = :tenantId
                       AND line.sku_id IS NOT NULL
                       AND line.warehouse_id IS NOT NULL
                       AND orders.status <> 'CANCELLED'
                       AND orders.placed_at >= CAST(:asOf AS timestamptz)
                           - interval '28 days'
                       AND orders.placed_at < :asOf
                     GROUP BY line.sku_id, line.warehouse_id
                ), inventory_pairs AS (
                    SELECT balance.sku_id, balance.warehouse_id
                      FROM inventory_balances balance
                     WHERE balance.tenant_id = :tenantId
                    UNION
                    SELECT sales.sku_id, sales.warehouse_id FROM sales
                ), reservations AS (
                    SELECT reservation.sku_id, reservation.warehouse_id,
                           sum(reservation.quantity
                               - reservation.consumed_quantity
                               - reservation.released_quantity)::bigint
                               AS reserved
                      FROM tenant_inventory_reservations reservation
                     WHERE reservation.tenant_id = :tenantId
                     GROUP BY reservation.sku_id,
                              reservation.warehouse_id
                ), open_purchases AS (
                    SELECT purchase.sku_id, purchase.warehouse_id,
                           sum(purchase.quantity
                               - purchase.received_quantity)::bigint
                               AS open_purchase_quantity
                      FROM procurement_purchase_orders purchase
                     WHERE purchase.tenant_id = :tenantId
                       AND purchase.status IN (
                           'NEW_ORDER', 'APPROVED', 'PARTIALLY_RECEIVED')
                     GROUP BY purchase.sku_id, purchase.warehouse_id
                ), preferred_suppliers AS (
                    SELECT mapping.sku_id, supplier.id AS supplier_id,
                           supplier.business_code AS supplier_code,
                           supplier.name AS supplier_name,
                           mapping.supplier_sku_code,
                           mapping.lead_time_days
                      FROM tenant_supplier_sku_mappings mapping
                      JOIN tenant_suppliers supplier
                        ON supplier.tenant_id = mapping.tenant_id
                       AND supplier.id = mapping.supplier_id
                       AND supplier.status = 'ACTIVE'
                     WHERE mapping.tenant_id = :tenantId
                       AND mapping.status = 'ACTIVE'
                       AND mapping.preferred
                ), location_counts AS (
                    SELECT location.warehouse_id,
                           count(*)::integer AS active_location_count
                      FROM tenant_warehouse_locations location
                     WHERE location.tenant_id = :tenantId
                       AND location.status = 'ACTIVE'
                     GROUP BY location.warehouse_id
                ), report_rows AS (
                    SELECT sku.id AS sku_id,
                           sku.business_code AS sku_code,
                           sku.name AS sku_name,
                           sku.variant_summary AS sku_variant,
                           warehouse.id AS warehouse_id,
                           warehouse.business_code AS warehouse_code,
                           warehouse.name AS warehouse_name,
                           coalesce(balance.on_hand, 0)::bigint AS on_hand,
                           coalesce(reservation.reserved, 0)::bigint
                               AS reserved,
                           (coalesce(balance.on_hand, 0)
                               - coalesce(reservation.reserved, 0))::bigint
                               AS available,
                           coalesce(sales.last_28_days_sales_quantity, 0)::bigint
                               AS last_28_days_sales_quantity,
                           coalesce(open_purchase.open_purchase_quantity, 0)::bigint
                               AS open_purchase_quantity,
                           preferred.supplier_id,
                           preferred.supplier_code,
                           preferred.supplier_name,
                           preferred.supplier_sku_code,
                           preferred.lead_time_days AS supplier_lead_time_days,
                           coalesce(preferred.lead_time_days, 28)::integer
                               AS planning_lead_time_days,
                           7::integer AS safety_days,
                           (coalesce(preferred.lead_time_days, 28) + 7)::integer
                               AS target_coverage_days,
                           coalesce(location.active_location_count, 0)::integer
                               AS active_location_count
                      FROM inventory_pairs pair
                      JOIN tenant_product_skus sku
                        ON sku.tenant_id = :tenantId
                       AND sku.id = pair.sku_id
                       AND sku.status = 'ACTIVE'
                      JOIN tenant_product_spus spu
                        ON spu.tenant_id = sku.tenant_id
                       AND spu.id = sku.spu_id
                       AND spu.status = 'ACTIVE'
                      JOIN tenant_warehouses warehouse
                        ON warehouse.tenant_id = :tenantId
                       AND warehouse.id = pair.warehouse_id
                       AND warehouse.status = 'ACTIVE'
                      LEFT JOIN inventory_balances balance
                        ON balance.tenant_id = :tenantId
                       AND balance.sku_id = pair.sku_id
                       AND balance.warehouse_id = pair.warehouse_id
                      LEFT JOIN reservations reservation
                        ON reservation.sku_id = pair.sku_id
                       AND reservation.warehouse_id = pair.warehouse_id
                      LEFT JOIN sales
                        ON sales.sku_id = pair.sku_id
                       AND sales.warehouse_id = pair.warehouse_id
                      LEFT JOIN open_purchases open_purchase
                        ON open_purchase.sku_id = pair.sku_id
                       AND open_purchase.warehouse_id = pair.warehouse_id
                      LEFT JOIN preferred_suppliers preferred
                        ON preferred.sku_id = pair.sku_id
                      LEFT JOIN location_counts location
                        ON location.warehouse_id = pair.warehouse_id
                     WHERE true
                """ + warehouseFilter + """
                ), recommendations AS (
                    SELECT report_rows.*,
                           ceil(last_28_days_sales_quantity::numeric
                               * target_coverage_days / 28)::bigint
                               AS target_stock_quantity,
                           greatest(
                               0,
                               ceil(last_28_days_sales_quantity::numeric
                                   * target_coverage_days / 28)::bigint
                                   - available - open_purchase_quantity
                           )::bigint AS recommended_quantity
                      FROM report_rows
                )
                """;
    }

    private static String filter(
            String supplier,
            String keyword,
            boolean hideWithoutSupplier,
            boolean hideZeroRecommendation) {
        StringBuilder where = new StringBuilder(
                ", filtered AS (SELECT * FROM recommendations WHERE true");
        if (supplier != null) {
            where.append("""
                     AND lower(coalesce(supplier_code, '') || ' '
                         || coalesce(supplier_name, ''))
                         LIKE :supplier ESCAPE '\\'
                    """);
        }
        if (keyword != null) {
            where.append("""
                     AND lower(sku_code || ' ' || sku_name || ' '
                         || warehouse_code || ' ' || warehouse_name)
                         LIKE :keyword ESCAPE '\\'
                    """);
        }
        if (hideWithoutSupplier) {
            where.append(" AND supplier_id IS NOT NULL");
        }
        if (hideZeroRecommendation) {
            where.append(" AND recommended_quantity > 0");
        }
        return where.append(") ").toString();
    }

    private static ProcurementRecommendationItem map(
            java.sql.ResultSet resultSet) throws java.sql.SQLException {
        return new ProcurementRecommendationItem(
                resultSet.getObject("sku_id", UUID.class),
                resultSet.getString("sku_code"),
                resultSet.getString("sku_name"),
                resultSet.getString("sku_variant"),
                resultSet.getObject("warehouse_id", UUID.class),
                resultSet.getString("warehouse_code"),
                resultSet.getString("warehouse_name"),
                resultSet.getLong("on_hand"),
                resultSet.getLong("reserved"),
                resultSet.getLong("available"),
                resultSet.getLong("last_28_days_sales_quantity"),
                resultSet.getLong("open_purchase_quantity"),
                resultSet.getObject("supplier_id", UUID.class),
                resultSet.getString("supplier_code"),
                resultSet.getString("supplier_name"),
                resultSet.getString("supplier_sku_code"),
                resultSet.getObject("supplier_lead_time_days", Integer.class),
                resultSet.getInt("planning_lead_time_days"),
                resultSet.getInt("safety_days"),
                resultSet.getInt("target_coverage_days"),
                resultSet.getLong("target_stock_quantity"),
                resultSet.getLong("recommended_quantity"),
                resultSet.getInt("active_location_count"));
    }

    private static String pattern(String value) {
        if (value == null) return null;
        return "%" + value.replace("\\", "\\\\")
                .replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private record Totals(
            long totalElements,
            long actionableCount,
            long totalRecommendedQuantity) {
    }

    public record GeneratedReference(
            UUID purchaseOrderId,
            String purchaseNo,
            UUID planId,
            String planNo,
            UUID skuId,
            UUID warehouseId,
            UUID locationId,
            UUID supplierId,
            long quantity) {
    }
}
