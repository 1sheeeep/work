package cn.xzkj.erp.order.repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import cn.xzkj.erp.order.domain.OrderListItem;
import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.domain.OrderQueryContracts.ConditionField;
import cn.xzkj.erp.order.domain.OrderQueryContracts.ConditionLogic;
import cn.xzkj.erp.order.domain.OrderQueryContracts.ConditionOperator;
import cn.xzkj.erp.order.domain.OrderQueryContracts.ListStage;
import cn.xzkj.erp.order.domain.OrderQueryContracts.SortDirection;
import cn.xzkj.erp.order.domain.OrderQueryContracts.SortField;
import cn.xzkj.erp.order.domain.OrderQueryContracts.TimeField;
import cn.xzkj.erp.order.domain.SkuMatchQueueItem;
import cn.xzkj.erp.order.domain.SkuMatchSource;
import cn.xzkj.erp.order.service.SkuSalesSummaryView;

@Repository
public class OrderListQueryRepository {

    private static final String ORDER_FROM = """
             from tenant_orders o
             join tenant_shops shop
               on shop.tenant_id = o.tenant_id and shop.id = o.shop_id
             join platform_catalog platform on platform.id = shop.platform_id
             left join tenant_order_profiles profile
               on profile.tenant_id = o.tenant_id
              and profile.order_id = o.id
             left join tenant_warehouses warehouse_record
               on warehouse_record.tenant_id = o.tenant_id
              and warehouse_record.id = o.warehouse_id
             left join tenant_warehouse_locations location_record
               on location_record.tenant_id = o.tenant_id
              and location_record.id = profile.location_id
             left join users picker
               on picker.tenant_id = o.tenant_id
              and picker.id = profile.picker_user_id
             left join users shipper
               on shipper.tenant_id = o.tenant_id
              and shipper.id = profile.shipper_user_id
             left join users salesperson
               on salesperson.tenant_id = o.tenant_id
              and salesperson.id = profile.salesperson_user_id
             left join users purchaser
               on purchaser.tenant_id = o.tenant_id
              and purchaser.id = profile.purchaser_user_id
             left join users developer
               on developer.tenant_id = o.tenant_id
              and developer.id = profile.developer_user_id
             left join users manager
               on manager.tenant_id = o.tenant_id
              and manager.id = profile.manager_user_id
            """;
    private static final String SKU_SALES_SUMMARIES = """
            SELECT line.sku_id,
                   sum(CASE WHEN orders.placed_at >= :since7
                       THEN line.quantity ELSE 0 END) AS sales7,
                   sum(CASE WHEN orders.placed_at >= :since28
                       THEN line.quantity ELSE 0 END) AS sales28,
                   sum(line.quantity) AS sales42
            FROM tenant_order_lines line
            JOIN tenant_orders orders
              ON orders.tenant_id = line.tenant_id
             AND orders.id = line.order_id
            WHERE line.tenant_id = :tenantId
              AND line.sku_id IN (:skuIds)
              AND orders.status <> 'CANCELLED'
              AND orders.placed_at >= :since42
            GROUP BY line.sku_id
            ORDER BY line.sku_id
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public OrderListQueryRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<SkuSalesSummaryView> listSkuSalesSummaries(
            UUID tenantId,
            Set<UUID> skuIds,
            Instant since7,
            Instant since28,
            Instant since42) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("skuIds", skuIds)
                .addValue("since7", Timestamp.from(since7))
                .addValue("since28", Timestamp.from(since28))
                .addValue("since42", Timestamp.from(since42));
        return jdbc.query(
                SKU_SALES_SUMMARIES,
                parameters,
                (resultSet, rowNumber) -> new SkuSalesSummaryView(
                        resultSet.getObject("sku_id", UUID.class),
                        resultSet.getLong("sales7"),
                        resultSet.getLong("sales28"),
                        resultSet.getLong("sales42")));
    }

    public PageResult search(
            UUID tenantId, Query query, int page, int size,
            boolean allWarehouses, Set<UUID> warehouseScope) {
        StringBuilder where = new StringBuilder(" where o.tenant_id = :tenantId");
        MapSqlParameterSource parameters = new MapSqlParameterSource("tenantId", tenantId);
        warehouseScope(where, parameters, allWarehouses, warehouseScope);
        equal(where, parameters, "o.shop_id", "shopId", query.shopId());
        equal(where, parameters, "shop.platform_id", "platformId",
                query.platformId());
        warehouseFilter(where, parameters, query.warehouseId());
        equal(where, parameters, "o.status", "status", name(query.status()));
        stage(where, parameters, query.stage());
        equal(where, parameters, "o.payment_status", "paymentStatus", query.paymentStatus());
        equal(where, parameters, "o.platform_status", "platformStatus", query.platformStatus());
        equal(where, parameters, "o.country_code", "countryCode", query.countryCode());
        equal(where, parameters, "o.tracking_status", "trackingStatus", query.trackingStatus());
        equal(where, parameters, "o.currency", "currency", query.currency());
        equal(where, parameters, "o.logistics_channel", "logisticsChannel",
                query.logisticsChannel());
        equal(where, parameters, "o.fixed_category", "fixedCategory",
                query.fixedCategory());
        equal(where, parameters, "o.custom_category", "customCategory",
                query.customCategory());
        equal(where, parameters, "profile.customer_category", "customerCategory",
                query.customerCategory());
        locationFilter(where, parameters, query.locationId());
        equal(where, parameters, "profile.picker_user_id", "pickerUserId",
                query.pickerUserId());
        equal(where, parameters, "profile.shipper_user_id", "shipperUserId",
                query.shipperUserId());
        equal(where, parameters, "profile.salesperson_user_id",
                "salespersonUserId", query.salespersonUserId());
        equal(where, parameters, "profile.purchaser_user_id",
                "purchaserUserId", query.purchaserUserId());
        equal(where, parameters, "profile.developer_user_id",
                "developerUserId", query.developerUserId());
        equal(where, parameters, "profile.manager_user_id", "managerUserId",
                query.managerUserId());
        equal(where, parameters, "profile.supplier_reference",
                "supplierReference", query.supplierReference());
        equal(where, parameters, "profile.parent_product_category",
                "parentProductCategory", query.parentProductCategory());
        equal(where, parameters, "profile.child_product_category",
                "childProductCategory", query.childProductCategory());
        equal(where, parameters, "profile.product_status", "productStatus",
                query.productStatus());
        equal(where, parameters, "profile.extended_attribute",
                "extendedAttribute", query.extendedAttribute());
        equal(where, parameters, "o.printed", "printed", query.printed());
        equal(where, parameters, "o.is_reshipment", "reshipment", query.reshipment());
        range(where, parameters, "o.total_amount_minor", "minAmountMinor",
                query.minAmountMinor(), ">=");
        range(where, parameters, "o.total_amount_minor", "maxAmountMinor",
                query.maxAmountMinor(), "<=");
        range(where, parameters, "o.weight_grams", "minWeightGrams",
                query.minWeightGrams(), ">=");
        range(where, parameters, "o.weight_grams", "maxWeightGrams",
                query.maxWeightGrams(), "<=");
        range(where, parameters, "profile.product_kind_count",
                "minProductKinds", query.minProductKinds(), ">=");
        range(where, parameters, "profile.product_kind_count",
                "maxProductKinds", query.maxProductKinds(), "<=");
        timeRange(where, parameters, "o.placed_at", "placedFrom", "placedTo",
                query.placedFrom(), query.placedTo());
        timeRange(where, parameters, "o.paid_at", "paidFrom", "paidTo",
                query.paidFrom(), query.paidTo());
        flexibleTime(where, parameters, query.timeField1(),
                query.timeFrom1(), query.timeTo1(), "time1");
        flexibleTime(where, parameters, query.timeField2(),
                query.timeFrom2(), query.timeTo2(), "time2");
        conditions(where, parameters, query);
        if (query.keyword() != null) {
            where.append("""
                     and (
                       lower(o.external_order_ref) like :keyword escape '\\'
                       or lower(coalesce(profile.tracking_reference, '')) like :keyword escape '\\'
                       or lower(coalesce(profile.secondary_tracking_reference, '')) like :keyword escape '\\'
                       or lower(coalesce(profile.sales_record_number, '')) like :keyword escape '\\'
                       or lower(coalesce(profile.custom_order_reference, '')) like :keyword escape '\\'
                       or lower(coalesce(o.buyer_reference, '')) like :keyword escape '\\'
                       or lower(coalesce(o.postal_code, '')) like :keyword escape '\\'
                     )
                    """);
            parameters.addValue("keyword", literalPattern(query.keyword()));
        }
        if (query.skuKeyword() != null) {
            where.append("""
                     and exists (
                       select 1
                       from tenant_order_lines lf
                       left join tenant_product_skus sf
                         on sf.tenant_id = lf.tenant_id and sf.id = lf.sku_id
                       where lf.tenant_id = o.tenant_id and lf.order_id = o.id
                         and (
                           lower(coalesce(sf.business_code, '')) like :skuKeyword escape '\\'
                           or lower(coalesce(lf.platform_sku, '')) like :skuKeyword escape '\\'
                           or lower(lf.title_snapshot) like :skuKeyword escape '\\'
                         )
                     )
                    """);
            parameters.addValue("skuKeyword", literalPattern(query.skuKeyword()));
        }

        Long total = jdbc.queryForObject(
                "select count(*)" + ORDER_FROM + where, parameters, Long.class);
        parameters.addValue("limit", size);
        parameters.addValue("offset", Math.multiplyExact(page, size));
        List<OrderListItem> items = jdbc.query("""
                select o.*,
                       shop.display_name as shop_name,
                       profile.sales_record_number as profile_sales_record_number,
                       profile.shopping_cart_reference as profile_shopping_cart_reference,
                       profile.custom_order_reference as profile_custom_order_reference,
                       profile.tracking_reference as profile_tracking_reference,
                       profile.secondary_tracking_reference as profile_secondary_tracking_reference,
                       profile.actual_paid_minor as profile_actual_paid_minor,
                       profile.profit_minor as profile_profit_minor,
                       profile.actual_shipping_minor as profile_actual_shipping_minor,
                       profile.item_amount_minor as profile_item_amount_minor,
                       profile.platform_fee_minor as profile_platform_fee_minor,
                       profile.insurance_fee_minor as profile_insurance_fee_minor,
                       profile.payment_fee_minor as profile_payment_fee_minor,
                       profile.other_income_minor as profile_other_income_minor,
                       profile.other_expense_minor as profile_other_expense_minor,
                       profile.tax_minor as profile_tax_minor,
                       profile.estimated_shipping_minor as profile_estimated_shipping_minor,
                       salesperson.display_name as salesperson_display_name,
                       manager.display_name as manager_display_name,
                       profile.order_remark as profile_order_remark,
                       profile.customer_category as profile_customer_category,
                       profile.product_kind_count as profile_product_kind_count,
                       profile.supplier_reference as profile_supplier_reference,
                       profile.parent_product_category as profile_parent_product_category,
                       profile.child_product_category as profile_child_product_category,
                       profile.product_status as profile_product_status,
                       profile.extended_attribute as profile_extended_attribute,
                       warehouse_record.name as warehouse_display_name,
                       location_record.business_code as location_business_code,
                       picker.display_name as picker_display_name,
                       shipper.display_name as shipper_display_name,
                       purchaser.display_name as purchaser_display_name,
                       developer.display_name as developer_display_name,
                       profile.printed_at as profile_printed_at,
                       profile.platform_returned_at as profile_platform_returned_at,
                       profile.exception_reviewed_at as profile_exception_reviewed_at,
                       profile.platform_specified_handover_at as profile_platform_specified_handover_at,
                       profile.platform_label_requested_at as profile_platform_label_requested_at,
                       profile.delivery_deadline_at as profile_delivery_deadline_at,
                       profile.cancelled_at as profile_cancelled_at,
                       profile.handed_over_at as profile_handed_over_at,
                       profile.delivered_at as profile_delivered_at,
                       (
                         select string_agg(distinct coalesce(s.business_code, l.platform_sku, l.external_line_ref),
                                           ', ' order by coalesce(s.business_code, l.platform_sku, l.external_line_ref))
                         from tenant_order_lines l
                         left join tenant_product_skus s
                           on s.tenant_id = l.tenant_id and s.id = l.sku_id
                         where l.tenant_id = o.tenant_id and l.order_id = o.id
                       ) as sku_summary,
                       (
                         select string_agg(distinct l.title_snapshot, ', ' order by l.title_snapshot)
                         from tenant_order_lines l
                         where l.tenant_id = o.tenant_id and l.order_id = o.id
                       ) as title_summary
                """ + ORDER_FROM + where + orderBy(query)
                        + " limit :limit offset :offset",
                parameters, this::map);
        return new PageResult(items, total == null ? 0 : total);
    }

    /**
     * Internal compatibility overload. Request paths must pass an evaluated
     * warehouse scope through the explicit overload above.
     */
    public PageResult search(UUID tenantId, Query query, int page, int size) {
        return search(tenantId, query, page, size, true, Set.of());
    }

    public DashboardCounts summarize(
            UUID tenantId,
            UUID shopId,
            boolean allWarehouses,
            Set<UUID> warehouseScope) {
        StringBuilder where =
                new StringBuilder(" where o.tenant_id = :tenantId");
        MapSqlParameterSource parameters =
                new MapSqlParameterSource("tenantId", tenantId);
        equal(where, parameters, "o.shop_id", "shopId", shopId);
        warehouseScope(where, parameters, allWarehouses, warehouseScope);
        DashboardCounts counts = jdbc.queryForObject("""
                select count(*) as total_orders,
                       count(*) filter (where o.status = 'UNPAID') as unpaid_orders,
                       count(*) filter (where o.status = 'RECEIVED') as received_orders,
                       count(*) filter (where o.status = 'REVIEW_PENDING') as review_pending_orders,
                       count(*) filter (where o.status = 'MERGE_PENDING') as merge_pending_orders,
                       count(*) filter (where o.status = 'HOLD') as hold_orders,
                       count(*) filter (where o.status = 'READY_TO_FULFILL') as ready_orders,
                       count(*) filter (where o.status = 'FULFILLING') as fulfilling_orders,
                       count(*) filter (where o.status = 'SHIPPED') as shipped_orders,
                       count(*) filter (where o.status = 'DELIVERED') as delivered_orders,
                       count(*) filter (where o.status = 'CANCELLED') as cancelled_orders,
                       count(*) filter (
                         where o.status in (
                           'UNPAID', 'RECEIVED', 'REVIEW_PENDING',
                           'MERGE_PENDING', 'HOLD'
                         )
                       ) as editable_orders
                from tenant_orders o
                """ + where, parameters, (rs, row) -> new DashboardCounts(
                        rs.getLong("total_orders"),
                        rs.getLong("unpaid_orders"),
                        rs.getLong("received_orders"),
                        rs.getLong("review_pending_orders"),
                        rs.getLong("merge_pending_orders"),
                        rs.getLong("hold_orders"),
                        rs.getLong("ready_orders"),
                        rs.getLong("fulfilling_orders"),
                        rs.getLong("shipped_orders"),
                        rs.getLong("delivered_orders"),
                        rs.getLong("cancelled_orders"),
                        rs.getLong("editable_orders"),
                        0,
                        null));
        SkuQueuePage unmatched = searchSkuMatchQueue(
                tenantId, shopId, null, 0, 1,
                allWarehouses, warehouseScope);
        Instant oldest = unmatched.items().isEmpty()
                ? null : unmatched.items().getFirst().placedAt();
        return new DashboardCounts(
                counts.totalOrders(),
                counts.unpaidOrders(),
                counts.receivedOrders(),
                counts.reviewPendingOrders(),
                counts.mergePendingOrders(),
                counts.holdOrders(),
                counts.readyToFulfillOrders(),
                counts.fulfillingOrders(),
                counts.shippedOrders(),
                counts.deliveredOrders(),
                counts.cancelledOrders(),
                counts.editableOrders(),
                unmatched.totalElements(),
                oldest);
    }

    public SkuQueuePage searchSkuMatchQueue(
            UUID tenantId,
            UUID shopId,
            String keyword,
            int page,
            int size,
            boolean allWarehouses,
            Set<UUID> warehouseScope) {
        StringBuilder where = new StringBuilder("""
                 where o.tenant_id = :tenantId
                   and l.tenant_id = o.tenant_id
                   and l.order_id = o.id
                   and o.status in ('RECEIVED', 'REVIEW_PENDING', 'HOLD')
                   and l.sku_id is null
                """);
        MapSqlParameterSource parameters =
                new MapSqlParameterSource("tenantId", tenantId);
        warehouseScope(where, parameters, allWarehouses, warehouseScope);
        equal(where, parameters, "o.shop_id", "shopId", shopId);
        if (keyword != null) {
            where.append("""
                     and (
                       lower(o.external_order_ref) like :queueKeyword escape '\\'
                       or lower(l.external_line_ref) like :queueKeyword escape '\\'
                       or lower(l.title_snapshot) like :queueKeyword escape '\\'
                     )
                    """);
            parameters.addValue("queueKeyword", literalPattern(keyword));
        }
        Long total = jdbc.queryForObject("""
                select count(*)
                from tenant_orders o
                join tenant_order_lines l
                  on l.tenant_id = o.tenant_id and l.order_id = o.id
                """ + where, parameters, Long.class);
        parameters.addValue("limit", size);
        parameters.addValue("offset", Math.multiplyExact(page, size));
        List<SkuMatchQueueItem> items = jdbc.query("""
                select o.id as order_id, o.version as order_version,
                       o.status as order_status, o.shop_id,
                       o.external_order_ref, o.placed_at,
                       l.id as line_id, l.external_line_ref,
                       l.title_snapshot, l.external_listing_ref,
                       l.external_variant_ref, l.sku_id, l.sku_match_source
                from tenant_orders o
                join tenant_order_lines l
                  on l.tenant_id = o.tenant_id and l.order_id = o.id
                """ + where + """
                 order by o.placed_at, o.id, l.external_line_ref, l.id
                 limit :limit offset :offset
                """, parameters, (rs, row) -> new SkuMatchQueueItem(
                        uuid(rs, "order_id"),
                        rs.getLong("order_version"),
                        OrderStatus.valueOf(rs.getString("order_status")),
                        uuid(rs, "shop_id"),
                        rs.getString("external_order_ref"),
                        instant(rs, "placed_at"),
                        uuid(rs, "line_id"),
                        rs.getString("external_line_ref"),
                        rs.getString("title_snapshot"),
                        rs.getString("external_listing_ref"),
                        rs.getString("external_variant_ref"),
                        uuidOrNull(rs, "sku_id"),
                        SkuMatchSource.valueOf(rs.getString("sku_match_source"))));
        return new SkuQueuePage(items, total == null ? 0 : total);
    }

    public boolean shopExists(UUID tenantId, UUID shopId) {
        return exists("tenant_shops", tenantId, shopId);
    }

    public boolean warehouseExists(UUID tenantId, UUID warehouseId) {
        return exists("tenant_warehouses", tenantId, warehouseId);
    }

    private boolean exists(String table, UUID tenantId, UUID id) {
        Integer count = jdbc.getJdbcTemplate().queryForObject(
                "select count(*) from " + table + " where tenant_id = ? and id = ?",
                Integer.class, tenantId, id);
        return count != null && count == 1;
    }

    private OrderListItem map(ResultSet rs, int row) throws SQLException {
        return new OrderListItem(
                uuid(rs, "id"), uuid(rs, "shop_id"), rs.getString("shop_name"),
                uuidOrNull(rs, "warehouse_id"),
                rs.getString("external_order_ref"), rs.getString("currency"),
                rs.getString("buyer_reference"), OrderStatus.valueOf(rs.getString("status")),
                rs.getString("hold_reason"), rs.getInt("line_count"),
                instant(rs, "placed_at"), instant(rs, "created_at"), instant(rs, "updated_at"),
                rs.getLong("version"), rs.getString("platform_status"),
                rs.getString("payment_status"), rs.getString("logistics_channel"),
                rs.getString("country_code"), rs.getString("province"), rs.getString("postal_code"),
                rs.getString("buyer_selected_logistics"),
                longOrNull(rs, "total_amount_minor"), longOrNull(rs, "shipping_amount_minor"),
                rs.getBigDecimal("weight_grams"), instantOrNull(rs, "paid_at"),
                instantOrNull(rs, "ship_by_at"), instantOrNull(rs, "shipped_at"),
                rs.getString("tracking_status"), rs.getString("fixed_category"),
                rs.getString("custom_category"), rs.getBoolean("is_reshipment"),
                rs.getString("reshipment_reason"), rs.getBoolean("platform_handover_required"),
                rs.getBoolean("printed"),
                rs.getString("profile_sales_record_number"),
                rs.getString("profile_shopping_cart_reference"),
                rs.getString("profile_custom_order_reference"),
                rs.getString("profile_tracking_reference"),
                rs.getString("profile_secondary_tracking_reference"),
                longOrNull(rs, "profile_actual_paid_minor"),
                longOrNull(rs, "profile_profit_minor"),
                longOrNull(rs, "profile_actual_shipping_minor"),
                longOrNull(rs, "profile_item_amount_minor"),
                longOrNull(rs, "profile_platform_fee_minor"),
                longOrNull(rs, "profile_insurance_fee_minor"),
                longOrNull(rs, "profile_payment_fee_minor"),
                longOrNull(rs, "profile_other_income_minor"),
                longOrNull(rs, "profile_other_expense_minor"),
                longOrNull(rs, "profile_tax_minor"),
                longOrNull(rs, "profile_estimated_shipping_minor"),
                rs.getString("salesperson_display_name"),
                rs.getString("manager_display_name"),
                rs.getString("profile_order_remark"),
                rs.getString("profile_customer_category"),
                integerOrNull(rs, "profile_product_kind_count"),
                rs.getString("profile_supplier_reference"),
                rs.getString("profile_parent_product_category"),
                rs.getString("profile_child_product_category"),
                rs.getString("profile_product_status"),
                rs.getString("profile_extended_attribute"),
                rs.getString("warehouse_display_name"),
                rs.getString("location_business_code"),
                rs.getString("picker_display_name"),
                rs.getString("shipper_display_name"),
                rs.getString("purchaser_display_name"),
                rs.getString("developer_display_name"),
                instantOrNull(rs, "profile_printed_at"),
                instantOrNull(rs, "profile_platform_returned_at"),
                instantOrNull(rs, "profile_exception_reviewed_at"),
                instantOrNull(rs, "profile_platform_specified_handover_at"),
                instantOrNull(rs, "profile_platform_label_requested_at"),
                instantOrNull(rs, "profile_delivery_deadline_at"),
                instantOrNull(rs, "profile_cancelled_at"),
                instantOrNull(rs, "profile_handed_over_at"),
                instantOrNull(rs, "profile_delivered_at"),
                rs.getString("sku_summary"), rs.getString("title_summary"));
    }

    private static void equal(StringBuilder where, MapSqlParameterSource parameters,
            String column, String name, Object value) {
        if (value != null) {
            where.append(" and ").append(column).append(" = :").append(name);
            parameters.addValue(name, value);
        }
    }

    private static void range(StringBuilder where, MapSqlParameterSource parameters,
            String column, String name, Object value, String operator) {
        if (value != null) {
            where.append(" and ").append(column).append(' ').append(operator)
                    .append(" :").append(name);
            parameters.addValue(name, value);
        }
    }

    private static void timeRange(StringBuilder where, MapSqlParameterSource parameters,
            String column, String fromName, String toName, Instant from, Instant to) {
        if (from != null) {
            where.append(" and ").append(column).append(" >= :").append(fromName);
            parameters.addValue(fromName, Timestamp.from(from));
        }
        if (to != null) {
            where.append(" and ").append(column).append(" < :").append(toName);
            parameters.addValue(toName, Timestamp.from(to));
        }
    }

    private static void stage(
            StringBuilder where, MapSqlParameterSource parameters,
            ListStage stage) {
        if (stage == null || stage == ListStage.ALL) {
            return;
        }
        if (stage == ListStage.PROCESSING) {
            where.append("""
                     and o.status in (
                       'RECEIVED', 'HOLD', 'READY_TO_FULFILL'
                     )
                    """);
            return;
        }
        where.append(" and o.status = :listStage");
        parameters.addValue("listStage", stage.name());
    }

    private static void flexibleTime(
            StringBuilder where,
            MapSqlParameterSource parameters,
            TimeField field,
            Instant from,
            Instant to,
            String prefix) {
        if (field == null) {
            if (from != null || to != null) {
                where.append(" and false");
            }
            return;
        }
        timeRange(where, parameters, timeColumn(field),
                prefix + "From", prefix + "To", from, to);
    }

    private static String timeColumn(TimeField field) {
        return switch (field) {
            case PLACED -> "o.placed_at";
            case PAID -> "o.paid_at";
            case SHIPPED -> "o.shipped_at";
            case PRINTED -> "profile.printed_at";
            case CREATED -> "o.created_at";
            case PLATFORM_RETURNED -> "profile.platform_returned_at";
            case EXCEPTION_REVIEWED -> "profile.exception_reviewed_at";
            case CANCELLED -> "profile.cancelled_at";
            case HANDED_OVER -> "profile.handed_over_at";
            case PLATFORM_SPECIFIED_HANDOVER ->
                    "profile.platform_specified_handover_at";
            case PLATFORM_LABEL_REQUESTED ->
                    "profile.platform_label_requested_at";
            case DELIVERY_DEADLINE -> "profile.delivery_deadline_at";
            case DELIVERED -> "profile.delivered_at";
        };
    }

    private static void conditions(
            StringBuilder where,
            MapSqlParameterSource parameters,
            Query query) {
        String first = condition(
                parameters, query.conditionField1(),
                query.conditionOperator1(), query.conditionValue1(), "condition1");
        String second = condition(
                parameters, query.conditionField2(),
                query.conditionOperator2(), query.conditionValue2(), "condition2");
        if (first == null && second == null) {
            return;
        }
        if (first == null || second == null) {
            where.append(" and ").append(first == null ? second : first);
            return;
        }
        where.append(" and (").append(first)
                .append(query.conditionLogic() == ConditionLogic.OR
                        ? " or " : " and ")
                .append(second).append(')');
    }

    private static String condition(
            MapSqlParameterSource parameters,
            ConditionField field,
            ConditionOperator operator,
            String value,
            String parameter) {
        if (field == null && operator == null
                && (value == null || value.isBlank())) {
            return null;
        }
        if (field == null || operator == null) {
            return "false";
        }
        String expression = conditionExpression(field);
        return switch (operator) {
            case IS_EMPTY -> "(" + expression + " is null or "
                    + expression + " = '')";
            case IS_NOT_EMPTY -> "(" + expression + " is not null and "
                    + expression + " <> '')";
            case EQUALS, NOT_EQUALS, CONTAINS, NOT_CONTAINS -> {
                if (value == null || value.isBlank()) {
                    yield "false";
                }
                String normalized = value.strip().toLowerCase();
                if (operator == ConditionOperator.EQUALS
                        || operator == ConditionOperator.NOT_EQUALS) {
                    parameters.addValue(parameter, normalized);
                    yield "lower(coalesce(" + expression + ", '')) "
                            + (operator == ConditionOperator.EQUALS
                                    ? "= :" : "<> :")
                            + parameter;
                }
                parameters.addValue(parameter, literalPattern(normalized));
                yield "lower(coalesce(" + expression + ", '')) "
                        + (operator == ConditionOperator.CONTAINS
                                ? "like :" : "not like :")
                        + parameter + " escape '\\\\'";
            }
        };
    }

    private static String conditionExpression(ConditionField field) {
        return switch (field) {
            case ORDER_NUMBER -> "o.external_order_ref";
            case SALES_RECORD_NUMBER -> "profile.sales_record_number";
            case SHOPPING_CART_REFERENCE ->
                    "profile.shopping_cart_reference";
            case CUSTOMER_ID -> "profile.customer_id";
            case CUSTOMER_CODE -> "profile.customer_code";
            case RECIPIENT_NAME -> "profile.recipient_name";
            case RECIPIENT_EMAIL -> "profile.recipient_email";
            case RECIPIENT_PHONE -> "profile.recipient_phone";
            case POSTAL_CODE -> "o.postal_code";
            case PROVINCE -> "o.province";
            case CITY -> "profile.city";
            case TRACKING_REFERENCE -> "profile.tracking_reference";
            case PLATFORM_STATUS -> "o.platform_status";
            case SUPPLIER_REFERENCE -> "profile.supplier_reference";
            case ORDER_REMARK -> "profile.order_remark";
            case EXTENDED_ATTRIBUTE -> "profile.extended_attribute";
            case PLATFORM_SKU -> """
                    (select min(l.platform_sku)
                     from tenant_order_lines l
                     where l.tenant_id = o.tenant_id and l.order_id = o.id)
                    """;
            case INVENTORY_SKU -> """
                    (select min(s.business_code)
                     from tenant_order_lines l
                     join tenant_product_skus s
                       on s.tenant_id = l.tenant_id and s.id = l.sku_id
                     where l.tenant_id = o.tenant_id and l.order_id = o.id)
                    """;
            case PRODUCT_NAME -> """
                    (select min(l.title_snapshot)
                     from tenant_order_lines l
                     where l.tenant_id = o.tenant_id and l.order_id = o.id)
                    """;
        };
    }

    private static String orderBy(Query query) {
        SortField field = query.sortField() == null
                ? SortField.PLACED_AT : query.sortField();
        SortDirection direction = query.sortDirection() == null
                ? SortDirection.DESC : query.sortDirection();
        String column = switch (field) {
            case PLACED_AT -> "o.placed_at";
            case PAID_AT -> "o.paid_at";
            case CREATED_AT -> "o.created_at";
            case UPDATED_AT -> "o.updated_at";
            case SHIP_BY_AT -> "o.ship_by_at";
            case TOTAL_AMOUNT -> "o.total_amount_minor";
            case EXTERNAL_ORDER_REF -> "o.external_order_ref";
        };
        return " order by " + column + " "
                + direction.name() + ", o.id " + direction.name();
    }

    private static void warehouseScope(
            StringBuilder where,
            MapSqlParameterSource parameters,
            boolean allWarehouses,
            Set<UUID> warehouseScope) {
        if (allWarehouses) {
            return;
        }
        if (warehouseScope == null || warehouseScope.isEmpty()) {
            where.append(" and false");
            return;
        }
        where.append("""
                 and exists (
                   select 1 from tenant_order_warehouse_facts wf
                   where wf.tenant_id = o.tenant_id
                     and wf.order_id = o.id
                 )
                 and not exists (
                   select 1 from tenant_order_warehouse_facts wf
                   where wf.tenant_id = o.tenant_id
                     and wf.order_id = o.id
                     and wf.warehouse_id not in (:warehouseScope)
                 )
                """);
        parameters.addValue("warehouseScope", warehouseScope);
    }

    private static void warehouseFilter(
            StringBuilder where,
            MapSqlParameterSource parameters,
            UUID warehouseId) {
        if (warehouseId == null) {
            return;
        }
        where.append("""
                 and exists (
                   select 1 from tenant_order_warehouse_facts wf
                   where wf.tenant_id = o.tenant_id
                     and wf.order_id = o.id
                     and wf.warehouse_id = :warehouseId
                 )
                """);
        parameters.addValue("warehouseId", warehouseId);
    }

    private static void locationFilter(
            StringBuilder where,
            MapSqlParameterSource parameters,
            UUID locationId) {
        if (locationId == null) {
            return;
        }
        where.append("""
                 and (
                   profile.location_id = :locationId
                   or exists (
                     select 1
                     from tenant_fulfillment_plans fp
                     join tenant_fulfillment_lines fl
                       on fl.tenant_id = fp.tenant_id
                      and fl.plan_id = fp.id
                     where fp.tenant_id = o.tenant_id
                       and fp.order_id = o.id
                       and fl.location_id = :locationId
                   )
                 )
                """);
        parameters.addValue("locationId", locationId);
    }

    private static String literalPattern(String value) {
        return "%" + value.strip().toLowerCase()
                .replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private static String name(Enum<?> value) {
        return value == null ? null : value.name();
    }

    private static UUID uuid(ResultSet rs, String column) throws SQLException {
        return rs.getObject(column, UUID.class);
    }

    private static UUID uuidOrNull(ResultSet rs, String column) throws SQLException {
        return rs.getObject(column) == null ? null : rs.getObject(column, UUID.class);
    }

    private static Long longOrNull(ResultSet rs, String column) throws SQLException {
        return rs.getObject(column) == null ? null : rs.getLong(column);
    }

    private static Integer integerOrNull(ResultSet rs, String column) throws SQLException {
        return rs.getObject(column) == null ? null : rs.getInt(column);
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        return rs.getTimestamp(column).toInstant();
    }

    private static Instant instantOrNull(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    public record Query(
            UUID shopId,
            UUID warehouseId,
            OrderStatus status,
            String paymentStatus,
            String platformStatus,
            String countryCode,
            String trackingStatus,
            String currency,
            Boolean printed,
            Boolean reshipment,
            Long minAmountMinor,
            Long maxAmountMinor,
            java.math.BigDecimal minWeightGrams,
            java.math.BigDecimal maxWeightGrams,
            Instant placedFrom,
            Instant placedTo,
            Instant paidFrom,
            Instant paidTo,
            String keyword,
            String skuKeyword,
            UUID platformId,
            ListStage stage,
            String logisticsChannel,
            String fixedCategory,
            String customCategory,
            String customerCategory,
            UUID locationId,
            UUID pickerUserId,
            UUID shipperUserId,
            UUID salespersonUserId,
            UUID purchaserUserId,
            UUID developerUserId,
            UUID managerUserId,
            String supplierReference,
            String parentProductCategory,
            String childProductCategory,
            String productStatus,
            String extendedAttribute,
            Integer minProductKinds,
            Integer maxProductKinds,
            ConditionField conditionField1,
            ConditionOperator conditionOperator1,
            String conditionValue1,
            ConditionField conditionField2,
            ConditionOperator conditionOperator2,
            String conditionValue2,
            ConditionLogic conditionLogic,
            TimeField timeField1,
            Instant timeFrom1,
            Instant timeTo1,
            TimeField timeField2,
            Instant timeFrom2,
            Instant timeTo2,
            SortField sortField,
            SortDirection sortDirection) {

        public Query(
                UUID shopId,
                UUID warehouseId,
                OrderStatus status,
                String paymentStatus,
                String platformStatus,
                String countryCode,
                String trackingStatus,
                String currency,
                Boolean printed,
                Boolean reshipment,
                Long minAmountMinor,
                Long maxAmountMinor,
                java.math.BigDecimal minWeightGrams,
                java.math.BigDecimal maxWeightGrams,
                Instant placedFrom,
                Instant placedTo,
                Instant paidFrom,
                Instant paidTo,
                String keyword,
                String skuKeyword) {
            this(
                    shopId, warehouseId, status, paymentStatus,
                    platformStatus, countryCode, trackingStatus, currency,
                    printed, reshipment, minAmountMinor, maxAmountMinor,
                    minWeightGrams, maxWeightGrams, placedFrom, placedTo,
                    paidFrom, paidTo, keyword, skuKeyword,
                    // platform through custom category (5)
                    null, null, null, null, null,
                    // customer category through purchaser (6-11)
                    null, null, null, null, null, null,
                    // developer through child category (12-16)
                    null, null, null, null, null,
                    // product state through condition field 1 (17-21)
                    null, null, null, null, null,
                    // condition operator 1 through logic (22-27)
                    null, null, null, null, null, null,
                    // time field 1 through time field 2 (28-31)
                    null, null, null, null,
                    // time range 2 and sort (32-35)
                    null, null, null, null);
        }
    }

    public record PageResult(List<OrderListItem> items, long totalElements) {
    }

    public record SkuQueuePage(
            List<SkuMatchQueueItem> items, long totalElements) {
    }

    public record DashboardCounts(
            long totalOrders,
            long unpaidOrders,
            long receivedOrders,
            long reviewPendingOrders,
            long mergePendingOrders,
            long holdOrders,
            long readyToFulfillOrders,
            long fulfillingOrders,
            long shippedOrders,
            long deliveredOrders,
            long cancelledOrders,
            long editableOrders,
            long unmatchedLines,
            Instant oldestUnmatchedPlacedAt) {
    }
}
