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
public class ShopifyOrderCommandRepository {

    public static final String ORDER_SHIPPING_ADDRESS_UPDATE =
            "ORDER_SHIPPING_ADDRESS_UPDATE";
    private static final Duration COMMAND_LEASE = Duration.ofMinutes(2);

    private final JdbcTemplate jdbc;

    public ShopifyOrderCommandRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public Reservation reserve(
            UUID tenantId,
            UUID orderId,
            UUID shopId,
            String commandType,
            String idempotencyKey,
            String fingerprint) {
        jdbc.queryForObject(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class,
                tenantId + ":shopify-order-command:" + idempotencyKey);
        var rows = jdbc.query("""
                select command_type, order_id, shop_id, request_fingerprint,
                       status, locked_until, response_version
                from tenant_shopify_order_commands
                where tenant_id = ? and idempotency_key = ?
                for update
                """, (rs, row) -> new ExistingCommand(
                        rs.getString("command_type"),
                        rs.getObject("order_id", UUID.class),
                        rs.getObject("shop_id", UUID.class),
                        rs.getString("request_fingerprint"),
                        rs.getString("status"),
                        rs.getTimestamp("locked_until") == null
                                ? null
                                : rs.getTimestamp("locked_until").toInstant(),
                        (Long) rs.getObject("response_version")),
                tenantId, idempotencyKey);
        Instant now = Instant.now();
        if (rows.isEmpty()) {
            jdbc.update("""
                    insert into tenant_shopify_order_commands (
                        tenant_id, idempotency_key, command_type, order_id,
                        shop_id, request_fingerprint, status, locked_until
                    ) values (?, ?, ?, ?, ?, ?, 'PENDING', ?)
                    """, tenantId, idempotencyKey, commandType, orderId,
                    shopId, fingerprint, Timestamp.from(now.plus(COMMAND_LEASE)));
            return new Reservation(false, false, null);
        }
        ExistingCommand existing = rows.getFirst();
        if (!existing.commandType().equals(commandType)
                || !existing.orderId().equals(orderId)
                || !existing.shopId().equals(shopId)
                || !existing.fingerprint().equals(fingerprint)) {
            throw new ConflictException(
                    "Idempotency key is already used for another Shopify order command");
        }
        if ("SUCCEEDED".equals(existing.status())) {
            return new Reservation(true, true, existing.responseVersion());
        }
        if ("PENDING".equals(existing.status())
                && existing.lockedUntil() != null
                && existing.lockedUntil().isAfter(now)) {
            throw new ConflictException(
                    "Shopify order command is already in progress");
        }
        jdbc.update("""
                update tenant_shopify_order_commands
                set status = 'PENDING', attempt_count = attempt_count + 1,
                    locked_until = ?, safe_error_code = null, updated_at = now()
                where tenant_id = ? and idempotency_key = ?
                """, Timestamp.from(now.plus(COMMAND_LEASE)), tenantId,
                idempotencyKey);
        return new Reservation(true, false, null);
    }

    public void markSucceeded(
            UUID tenantId,
            String idempotencyKey,
            String fingerprint,
            long responseVersion) {
        int changed = jdbc.update("""
                update tenant_shopify_order_commands
                set status = 'SUCCEEDED', response_version = ?,
                    locked_until = null, safe_error_code = null,
                    completed_at = now(), updated_at = now()
                where tenant_id = ? and idempotency_key = ?
                  and request_fingerprint = ? and status = 'PENDING'
                """, responseVersion, tenantId, idempotencyKey, fingerprint);
        if (changed != 1) {
            throw new ConflictException(
                    "Shopify order command state changed concurrently");
        }
    }

    @Transactional
    public void markFailed(
            UUID tenantId,
            String idempotencyKey,
            String fingerprint,
            String safeErrorCode) {
        jdbc.update("""
                update tenant_shopify_order_commands
                set status = 'FAILED', locked_until = null,
                    safe_error_code = ?, updated_at = now()
                where tenant_id = ? and idempotency_key = ?
                  and request_fingerprint = ? and status = 'PENDING'
                """, safeErrorCode, tenantId, idempotencyKey, fingerprint);
    }

    public record Reservation(
            boolean existing,
            boolean replay,
            Long responseVersion) {
    }

    private record ExistingCommand(
            String commandType,
            UUID orderId,
            UUID shopId,
            String fingerprint,
            String status,
            Instant lockedUntil,
            Long responseVersion) {
    }
}
