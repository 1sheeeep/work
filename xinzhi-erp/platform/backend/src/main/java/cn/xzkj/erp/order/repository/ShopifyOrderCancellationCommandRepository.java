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
public class ShopifyOrderCancellationCommandRepository {
    private static final Duration LEASE = Duration.ofMinutes(2);
    private final JdbcTemplate jdbc;

    public ShopifyOrderCancellationCommandRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public Reservation reserve(
            UUID tenantId, UUID shopId, UUID orderId,
            String externalOrderRef, long expectedOrderVersion,
            long expectedProfileVersion, String reason,
            boolean refund, boolean restock, boolean notify,
            String idempotencyKey, String fingerprint) {
        jdbc.queryForObject(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class, tenantId + ":shopify-order-cancel:" + orderId);
        var rows = jdbc.query("""
                select request_fingerprint, status, locked_until,
                       response_cancelled_at, response_job_id
                from tenant_shopify_order_cancellation_commands
                where tenant_id = ? and idempotency_key = ? for update
                """, (rs, row) -> new Existing(
                        rs.getString("request_fingerprint"),
                        rs.getString("status"),
                        rs.getTimestamp("locked_until") == null ? null
                                : rs.getTimestamp("locked_until").toInstant(),
                        rs.getTimestamp("response_cancelled_at") == null ? null
                                : rs.getTimestamp("response_cancelled_at").toInstant(),
                        rs.getString("response_job_id")),
                tenantId, idempotencyKey);
        Instant now = Instant.now();
        if (rows.isEmpty()) {
            Integer active = jdbc.queryForObject("""
                    select count(*) from tenant_shopify_order_cancellation_commands
                    where tenant_id = ? and order_id = ?
                      and status in ('PENDING', 'UNCERTAIN')
                    """, Integer.class, tenantId, orderId);
            if (active != null && active > 0) {
                throw new ConflictException(
                        "Another Shopify cancellation requires recovery");
            }
            jdbc.update("""
                    insert into tenant_shopify_order_cancellation_commands (
                        tenant_id, idempotency_key, shop_id, order_id,
                        external_order_ref, expected_order_version,
                        expected_profile_version, cancellation_reason,
                        refund_original_payment_methods, restock,
                        notify_customer, request_fingerprint, status,
                        locked_until
                    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
                    """, tenantId, idempotencyKey, shopId, orderId,
                    externalOrderRef, expectedOrderVersion,
                    expectedProfileVersion, reason, refund, restock, notify,
                    fingerprint, Timestamp.from(now.plus(LEASE)));
            return new Reservation(false, false, null, null);
        }
        Existing existing = rows.getFirst();
        if (!existing.fingerprint().equals(fingerprint)) {
            throw new ConflictException(
                    "Idempotency key is already used for another Shopify cancellation");
        }
        if ("SUCCEEDED".equals(existing.status())) {
            return new Reservation(true, true,
                    existing.cancelledAt(), existing.jobId());
        }
        if ("PENDING".equals(existing.status())
                && existing.lockedUntil() != null
                && existing.lockedUntil().isAfter(now)) {
            throw new ConflictException("Shopify cancellation is in progress");
        }
        jdbc.update("""
                update tenant_shopify_order_cancellation_commands
                set status = 'PENDING', attempt_count = attempt_count + 1,
                    locked_until = ?, safe_error_code = null,
                    updated_at = now()
                where tenant_id = ? and idempotency_key = ?
                """, Timestamp.from(now.plus(LEASE)), tenantId, idempotencyKey);
        return new Reservation(true, false, null, null);
    }

    public void markSucceeded(
            UUID tenantId, String idempotencyKey, String fingerprint,
            Instant cancelledAt, String jobId) {
        int changed = jdbc.update("""
                update tenant_shopify_order_cancellation_commands
                set status = 'SUCCEEDED', response_cancelled_at = ?,
                    response_job_id = ?, locked_until = null,
                    safe_error_code = null, completed_at = now(), updated_at = now()
                where tenant_id = ? and idempotency_key = ?
                  and request_fingerprint = ? and status = 'PENDING'
                """, Timestamp.from(cancelledAt), jobId,
                tenantId, idempotencyKey, fingerprint);
        if (changed != 1) {
            throw new ConflictException("Shopify cancellation state changed concurrently");
        }
    }

    public void markUncertain(
            UUID tenantId, String idempotencyKey, String fingerprint) {
        jdbc.update("""
                update tenant_shopify_order_cancellation_commands
                set status = 'UNCERTAIN', locked_until = null,
                    safe_error_code = 'SHOPIFY_ORDER_CANCELLATION_UNCERTAIN',
                    updated_at = now()
                where tenant_id = ? and idempotency_key = ?
                  and request_fingerprint = ? and status = 'PENDING'
                """, tenantId, idempotencyKey, fingerprint);
    }

    public record Reservation(
            boolean existing, boolean replay,
            Instant cancelledAt, String jobId) { }

    private record Existing(
            String fingerprint, String status, Instant lockedUntil,
            Instant cancelledAt, String jobId) { }
}
