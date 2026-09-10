package cn.xzkj.erp.platformadmin.privacy;

import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyComplianceOutcome;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyComplianceRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyComplianceTopic;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class ShopifyComplianceRepository {

    private static final int MAX_EXPORT_ORDERS = 1_000;
    private static final int MAX_EXPORT_LINES = 50_000;

    private final NamedParameterJdbcTemplate jdbc;

    public ShopifyComplianceRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Execution recordSeen(ShopifyComplianceRequest request) {
        if (!shopExists(request.tenantId(), request.shopId())) {
            throw new IllegalStateException("Shopify compliance shop is unavailable");
        }
        Instant occurredAt = request.occurredAt().truncatedTo(ChronoUnit.MICROS);
        jdbc.update("""
                INSERT INTO shopify_compliance_executions (
                    event_id, tenant_id, shop_id, topic, occurred_at, due_at
                ) VALUES (
                    :eventId, :tenantId, :shopId, :topic,
                    :occurredAt, :dueAt
                )
                ON CONFLICT (event_id) DO NOTHING
                """, new MapSqlParameterSource()
                .addValue("eventId", request.eventId())
                .addValue("tenantId", request.tenantId())
                .addValue("shopId", request.shopId())
                .addValue("topic", request.topic().name())
                .addValue("occurredAt", Timestamp.from(occurredAt))
                .addValue("dueAt", Timestamp.from(
                        occurredAt.plusSeconds(30L * 24 * 60 * 60))));
        Execution execution = find(request.eventId())
                .orElseThrow(IllegalStateException::new);
        if (!execution.tenantId().equals(request.tenantId())
                || !execution.shopId().equals(request.shopId())
                || execution.topic() != request.topic()
                || !execution.occurredAt().equals(occurredAt)) {
            throw new IllegalStateException("Shopify compliance event conflicts with recorded identity");
        }
        return execution;
    }

    public Optional<Execution> find(String eventId) {
        return jdbc.query("""
                SELECT event_id, tenant_id, shop_id, topic, occurred_at,
                       due_at, record_count, export_prepared_at,
                       data_redacted_at, delivery_confirmed_at,
                       completion_outcome, connector_completed_at,
                       attempt_count, last_attempt_at, last_error_code
                FROM shopify_compliance_executions
                WHERE event_id = :eventId
                """, new MapSqlParameterSource("eventId", eventId),
                ShopifyComplianceRepository::execution)
                .stream().findFirst();
    }

    @Transactional(readOnly = true)
    public CustomerDataExport loadCustomerData(
            ShopifyComplianceRequest request) {
        References references = references(request);
        MapSqlParameterSource parameters = parameters(request, references)
                .addValue("limit", MAX_EXPORT_ORDERS + 1);
        List<ExportOrder> orders = jdbc.query("""
                SELECT o.id, o.external_order_ref, o.currency,
                       o.buyer_reference, o.status, o.platform_status,
                       o.payment_status, o.total_amount_minor,
                       o.shipping_amount_minor, o.placed_at,
                       o.paid_at, o.shipped_at,
                       profile.delivered_at,
                       o.country_code, o.province, o.postal_code,
                       profile.customer_id, profile.recipient_name,
                       profile.recipient_phone, profile.recipient_email,
                       profile.recipient_company, profile.address_line1,
                       profile.address_line2, profile.city,
                       profile.district, profile.town, profile.door_code,
                       profile.shipping_service,
                       profile.tracking_reference,
                       profile.secondary_tracking_reference,
                       profile.platform_message, profile.platform_remark,
                       profile.order_remark
                FROM tenant_orders o
                LEFT JOIN tenant_order_profiles profile
                  ON profile.tenant_id = o.tenant_id
                 AND profile.order_id = o.id
                WHERE o.tenant_id = :tenantId
                  AND o.shop_id = :shopId
                  AND (
                    profile.customer_id IN (:customerRefs)
                    OR o.external_order_ref IN (:orderRefs)
                  )
                ORDER BY o.placed_at, o.id
                LIMIT :limit
                """, parameters, ShopifyComplianceRepository::exportOrder);
        if (orders.size() > MAX_EXPORT_ORDERS) {
            throw new IllegalStateException("Shopify compliance export exceeds the safe order limit");
        }
        if (orders.isEmpty()) {
            return new CustomerDataExport(references.customerIds(),
                    references.orderIds(), List.of());
        }
        List<UUID> orderIds = orders.stream().map(ExportOrder::internalId).toList();
        List<ExportLine> lines = jdbc.query("""
                SELECT line.order_id, line.external_line_ref,
                       line.title_snapshot, line.platform_sku,
                       line.quantity, line.unit_price_minor, line.currency
                FROM tenant_order_lines line
                WHERE line.tenant_id = :tenantId
                  AND line.order_id IN (:orderIds)
                ORDER BY line.order_id, line.created_at, line.id
                LIMIT :lineLimit
                """, new MapSqlParameterSource()
                .addValue("tenantId", request.tenantId())
                .addValue("orderIds", orderIds)
                .addValue("lineLimit", MAX_EXPORT_LINES + 1),
                ShopifyComplianceRepository::exportLine);
        if (lines.size() > MAX_EXPORT_LINES) {
            throw new IllegalStateException("Shopify compliance export exceeds the safe line limit");
        }
        Map<UUID, List<ExportLine>> byOrder = new LinkedHashMap<>();
        for (ExportLine line : lines) {
            byOrder.computeIfAbsent(line.orderId(), ignored -> new ArrayList<>())
                    .add(line);
        }
        List<ExportOrder> complete = orders.stream()
                .map(order -> order.withLines(byOrder.getOrDefault(
                        order.internalId(), List.of())))
                .toList();
        return new CustomerDataExport(references.customerIds(),
                references.orderIds(), complete);
    }

    @Transactional
    public int anonymize(ShopifyComplianceRequest request) {
        Execution execution = recordSeen(request);
        if (execution.dataRedactedAt() != null) {
            return execution.recordCount() == null
                    ? 0 : execution.recordCount();
        }
        References references = references(request);
        boolean allOrders = request.topic() == ShopifyComplianceTopic.SHOP_REDACT;
        MapSqlParameterSource parameters = parameters(request, references)
                .addValue("allOrders", allOrders);
        List<UUID> orderIds = jdbc.query("""
                SELECT o.id
                FROM tenant_orders o
                LEFT JOIN tenant_order_profiles profile
                  ON profile.tenant_id = o.tenant_id
                 AND profile.order_id = o.id
                WHERE o.tenant_id = :tenantId
                  AND o.shop_id = :shopId
                  AND (
                    :allOrders = TRUE
                    OR profile.customer_id IN (:customerRefs)
                    OR o.external_order_ref IN (:orderRefs)
                  )
                ORDER BY o.id
                """, parameters,
                (rs, row) -> rs.getObject("id", UUID.class));
        if (!orderIds.isEmpty()) {
            MapSqlParameterSource orderParameters = new MapSqlParameterSource()
                    .addValue("tenantId", request.tenantId())
                    .addValue("orderIds", orderIds);
            jdbc.update("""
                    UPDATE tenant_orders SET
                        buyer_reference = NULL,
                        country_code = NULL,
                        province = NULL,
                        postal_code = NULL,
                        buyer_selected_logistics = NULL,
                        version = version + 1,
                        updated_at = now()
                    WHERE tenant_id = :tenantId AND id IN (:orderIds)
                    """, orderParameters);
            jdbc.update("""
                    UPDATE tenant_order_profiles SET
                        sales_record_number = NULL,
                        shopping_cart_reference = NULL,
                        custom_order_reference = NULL,
                        customer_id = NULL,
                        customer_code = NULL,
                        recipient_name = NULL,
                        recipient_phone = NULL,
                        recipient_email = NULL,
                        recipient_company = NULL,
                        address_line1 = NULL,
                        address_line2 = NULL,
                        city = NULL,
                        district = NULL,
                        town = NULL,
                        door_code = NULL,
                        tracking_reference = NULL,
                        secondary_tracking_reference = NULL,
                        platform_message = NULL,
                        platform_remark = NULL,
                        order_remark = NULL,
                        declaration_plan = NULL,
                        declaration_actual = NULL,
                        customer_category = NULL,
                        version = version + 1,
                        updated_at = now()
                    WHERE tenant_id = :tenantId AND order_id IN (:orderIds)
                    """, orderParameters);
            jdbc.update("""
                    UPDATE tenant_logistics_tracking_numbers number SET
                        tracking_reference = 'redacted:' || number.id::text,
                        lifecycle_status = 'ARCHIVED',
                        used_plan_id = NULL,
                        used_package_id = NULL,
                        used_at = NULL,
                        version = number.version + 1,
                        updated_at = now()
                    FROM tenant_fulfillment_packages package,
                         tenant_fulfillment_plans plan
                    WHERE number.tenant_id = :tenantId
                      AND number.tenant_id = package.tenant_id
                      AND number.used_package_id = package.id
                      AND package.tenant_id = plan.tenant_id
                      AND package.plan_id = plan.id
                      AND plan.order_id IN (:orderIds)
                    """, orderParameters);
            jdbc.update("""
                    UPDATE tenant_shipment_events event SET
                        tracking_reference = NULL
                    FROM tenant_fulfillment_plans plan
                    WHERE event.tenant_id = :tenantId
                      AND event.tenant_id = plan.tenant_id
                      AND event.plan_id = plan.id
                      AND plan.order_id IN (:orderIds)
                    """, orderParameters);
            jdbc.update("""
                    UPDATE tenant_fulfillment_packages package SET
                        logistics_provider_order_reference = NULL,
                        logistics_tracking_reference = NULL,
                        logistics_label_url = NULL,
                        logistics_tracking_summary = NULL,
                        version = package.version + 1,
                        updated_at = now()
                    FROM tenant_fulfillment_plans plan
                    WHERE package.tenant_id = :tenantId
                      AND package.tenant_id = plan.tenant_id
                      AND package.plan_id = plan.id
                      AND plan.order_id IN (:orderIds)
                    """, orderParameters);
        }
        int affected = orderIds.size();
        if (allOrders) {
            jdbc.update("""
                    UPDATE shop_authorizations SET
                        status = 'REVOKED',
                        credential_reference = NULL,
                        provider_account_ref = NULL,
                        scope_summary = NULL,
                        expires_at = NULL,
                        last_verified_at = NULL,
                        error_summary = NULL,
                        revoked_at = coalesce(revoked_at, now()),
                        version = version + 1,
                        updated_at = now()
                    WHERE tenant_id = :tenantId AND shop_id = :shopId
                    """, parameters);
            jdbc.update("""
                    UPDATE tenant_shops SET
                        external_shop_ref = 'redacted:' || id::text,
                        display_name = '已删除 Shopify 店铺',
                        status = 'ARCHIVED',
                        version = version + 1,
                        updated_at = now()
                    WHERE tenant_id = :tenantId AND id = :shopId
                    """, parameters);
            affected++;
        }
        jdbc.update("""
                UPDATE shopify_compliance_executions SET
                    record_count = :recordCount,
                    data_redacted_at = now(),
                    attempt_count = attempt_count + 1,
                    last_attempt_at = now(),
                    last_error_code = NULL,
                    updated_at = now()
                WHERE event_id = :eventId
                  AND data_redacted_at IS NULL
                """, new MapSqlParameterSource()
                .addValue("recordCount", affected)
                .addValue("eventId", request.eventId()));
        return affected;
    }

    public void markExportPrepared(String eventId, int recordCount) {
        jdbc.update("""
                UPDATE shopify_compliance_executions SET
                    record_count = :recordCount,
                    export_prepared_at = now(),
                    attempt_count = attempt_count + 1,
                    last_attempt_at = now(),
                    last_error_code = NULL,
                    updated_at = now()
                WHERE event_id = :eventId
                """, new MapSqlParameterSource()
                .addValue("recordCount", recordCount)
                .addValue("eventId", eventId));
    }

    public void updateRedactionRecordCount(String eventId, int recordCount) {
        jdbc.update("""
                UPDATE shopify_compliance_executions SET
                    record_count = :recordCount,
                    updated_at = now()
                WHERE event_id = :eventId
                  AND data_redacted_at IS NOT NULL
                """, new MapSqlParameterSource()
                .addValue("recordCount", recordCount)
                .addValue("eventId", eventId));
    }

    public void markCompleted(
            String eventId,
            ShopifyComplianceOutcome outcome,
            Instant completedAt,
            boolean deliveryConfirmed) {
        jdbc.update("""
                UPDATE shopify_compliance_executions SET
                    delivery_confirmed_at = CASE WHEN :deliveryConfirmed
                        THEN coalesce(delivery_confirmed_at, now())
                        ELSE delivery_confirmed_at END,
                    completion_outcome = :outcome,
                    connector_completed_at = :completedAt,
                    attempt_count = attempt_count + 1,
                    last_attempt_at = now(),
                    last_error_code = NULL,
                    updated_at = now()
                WHERE event_id = :eventId
                """, new MapSqlParameterSource()
                .addValue("deliveryConfirmed", deliveryConfirmed)
                .addValue("outcome", outcome.name())
                .addValue("completedAt", Timestamp.from(completedAt))
                .addValue("eventId", eventId));
    }

    public void markFailure(String eventId, String errorCode) {
        jdbc.update("""
                UPDATE shopify_compliance_executions SET
                    attempt_count = attempt_count + 1,
                    last_attempt_at = now(),
                    last_error_code = :errorCode,
                    updated_at = now()
                WHERE event_id = :eventId
                """, new MapSqlParameterSource()
                .addValue("errorCode", errorCode)
                .addValue("eventId", eventId));
    }

    private boolean shopExists(UUID tenantId, UUID shopId) {
        Integer count = jdbc.queryForObject("""
                SELECT count(*)
                FROM tenant_shops shop
                JOIN platform_catalog platform ON platform.id = shop.platform_id
                WHERE shop.tenant_id = :tenantId
                  AND shop.id = :shopId
                  AND platform.code = 'SHOPIFY'
                """, new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("shopId", shopId), Integer.class);
        return count != null && count == 1;
    }

    private static MapSqlParameterSource parameters(
            ShopifyComplianceRequest request,
            References references) {
        return new MapSqlParameterSource()
                .addValue("tenantId", request.tenantId())
                .addValue("shopId", request.shopId())
                .addValue("customerRefs", references.customerGids())
                .addValue("orderRefs", references.orderGids());
    }

    private static References references(ShopifyComplianceRequest request) {
        List<String> customerIds = new ArrayList<>();
        List<String> orderIds = new ArrayList<>();
        for (String reference : request.referenceIds()) {
            if (reference.startsWith("customer:")) {
                customerIds.add(reference.substring("customer:".length()));
            } else if (reference.startsWith("order:")) {
                orderIds.add(reference.substring("order:".length()));
            }
        }
        List<String> customerGids = customerIds.stream()
                .map(value -> "gid://shopify/Customer/" + value).toList();
        List<String> orderGids = orderIds.stream()
                .map(value -> "gid://shopify/Order/" + value).toList();
        return new References(
                List.copyOf(customerIds),
                List.copyOf(orderIds),
                customerGids.isEmpty() ? List.of("__none__") : customerGids,
                orderGids.isEmpty() ? List.of("__none__") : orderGids);
    }

    private static Execution execution(ResultSet rs, int row)
            throws SQLException {
        return new Execution(
                rs.getString("event_id"),
                rs.getObject("tenant_id", UUID.class),
                rs.getObject("shop_id", UUID.class),
                ShopifyComplianceTopic.valueOf(rs.getString("topic")),
                instant(rs, "occurred_at"),
                instant(rs, "due_at"),
                integer(rs, "record_count"),
                instantNullable(rs, "export_prepared_at"),
                instantNullable(rs, "data_redacted_at"),
                instantNullable(rs, "delivery_confirmed_at"),
                outcome(rs.getString("completion_outcome")),
                instantNullable(rs, "connector_completed_at"),
                rs.getInt("attempt_count"),
                instantNullable(rs, "last_attempt_at"),
                rs.getString("last_error_code"));
    }

    private static ExportOrder exportOrder(ResultSet rs, int row)
            throws SQLException {
        return new ExportOrder(
                rs.getObject("id", UUID.class),
                rs.getString("external_order_ref"),
                rs.getString("currency"),
                rs.getString("buyer_reference"),
                rs.getString("status"),
                rs.getString("platform_status"),
                rs.getString("payment_status"),
                longValue(rs, "total_amount_minor"),
                longValue(rs, "shipping_amount_minor"),
                instant(rs, "placed_at"),
                instantNullable(rs, "paid_at"),
                instantNullable(rs, "shipped_at"),
                instantNullable(rs, "delivered_at"),
                rs.getString("country_code"),
                rs.getString("province"),
                rs.getString("postal_code"),
                rs.getString("customer_id"),
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
                rs.getString("platform_message"),
                rs.getString("platform_remark"),
                rs.getString("order_remark"),
                List.of());
    }

    private static ExportLine exportLine(ResultSet rs, int row)
            throws SQLException {
        return new ExportLine(
                rs.getObject("order_id", UUID.class),
                rs.getString("external_line_ref"),
                rs.getString("title_snapshot"),
                rs.getString("platform_sku"),
                rs.getInt("quantity"),
                rs.getLong("unit_price_minor"),
                rs.getString("currency"));
    }

    private static Instant instant(ResultSet rs, String column)
            throws SQLException {
        return rs.getTimestamp(column).toInstant();
    }

    private static Instant instantNullable(ResultSet rs, String column)
            throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private static Integer integer(ResultSet rs, String column)
            throws SQLException {
        return rs.getObject(column) == null ? null : rs.getInt(column);
    }

    private static Long longValue(ResultSet rs, String column)
            throws SQLException {
        return rs.getObject(column) == null ? null : rs.getLong(column);
    }

    private static ShopifyComplianceOutcome outcome(String value) {
        return value == null ? null : ShopifyComplianceOutcome.valueOf(value);
    }

    private record References(
            List<String> customerIds,
            List<String> orderIds,
            List<String> customerGids,
            List<String> orderGids) {
    }

    public record Execution(
            String eventId,
            UUID tenantId,
            UUID shopId,
            ShopifyComplianceTopic topic,
            Instant occurredAt,
            Instant dueAt,
            Integer recordCount,
            Instant exportPreparedAt,
            Instant dataRedactedAt,
            Instant deliveryConfirmedAt,
            ShopifyComplianceOutcome completionOutcome,
            Instant connectorCompletedAt,
            int attemptCount,
            Instant lastAttemptAt,
            String lastErrorCode) {
    }

    public record CustomerDataExport(
            List<String> shopifyCustomerIds,
            List<String> requestedShopifyOrderIds,
            List<ExportOrder> orders) {
    }

    public record ExportOrder(
            UUID internalId,
            String shopifyOrderId,
            String currency,
            String buyerReference,
            String orderStatus,
            String platformStatus,
            String paymentStatus,
            Long totalAmountMinor,
            Long shippingAmountMinor,
            Instant placedAt,
            Instant paidAt,
            Instant shippedAt,
            Instant deliveredAt,
            String countryCode,
            String province,
            String postalCode,
            String shopifyCustomerId,
            String recipientName,
            String recipientPhone,
            String recipientEmail,
            String recipientCompany,
            String addressLine1,
            String addressLine2,
            String city,
            String district,
            String town,
            String doorCode,
            String shippingService,
            String trackingReference,
            String secondaryTrackingReference,
            String platformMessage,
            String platformRemark,
            String orderRemark,
            List<ExportLine> lines) {

        ExportOrder withLines(List<ExportLine> value) {
            return new ExportOrder(
                    internalId, shopifyOrderId, currency, buyerReference,
                    orderStatus, platformStatus, paymentStatus,
                    totalAmountMinor, shippingAmountMinor, placedAt, paidAt,
                    shippedAt, deliveredAt, countryCode, province, postalCode,
                    shopifyCustomerId, recipientName, recipientPhone,
                    recipientEmail, recipientCompany, addressLine1,
                    addressLine2, city, district, town, doorCode,
                    shippingService, trackingReference,
                    secondaryTrackingReference, platformMessage,
                    platformRemark, orderRemark, List.copyOf(value));
        }
    }

    public record ExportLine(
            UUID orderId,
            String shopifyLineItemId,
            String title,
            String sku,
            int quantity,
            long unitPriceMinor,
            String currency) {
    }
}
