package cn.xzkj.erp.order.repository;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderLineDiscountType;
import cn.xzkj.erp.platform.service.ConflictException;

@Repository
public class ShopifyOrderLineDiscountCommandRepository {

    private static final Duration LEASE = Duration.ofMinutes(2);

    private final JdbcTemplate jdbc;

    public ShopifyOrderLineDiscountCommandRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public Reservation reserve(
            UUID tenantId,
            UUID shopId,
            UUID orderId,
            UUID orderLineId,
            String externalOrderRef,
            String externalOrderLineRef,
            String externalVariantRef,
            int expectedQuantity,
            long expectedDiscountTotalMinor,
            String description,
            OrderLineDiscountType discountType,
            Long fixedValueMinor,
            Integer percentBasisPoints,
            String currency,
            boolean notifyCustomer,
            String idempotencyKey,
            String fingerprint) {
        jdbc.queryForObject(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class,
                tenantId + ":shopify-line-discount-command:"
                        + idempotencyKey);
        jdbc.queryForObject(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class,
                tenantId + ":shopify-line-discount:" + orderLineId);
        var rows = jdbc.query("""
                select shop_id, order_id, order_line_id,
                       external_order_ref, external_order_line_ref,
                       external_variant_ref, expected_quantity,
                       expected_discount_total_minor, discount_description,
                       discount_type, fixed_value_minor, percent_basis_points,
                       currency, notify_customer, request_fingerprint,
                       status, locked_until, response_discount_total_minor,
                       response_total_minor, response_currency
                from tenant_shopify_order_line_discount_commands
                where tenant_id = ? and idempotency_key = ?
                for update
                """, (rs, row) -> new Existing(
                        rs.getObject("shop_id", UUID.class),
                        rs.getObject("order_id", UUID.class),
                        rs.getObject("order_line_id", UUID.class),
                        rs.getString("external_order_ref"),
                        rs.getString("external_order_line_ref"),
                        rs.getString("external_variant_ref"),
                        rs.getInt("expected_quantity"),
                        rs.getLong("expected_discount_total_minor"),
                        rs.getString("discount_description"),
                        OrderLineDiscountType.valueOf(
                                rs.getString("discount_type")),
                        (Long) rs.getObject("fixed_value_minor"),
                        (Integer) rs.getObject("percent_basis_points"),
                        rs.getString("currency"),
                        rs.getBoolean("notify_customer"),
                        rs.getString("request_fingerprint"),
                        rs.getString("status"),
                        rs.getTimestamp("locked_until") == null
                                ? null
                                : rs.getTimestamp("locked_until").toInstant(),
                        (Long) rs.getObject("response_discount_total_minor"),
                        (Long) rs.getObject("response_total_minor"),
                        rs.getString("response_currency")),
                tenantId, idempotencyKey);
        Instant now = Instant.now();
        if (rows.isEmpty()) {
            Integer active = jdbc.queryForObject("""
                    select count(*)
                    from tenant_shopify_order_line_discount_commands
                    where tenant_id = ? and order_line_id = ?
                      and status in ('PENDING', 'UNCERTAIN')
                    """, Integer.class, tenantId, orderLineId);
            if (active != null && active > 0) {
                throw new ConflictException(
                        "Another Shopify line discount requires recovery");
            }
            jdbc.update("""
                    insert into tenant_shopify_order_line_discount_commands (
                        tenant_id, idempotency_key, shop_id, order_id,
                        order_line_id, external_order_ref,
                        external_order_line_ref, external_variant_ref,
                        expected_quantity, expected_discount_total_minor,
                        discount_description, discount_type,
                        fixed_value_minor, percent_basis_points, currency,
                        notify_customer, request_fingerprint,
                        status, locked_until
                    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
                    """, tenantId, idempotencyKey, shopId, orderId,
                    orderLineId, externalOrderRef, externalOrderLineRef,
                    externalVariantRef, expectedQuantity,
                    expectedDiscountTotalMinor, description,
                    discountType.name(), fixedValueMinor,
                    percentBasisPoints, currency, notifyCustomer,
                    fingerprint, Timestamp.from(now.plus(LEASE)));
            return new Reservation(false, false, null, null, null);
        }
        Existing existing = rows.getFirst();
        if (!existing.matches(
                shopId, orderId, orderLineId, externalOrderRef,
                externalOrderLineRef, externalVariantRef, expectedQuantity,
                expectedDiscountTotalMinor, description, discountType,
                fixedValueMinor, percentBasisPoints, currency,
                notifyCustomer, fingerprint)) {
            throw new ConflictException(
                    "Idempotency key is already used for another Shopify order edit");
        }
        if ("SUCCEEDED".equals(existing.status())) {
            return new Reservation(
                    true, true, existing.responseDiscountTotalMinor(),
                    existing.responseTotalMinor(), existing.responseCurrency());
        }
        if ("PENDING".equals(existing.status())
                && existing.lockedUntil() != null
                && existing.lockedUntil().isAfter(now)) {
            throw new ConflictException(
                    "Shopify order edit is already in progress");
        }
        jdbc.update("""
                update tenant_shopify_order_line_discount_commands
                set status = 'PENDING', attempt_count = attempt_count + 1,
                    locked_until = ?, safe_error_code = null,
                    updated_at = now()
                where tenant_id = ? and idempotency_key = ?
                """, Timestamp.from(now.plus(LEASE)), tenantId,
                idempotencyKey);
        return new Reservation(true, false, null, null, null);
    }

