package cn.xzkj.erp.order.repository;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.platform.service.ConflictException;

@Repository
public class ShopifyOrderLineEditCommandRepository {

    private static final Duration LEASE = Duration.ofMinutes(2);

    private final JdbcTemplate jdbc;

    public ShopifyOrderLineEditCommandRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public Reservation reserve(
            UUID tenantId,
            UUID shopId,
            UUID orderId,
            UUID orderLineId,
            String externalOrderRef,
            String externalLineRef,
            String externalVariantRef,
            String idempotencyKey,
            String fingerprint,
            int expectedQuantity,
            int requestedQuantity,
            boolean restock,
            boolean notifyCustomer) {
        jdbc.queryForObject(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class,
                tenantId + ":shopify-line-edit-command:" + idempotencyKey);
        jdbc.queryForObject(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class,
                tenantId + ":shopify-line-edit:" + orderLineId);
        var rows = jdbc.query("""
                select shop_id, order_id, order_line_id,
                       external_order_ref, external_line_ref,
                       external_variant_ref, request_fingerprint,
                       expected_quantity, requested_quantity,
                       restock, notify_customer, status, locked_until,
                       response_quantity, response_total_minor,
                       response_currency
                from tenant_shopify_order_line_edit_commands
                where tenant_id = ? and idempotency_key = ?
                for update
                """, (rs, row) -> new Existing(
                        rs.getObject("shop_id", UUID.class),
                        rs.getObject("order_id", UUID.class),
                        rs.getObject("order_line_id", UUID.class),
                        rs.getString("external_order_ref"),
                        rs.getString("external_line_ref"),
                        rs.getString("external_variant_ref"),
                        rs.getString("request_fingerprint"),
                        rs.getInt("expected_quantity"),
                        rs.getInt("requested_quantity"),
                        rs.getBoolean("restock"),
                        rs.getBoolean("notify_customer"),
                        rs.getString("status"),
                        rs.getTimestamp("locked_until") == null
                                ? null : rs.getTimestamp("locked_until").toInstant(),
                        (Integer) rs.getObject("response_quantity"),
                        (Long) rs.getObject("response_total_minor"),
                        rs.getString("response_currency")),
                tenantId, idempotencyKey);
        Instant now = Instant.now();
        if (rows.isEmpty()) {
            Integer active = jdbc.queryForObject("""
                    select count(*)
                    from tenant_shopify_order_line_edit_commands
                    where tenant_id = ? and order_line_id = ?
                      and status in ('PENDING', 'UNCERTAIN')
                    """, Integer.class, tenantId, orderLineId);
            if (active != null && active > 0) {
                throw new ConflictException(
                        "Another Shopify edit for this order line requires recovery");
            }
            jdbc.update("""
                    insert into tenant_shopify_order_line_edit_commands (
                        tenant_id, idempotency_key, shop_id, order_id,
                        order_line_id, external_order_ref,
                        external_line_ref, external_variant_ref,
                        request_fingerprint, expected_quantity,
                        requested_quantity, restock, notify_customer,
                        status, locked_until
                    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
                    """, tenantId, idempotencyKey, shopId, orderId,
                    orderLineId, externalOrderRef, externalLineRef,
                    externalVariantRef, fingerprint, expectedQuantity,
                    requestedQuantity, restock, notifyCustomer,
                    Timestamp.from(now.plus(LEASE)));
            return new Reservation(false, false, null, null, null);
        }
        Existing existing = rows.getFirst();
        if (!existing.matches(
                shopId, orderId, orderLineId, externalOrderRef,
                externalLineRef, externalVariantRef, fingerprint,
                expectedQuantity, requestedQuantity, restock,
                notifyCustomer)) {
            throw new ConflictException(
                    "Idempotency key is already used for another Shopify order edit");
        }
        if ("SUCCEEDED".equals(existing.status())) {
            return new Reservation(
                    true, true, existing.responseQuantity(),
                    existing.responseTotalMinor(), existing.responseCurrency());
        }
        if ("PENDING".equals(existing.status())
                && existing.lockedUntil() != null
                && existing.lockedUntil().isAfter(now)) {
            throw new ConflictException(
                    "Shopify order edit is already in progress");
        }
        jdbc.update("""
                update tenant_shopify_order_line_edit_commands
                set status = 'PENDING', attempt_count = attempt_count + 1,
                    locked_until = ?, safe_error_code = null,
                    updated_at = now()
                where tenant_id = ? and idempotency_key = ?
                """, Timestamp.from(now.plus(LEASE)), tenantId, idempotencyKey);
        return new Reservation(true, false, null, null, null);
    }

    public void markSucceeded(
            UUID tenantId,
            String idempotencyKey,
            String fingerprint,
            int quantity,
            long totalMinor,
            String currency) {
        int changed = jdbc.update("""
                update tenant_shopify_order_line_edit_commands
                set status = 'SUCCEEDED', response_quantity = ?,
                    response_total_minor = ?, response_currency = ?,
                    locked_until = null, safe_error_code = null,
                    completed_at = now(), updated_at = now()
                where tenant_id = ? and idempotency_key = ?
                  and request_fingerprint = ? and status = 'PENDING'
                """, quantity, totalMinor, currency,
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
                update tenant_shopify_order_line_edit_commands
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
            Integer quantity,
            Long totalMinor,
            String currency) {
    }

    private record Existing(
            UUID shopId,
            UUID orderId,
            UUID orderLineId,
            String externalOrderRef,
            String externalLineRef,
            String externalVariantRef,
            String fingerprint,
            int expectedQuantity,
            int requestedQuantity,
            boolean restock,
            boolean notifyCustomer,
            String status,
            Instant lockedUntil,
            Integer responseQuantity,
            Long responseTotalMinor,
            String responseCurrency) {

        boolean matches(
                UUID candidateShopId,
                UUID candidateOrderId,
                UUID candidateOrderLineId,
                String candidateOrderRef,
                String candidateLineRef,
                String candidateVariantRef,
                String candidateFingerprint,
                int candidateExpectedQuantity,
                int candidateRequestedQuantity,
                boolean candidateRestock,
                boolean candidateNotifyCustomer) {
            return shopId.equals(candidateShopId)
                    && orderId.equals(candidateOrderId)
                    && orderLineId.equals(candidateOrderLineId)
                    && externalOrderRef.equals(candidateOrderRef)
                    && externalLineRef.equals(candidateLineRef)
                    && externalVariantRef.equals(candidateVariantRef)
                    && fingerprint.equals(candidateFingerprint)
                    && expectedQuantity == candidateExpectedQuantity
                    && requestedQuantity == candidateRequestedQuantity
                    && restock == candidateRestock
                    && notifyCustomer == candidateNotifyCustomer;
        }
    }
}
