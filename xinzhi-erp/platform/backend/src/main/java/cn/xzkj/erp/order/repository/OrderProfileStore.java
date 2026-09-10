package cn.xzkj.erp.order.repository;

import cn.xzkj.erp.order.domain.OrderActivity;
import cn.xzkj.erp.order.domain.OrderProfile;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class OrderProfileStore {

    private final NamedParameterJdbcTemplate jdbc;

    public OrderProfileStore(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(UUID tenantId, UUID orderId, OrderProfile profile) {
        jdbc.update("""
                INSERT INTO tenant_order_profiles (
                    tenant_id, order_id, sales_record_number,
                    shopping_cart_reference, custom_order_reference,
                    customer_id, customer_code, recipient_name,
                    recipient_phone, recipient_email, recipient_company,
                    address_line1, address_line2, city, district, town,
                    door_code, shipping_service, tracking_reference,
                    secondary_tracking_reference, item_amount_minor,
                    platform_fee_minor, insurance_fee_minor,
                    payment_fee_minor, other_income_minor,
                    other_expense_minor, actual_paid_minor, profit_minor,
                    tax_minor, estimated_shipping_minor,
                    actual_shipping_minor, platform_message,
                    platform_remark, order_remark, declaration_plan,
                    declaration_actual, customer_category,
                    product_kind_count, location_id, picker_user_id,
                    shipper_user_id, salesperson_user_id,
                    purchaser_user_id, developer_user_id, manager_user_id,
                    supplier_reference, parent_product_category,
                    child_product_category, product_status,
                    extended_attribute, printed_at, platform_returned_at,
                    exception_reviewed_at, cancelled_at, handed_over_at,
                    platform_specified_handover_at,
                    platform_label_requested_at, delivery_deadline_at,
                    delivered_at
                ) VALUES (
                    :tenantId, :orderId, :salesRecordNumber,
                    :shoppingCartReference, :customOrderReference,
                    :customerId, :customerCode, :recipientName,
                    :recipientPhone, :recipientEmail, :recipientCompany,
                    :addressLine1, :addressLine2, :city, :district, :town,
                    :doorCode, :shippingService, :trackingReference,
                    :secondaryTrackingReference, :itemAmountMinor,
                    :platformFeeMinor, :insuranceFeeMinor,
                    :paymentFeeMinor, :otherIncomeMinor,
                    :otherExpenseMinor, :actualPaidMinor, :profitMinor,
                    :taxMinor, :estimatedShippingMinor,
                    :actualShippingMinor, :platformMessage,
                    :platformRemark, :orderRemark, :declarationPlan,
                    :declarationActual, :customerCategory,
                    :productKindCount, :locationId, :pickerUserId,
                    :shipperUserId, :salespersonUserId,
                    :purchaserUserId, :developerUserId, :managerUserId,
                    :supplierReference, :parentProductCategory,
                    :childProductCategory, :productStatus,
                    :extendedAttribute, :printedAt, :platformReturnedAt,
                    :exceptionReviewedAt, :cancelledAt, :handedOverAt,
                    :platformSpecifiedHandoverAt,
                    :platformLabelRequestedAt, :deliveryDeadlineAt,
                    :deliveredAt
                )
                """, parameters(tenantId, orderId, profile));
    }

    public boolean update(
            UUID tenantId, UUID orderId, long expectedVersion,
            OrderProfile profile) {
        MapSqlParameterSource parameters = parameters(tenantId, orderId, profile)
                .addValue("expectedVersion", expectedVersion);
        return jdbc.update("""
                UPDATE tenant_order_profiles SET
                    sales_record_number = :salesRecordNumber,
                    shopping_cart_reference = :shoppingCartReference,
                    custom_order_reference = :customOrderReference,
                    customer_id = :customerId,
                    customer_code = :customerCode,
                    recipient_name = :recipientName,
                    recipient_phone = :recipientPhone,
                    recipient_email = :recipientEmail,
                    recipient_company = :recipientCompany,
                    address_line1 = :addressLine1,
                    address_line2 = :addressLine2,
                    city = :city,
                    district = :district,
                    town = :town,
                    door_code = :doorCode,
                    shipping_service = :shippingService,
                    tracking_reference = :trackingReference,
                    secondary_tracking_reference = :secondaryTrackingReference,
                    item_amount_minor = :itemAmountMinor,
                    platform_fee_minor = :platformFeeMinor,
                    insurance_fee_minor = :insuranceFeeMinor,
                    payment_fee_minor = :paymentFeeMinor,
                    other_income_minor = :otherIncomeMinor,
                    other_expense_minor = :otherExpenseMinor,
                    actual_paid_minor = :actualPaidMinor,
                    profit_minor = :profitMinor,
                    tax_minor = :taxMinor,
                    estimated_shipping_minor = :estimatedShippingMinor,
                    actual_shipping_minor = :actualShippingMinor,
                    platform_message = :platformMessage,
                    platform_remark = :platformRemark,
                    order_remark = :orderRemark,
                    declaration_plan = :declarationPlan,
                    declaration_actual = :declarationActual,
                    customer_category = :customerCategory,
                    product_kind_count = :productKindCount,
                    location_id = :locationId,
                    picker_user_id = :pickerUserId,
                    shipper_user_id = :shipperUserId,
                    salesperson_user_id = :salespersonUserId,
                    purchaser_user_id = :purchaserUserId,
                    developer_user_id = :developerUserId,
                    manager_user_id = :managerUserId,
                    supplier_reference = :supplierReference,
                    parent_product_category = :parentProductCategory,
                    child_product_category = :childProductCategory,
                    product_status = :productStatus,
                    extended_attribute = :extendedAttribute,
                    printed_at = :printedAt,
                    platform_returned_at = :platformReturnedAt,
                    exception_reviewed_at = :exceptionReviewedAt,
                    cancelled_at = :cancelledAt,
                    handed_over_at = :handedOverAt,
                    platform_specified_handover_at = :platformSpecifiedHandoverAt,
                    platform_label_requested_at = :platformLabelRequestedAt,
                    delivery_deadline_at = :deliveryDeadlineAt,
                    delivered_at = :deliveredAt,
                    version = version + 1,
                    updated_at = now()
                WHERE tenant_id = :tenantId AND order_id = :orderId
                  AND version = :expectedVersion
                """, parameters) == 1;
    }

    public Optional<OrderProfile> find(UUID tenantId, UUID orderId) {
        return jdbc.query("""
                SELECT * FROM tenant_order_profiles
                WHERE tenant_id = :tenantId AND order_id = :orderId
                """, new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("orderId", orderId),
                OrderProfileStore::mapProfile)
                .stream().findFirst();
    }

    public boolean referencesAreTenantOwned(
            UUID tenantId, UUID warehouseId, OrderProfile profile) {
        if (profile.locationId() != null) {
            Integer count = jdbc.queryForObject("""
                    SELECT count(*)
                    FROM tenant_warehouse_locations
                    WHERE tenant_id = :tenantId AND id = :locationId
                      AND (:warehouseId IS NULL OR warehouse_id = :warehouseId)
                      AND status = 'ACTIVE'
                    """, new MapSqlParameterSource()
                            .addValue("tenantId", tenantId)
                            .addValue("locationId", profile.locationId())
                            .addValue("warehouseId", warehouseId),
                    Integer.class);
            if (count == null || count != 1) {
                return false;
            }
        }
        List<UUID> users = java.util.stream.Stream.of(
                profile.pickerUserId(), profile.shipperUserId(),
                profile.salespersonUserId(), profile.purchaserUserId(),
                profile.developerUserId(), profile.managerUserId())
                .filter(java.util.Objects::nonNull).distinct().toList();
        if (users.isEmpty()) {
            return true;
        }
        Integer count = jdbc.queryForObject("""
                SELECT count(*)
                FROM users
                WHERE tenant_id = :tenantId AND id IN (:userIds)
                  AND status = 'ACTIVE'
                """, new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("userIds", users),
                Integer.class);
        return count != null && count == users.size();
    }

    public void appendActivity(
            UUID tenantId, UUID orderId, String type, String summary,
            UUID actorUserId, UUID actorSystemAdminId, String requestId) {
        jdbc.update("""
                INSERT INTO tenant_order_activity (
                    tenant_id, order_id, activity_type, safe_summary,
                    actor_user_id, actor_system_admin_id, request_id
                ) VALUES (
                    :tenantId, :orderId, :type, :summary,
                    :actorUserId, :actorSystemAdminId, :requestId
                )
                """, new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("orderId", orderId)
                        .addValue("type", type)
                        .addValue("summary", summary)
                        .addValue("actorUserId", actorUserId)
                        .addValue("actorSystemAdminId", actorSystemAdminId)
                        .addValue("requestId", requestId));
    }

    public List<OrderActivity> activities(UUID tenantId, UUID orderId) {
        return jdbc.query("""
                SELECT id, activity_type, safe_summary, created_at
                FROM tenant_order_activity
                WHERE tenant_id = :tenantId AND order_id = :orderId
                ORDER BY created_at DESC, id DESC
                LIMIT 200
                """, new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("orderId", orderId),
                (rs, row) -> new OrderActivity(
                        rs.getObject("id", UUID.class),
                        rs.getString("activity_type"),
                        rs.getString("safe_summary"),
                        rs.getTimestamp("created_at").toInstant()));
    }

    private static MapSqlParameterSource parameters(
            UUID tenantId, UUID orderId, OrderProfile profile) {
        return new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("orderId", orderId)
                .addValue("salesRecordNumber", profile.salesRecordNumber())
                .addValue("shoppingCartReference", profile.shoppingCartReference())
                .addValue("customOrderReference", profile.customOrderReference())
                .addValue("customerId", profile.customerId())
                .addValue("customerCode", profile.customerCode())
                .addValue("recipientName", profile.recipientName())
                .addValue("recipientPhone", profile.recipientPhone())
                .addValue("recipientEmail", profile.recipientEmail())
                .addValue("recipientCompany", profile.recipientCompany())
                .addValue("addressLine1", profile.addressLine1())
                .addValue("addressLine2", profile.addressLine2())
                .addValue("city", profile.city())
                .addValue("district", profile.district())
                .addValue("town", profile.town())
                .addValue("doorCode", profile.doorCode())
                .addValue("shippingService", profile.shippingService())
                .addValue("trackingReference", profile.trackingReference())
                .addValue("secondaryTrackingReference",
                        profile.secondaryTrackingReference())
                .addValue("itemAmountMinor", profile.itemAmountMinor())
                .addValue("platformFeeMinor", profile.platformFeeMinor())
                .addValue("insuranceFeeMinor", profile.insuranceFeeMinor())
                .addValue("paymentFeeMinor", profile.paymentFeeMinor())
                .addValue("otherIncomeMinor", profile.otherIncomeMinor())
                .addValue("otherExpenseMinor", profile.otherExpenseMinor())
                .addValue("actualPaidMinor", profile.actualPaidMinor())
                .addValue("profitMinor", profile.profitMinor())
                .addValue("taxMinor", profile.taxMinor())
                .addValue("estimatedShippingMinor",
                        profile.estimatedShippingMinor())
                .addValue("actualShippingMinor", profile.actualShippingMinor())
                .addValue("platformMessage", profile.platformMessage())
                .addValue("platformRemark", profile.platformRemark())
                .addValue("orderRemark", profile.orderRemark())
                .addValue("declarationPlan", profile.declarationPlan())
                .addValue("declarationActual", profile.declarationActual())
                .addValue("customerCategory", profile.customerCategory())
                .addValue("productKindCount", profile.productKindCount())
                .addValue("locationId", profile.locationId())
                .addValue("pickerUserId", profile.pickerUserId())
                .addValue("shipperUserId", profile.shipperUserId())
                .addValue("salespersonUserId", profile.salespersonUserId())
                .addValue("purchaserUserId", profile.purchaserUserId())
                .addValue("developerUserId", profile.developerUserId())
                .addValue("managerUserId", profile.managerUserId())
                .addValue("supplierReference", profile.supplierReference())
                .addValue("parentProductCategory",
                        profile.parentProductCategory())
                .addValue("childProductCategory", profile.childProductCategory())
                .addValue("productStatus", profile.productStatus())
                .addValue("extendedAttribute", profile.extendedAttribute())
                .addValue("printedAt", timestamp(profile.printedAt()))
                .addValue("platformReturnedAt",
                        timestamp(profile.platformReturnedAt()))
                .addValue("exceptionReviewedAt",
                        timestamp(profile.exceptionReviewedAt()))
                .addValue("cancelledAt", timestamp(profile.cancelledAt()))
                .addValue("handedOverAt", timestamp(profile.handedOverAt()))
                .addValue("platformSpecifiedHandoverAt",
                        timestamp(profile.platformSpecifiedHandoverAt()))
                .addValue("platformLabelRequestedAt",
                        timestamp(profile.platformLabelRequestedAt()))
                .addValue("deliveryDeadlineAt",
                        timestamp(profile.deliveryDeadlineAt()))
                .addValue("deliveredAt", timestamp(profile.deliveredAt()));
    }

    private static OrderProfile mapProfile(ResultSet rs, int row)
            throws SQLException {
        return new OrderProfile(
                rs.getString("sales_record_number"),
                rs.getString("shopping_cart_reference"),
                rs.getString("custom_order_reference"),
                rs.getString("customer_id"),
                rs.getString("customer_code"),
                rs.getString("recipient_name"),
                rs.getString("recipient_phone"),
                rs.getString("recipient_email"),
                rs.getString("recipient_company"),
                rs.getString("address_line1"),
                rs.getString("address_line2"),
                rs.getString("city"),
                rs.getString("district"),
                rs.getString("town"),
                rs.getString("door_code"),
                rs.getString("shipping_service"),
                rs.getString("tracking_reference"),
                rs.getString("secondary_tracking_reference"),
                longOrNull(rs, "item_amount_minor"),
                longOrNull(rs, "platform_fee_minor"),
                longOrNull(rs, "insurance_fee_minor"),
                longOrNull(rs, "payment_fee_minor"),
                longOrNull(rs, "other_income_minor"),
                longOrNull(rs, "other_expense_minor"),
                longOrNull(rs, "actual_paid_minor"),
                longOrNull(rs, "profit_minor"),
                longOrNull(rs, "tax_minor"),
                longOrNull(rs, "estimated_shipping_minor"),
                longOrNull(rs, "actual_shipping_minor"),
                rs.getString("platform_message"),
                rs.getString("platform_remark"),
                rs.getString("order_remark"),
                rs.getString("declaration_plan"),
                rs.getString("declaration_actual"),
                rs.getString("customer_category"),
                integerOrNull(rs, "product_kind_count"),
                uuidOrNull(rs, "location_id"),
                uuidOrNull(rs, "picker_user_id"),
                uuidOrNull(rs, "shipper_user_id"),
                uuidOrNull(rs, "salesperson_user_id"),
                uuidOrNull(rs, "purchaser_user_id"),
                uuidOrNull(rs, "developer_user_id"),
                uuidOrNull(rs, "manager_user_id"),
                rs.getString("supplier_reference"),
                rs.getString("parent_product_category"),
                rs.getString("child_product_category"),
                rs.getString("product_status"),
                rs.getString("extended_attribute"),
                instantOrNull(rs, "printed_at"),
                instantOrNull(rs, "platform_returned_at"),
                instantOrNull(rs, "exception_reviewed_at"),
                instantOrNull(rs, "cancelled_at"),
                instantOrNull(rs, "handed_over_at"),
                instantOrNull(rs, "platform_specified_handover_at"),
                instantOrNull(rs, "platform_label_requested_at"),
                instantOrNull(rs, "delivery_deadline_at"),
                instantOrNull(rs, "delivered_at"),
                rs.getLong("version"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }

    private static Long longOrNull(ResultSet rs, String column)
            throws SQLException {
        return rs.getObject(column) == null ? null : rs.getLong(column);
    }

    private static Integer integerOrNull(ResultSet rs, String column)
            throws SQLException {
        return rs.getObject(column) == null ? null : rs.getInt(column);
    }

    private static UUID uuidOrNull(ResultSet rs, String column)
            throws SQLException {
        return rs.getObject(column) == null
                ? null : rs.getObject(column, UUID.class);
    }

    private static java.time.Instant instantOrNull(
            ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private static Timestamp timestamp(java.time.Instant value) {
        return value == null ? null : Timestamp.from(value);
    }
}