    public void markSucceeded(
            UUID tenantId,
            String idempotencyKey,
            String fingerprint,
            long discountTotalMinor,
            long totalMinor,
            String currency) {
        int changed = jdbc.update("""
                update tenant_shopify_order_line_discount_commands
                set status = 'SUCCEEDED',
                    response_discount_total_minor = ?,
                    response_total_minor = ?, response_currency = ?,
                    locked_until = null, safe_error_code = null,
                    completed_at = now(), updated_at = now()
                where tenant_id = ? and idempotency_key = ?
                  and request_fingerprint = ? and status = 'PENDING'
                """, discountTotalMinor, totalMinor, currency,
                tenantId, idempotencyKey, fingerprint);
        if (changed != 1) {
            throw new ConflictException(
                    "Shopify order edit state changed concurrently");
        }
    }

    @Transactional
    public void markUncertain(
            UUID tenantId,
            String idempotencyKey,
            String fingerprint) {
        jdbc.update("""
                update tenant_shopify_order_line_discount_commands
                set status = 'UNCERTAIN', locked_until = null,
                    safe_error_code = 'SHOPIFY_ORDER_EDIT_UNCERTAIN',
                    updated_at = now()
                where tenant_id = ? and idempotency_key = ?
                  and request_fingerprint = ? and status = 'PENDING'
                """, tenantId, idempotencyKey, fingerprint);
    }

    public record Reservation(
            boolean existing,
            boolean replay,
            Long discountTotalMinor,
            Long totalMinor,
            String currency) {
    }

    private record Existing(
            UUID shopId,
            UUID orderId,
            UUID orderLineId,
            String externalOrderRef,
            String externalOrderLineRef,
            String externalVariantRef,
            int expectedQuantity,
            long expectedDiscountTotalMinor,
            String description,
            OrderLineDiscountType discountType,
            Long fixedValueMinor,
            Integer percentBasisPoints,
            String currency,
            boolean notifyCustomer,
            String fingerprint,
            String status,
            Instant lockedUntil,
            Long responseDiscountTotalMinor,
            Long responseTotalMinor,
            String responseCurrency) {

        boolean matches(
                UUID candidateShopId,
                UUID candidateOrderId,
                UUID candidateOrderLineId,
                String candidateOrderRef,
                String candidateOrderLineRef,
                String candidateVariantRef,
                int candidateExpectedQuantity,
                long candidateExpectedDiscountTotalMinor,
                String candidateDescription,
                OrderLineDiscountType candidateDiscountType,
                Long candidateFixedValueMinor,
                Integer candidatePercentBasisPoints,
                String candidateCurrency,
                boolean candidateNotifyCustomer,
                String candidateFingerprint) {
            return shopId.equals(candidateShopId)
                    && orderId.equals(candidateOrderId)
                    && orderLineId.equals(candidateOrderLineId)
                    && externalOrderRef.equals(candidateOrderRef)
                    && externalOrderLineRef.equals(candidateOrderLineRef)
                    && externalVariantRef.equals(candidateVariantRef)
                    && expectedQuantity == candidateExpectedQuantity
                    && expectedDiscountTotalMinor
                            == candidateExpectedDiscountTotalMinor
                    && description.equals(candidateDescription)
                    && discountType == candidateDiscountType
                    && java.util.Objects.equals(
                            fixedValueMinor, candidateFixedValueMinor)
                    && java.util.Objects.equals(
                            percentBasisPoints,
                            candidatePercentBasisPoints)
                    && currency.equals(candidateCurrency)
                    && notifyCustomer == candidateNotifyCustomer
                    && fingerprint.equals(candidateFingerprint);
        }
    }
}
