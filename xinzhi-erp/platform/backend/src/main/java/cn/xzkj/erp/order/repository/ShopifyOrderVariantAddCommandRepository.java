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
public class ShopifyOrderVariantAddCommandRepository {

    private static final Duration LEASE = Duration.ofMinutes(2);

    private final JdbcTemplate jdbc;

    public ShopifyOrderVariantAddCommandRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public Reservation reserve(
            UUID tenantId,
            UUID shopId,
            UUID orderId,
            UUID listingId,
            UUID skuId,
            String externalOrderRef,
            String externalListingRef,
            String externalVariantRef,
            String idempotencyKey,
            String fingerprint,
            int quantity,
            boolean notifyCustomer) {
        jdbc.queryForObject(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class,
                tenantId + ":shopify-variant-add-command:"
                        + idempotencyKey);
        jdbc.queryForObject(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class,
                tenantId + ":shopify-variant-add:" + orderId + ":"
                        + externalVariantRef);
        var rows = jdbc.query("""
                select shop_id, order_id, listing_id, sku_id,
                       external_order_ref, external_listing_ref,
                       external_variant_ref, request_fingerprint,
                       requested_quantity, notify_customer, status,
                       locked_until, response_order_line_id,
                       response_external_line_ref,
                       response_unit_price_minor, response_total_minor,
                       response_currency
                from tenant_shopify_order_variant_add_commands
                where tenant_id = ? and idempotency_key = ?
                for update
                """, (rs, row) -> new Existing(
                        rs.getObject("shop_id", UUID.class),
                        rs.getObject("order_id", UUID.class),
                        rs.getObject("listing_id", UUID.class),
                        rs.getObject("sku_id", UUID.class),
                        rs.getString("external_order_ref"),
                        rs.getString("external_listing_ref"),
                        rs.getString("external_variant_ref"),
                        rs.getString("request_fingerprint"),
                        rs.getInt("requested_quantity"),
                        rs.getBoolean("notify_customer"),
                        rs.getString("status"),
                        rs.getTimestamp("locked_until") == null
                                ? null
                                : rs.getTimestamp("locked_until")
                                        .toInstant(),
                        rs.getObject("response_order_line_id", UUID.class),
                        rs.getString("response_external_line_ref"),
                        (Long) rs.getObject("response_unit_price_minor"),
                        (Long) rs.getObject("response_total_minor"),
                        rs.getString("response_currency")),
                tenantId, idempotencyKey);
        Instant now = Instant.now();
        if (rows.isEmpty()) {
            Integer active = jdbc.queryForObject("""
                    select count(*)
                    from tenant_shopify_order_variant_add_commands
                    where tenant_id = ? and order_id = ?
                      and external_variant_ref = ?
                      and status in ('PENDING', 'UNCERTAIN')
                    """, Integer.class,
                    tenantId, orderId, externalVariantRef);
            if (active != null && active > 0) {
                throw new ConflictException(
                        "Another Shopify variant addition requires recovery");
            }
            jdbc.update("""
                    insert into tenant_shopify_order_variant_add_commands (
                        tenant_id, idempotency_key, shop_id, order_id,
                        listing_id, sku_id, external_order_ref,
                        external_listing_ref, external_variant_ref,
                        request_fingerprint, requested_quantity,
                        notify_customer, status, locked_until
                    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
                    """, tenantId, idempotencyKey, shopId, orderId,
                    listingId, skuId, externalOrderRef,
                    externalListingRef, externalVariantRef, fingerprint,
                    quantity, notifyCustomer,
                    Timestamp.from(now.plus(LEASE)));
            return new Reservation(
                    false, false, null, null, null, null, null);
        }
        Existing existing = rows.getFirst();
        if (!existing.matches(
                shopId, orderId, listingId, skuId, externalOrderRef,
                externalListingRef, externalVariantRef, fingerprint,
                quantity, notifyCustomer)) {
            throw new ConflictException(
                    "Idempotency key is already used for another Shopify order edit");
        }
        if ("SUCCEEDED".equals(existing.status())) {
            return new Reservation(
                    true, true, existing.responseOrderLineId(),
                    existing.responseExternalLineRef(),
                    existing.responseUnitPriceMinor(),
                    existing.responseTotalMinor(),
                    existing.responseCurrency());
        }
        if ("PENDING".equals(existing.status())
                && existing.lockedUntil() != null
                && existing.lockedUntil().isAfter(now)) {
            throw new ConflictException(
                    "Shopify order edit is already in progress");
        }
        jdbc.update("""
                update tenant_shopify_order_variant_add_commands
                set status = 'PENDING', attempt_count = attempt_count + 1,
                    locked_until = ?, safe_error_code = null,
                    updated_at = now()
                where tenant_id = ? and idempotency_key = ?
                """, Timestamp.from(now.plus(LEASE)), tenantId,
                idempotencyKey);
        return new Reservation(
                true, false, null, null, null, null, null);
    }

    public void markSucceeded(
            UUID tenantId,
            String idempotencyKey,
            String fingerprint,
            UUID orderLineId,
            String externalLineRef,
            long unitPriceMinor,
            long totalMinor,
            String currency) {
        int changed = jdbc.update("""
                update tenant_shopify_order_variant_add_commands
                set status = 'SUCCEEDED', response_order_line_id = ?,
                    response_external_line_ref = ?,
                    response_unit_price_minor = ?,
                    response_total_minor = ?, response_currency = ?,
                    locked_until = null, safe_error_code = null,
                    completed_at = now(), updated_at = now()
                where tenant_id = ? and idempotency_key = ?
                  and request_fingerprint = ? and status = 'PENDING'
                """, orderLineId, externalLineRef, unitPriceMinor,
                totalMinor, currency, tenantId, idempotencyKey,
                fingerprint);
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
                update tenant_shopify_order_variant_add_commands
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
            UUID orderLineId,
            String externalLineRef,
            Long unitPriceMinor,
            Long totalMinor,
            String currency) {
    }

    private record Existing(
            UUID shopId,
            UUID orderId,
            UUID listingId,
            UUID skuId,
            String externalOrderRef,
            String externalListingRef,
            String externalVariantRef,
            String fingerprint,
            int quantity,
            boolean notifyCustomer,
            String status,
            Instant lockedUntil,
            UUID responseOrderLineId,
            String responseExternalLineRef,
            Long responseUnitPriceMinor,
            Long responseTotalMinor,
            String responseCurrency) {

        boolean matches(
                UUID candidateShopId,
                UUID candidateOrderId,
                UUID candidateListingId,
                UUID candidateSkuId,
                String candidateOrderRef,
                String candidateListingRef,
                String candidateVariantRef,
                String candidateFingerprint,
                int candidateQuantity,
                boolean candidateNotifyCustomer) {
            return shopId.equals(candidateShopId)
                    && orderId.equals(candidateOrderId)
                    && listingId.equals(candidateListingId)
                    && skuId.equals(candidateSkuId)
                    && externalOrderRef.equals(candidateOrderRef)
                    && externalListingRef.equals(candidateListingRef)
                    && externalVariantRef.equals(candidateVariantRef)
                    && fingerprint.equals(candidateFingerprint)
                    && quantity == candidateQuantity
                    && notifyCustomer == candidateNotifyCustomer;
        }
    }
}
