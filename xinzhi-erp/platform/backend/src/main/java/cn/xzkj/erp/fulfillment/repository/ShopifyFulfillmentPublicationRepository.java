package cn.xzkj.erp.fulfillment.repository;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class ShopifyFulfillmentPublicationRepository {

    private static final Duration LEASE = Duration.ofMinutes(2);

    private final JdbcTemplate jdbc;

    public ShopifyFulfillmentPublicationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<PublicationInput> findInput(
            UUID tenantId,
            UUID planId,
            UUID packageId) {
        var headers = jdbc.query("""
                select plan.order_id, plan.shop_id,
                       plan.external_order_ref_snapshot,
                       package.package_number,
                       event.carrier_code, event.service_code,
                       event.tracking_reference, event.occurred_at
                from tenant_fulfillment_plans plan
                join tenant_fulfillment_packages package
                  on package.tenant_id = plan.tenant_id
                 and package.plan_id = plan.id
                 and package.id = ?
                join tenant_shipment_events event
                  on event.tenant_id = package.tenant_id
                 and event.plan_id = package.plan_id
                 and event.package_id = package.id
                 and event.event_type = 'HANDOVER_CONFIRMED'
                where plan.tenant_id = ? and plan.id = ?
                  and package.status = 'HANDED_OVER'
                  and not exists (
                    select 1 from tenant_shipment_events correction
                    where correction.tenant_id = event.tenant_id
                      and correction.reverses_event_id = event.id
                  )
                """, (rs, row) -> new PublicationHeader(
                        rs.getObject("order_id", UUID.class),
                        rs.getObject("shop_id", UUID.class),
                        rs.getString("external_order_ref_snapshot"),
                        rs.getString("package_number"),
                        rs.getString("carrier_code"),
                        rs.getString("service_code"),
                        rs.getString("tracking_reference"),
                        rs.getTimestamp("occurred_at").toInstant()),
                packageId, tenantId, planId);
        if (headers.size() != 1) {
            return Optional.empty();
        }
        List<PublicationLine> lines = jdbc.query("""
                select line.external_line_ref_snapshot,
                       sum(item.quantity)::integer as quantity
                from tenant_fulfillment_package_items item
                join tenant_fulfillment_lines line
                  on line.tenant_id = item.tenant_id
                 and line.id = item.fulfillment_line_id
                where item.tenant_id = ? and item.package_id = ?
                group by line.external_line_ref_snapshot
                order by line.external_line_ref_snapshot
                """, (rs, row) -> new PublicationLine(
                        rs.getString("external_line_ref_snapshot"),
                        rs.getInt("quantity")), tenantId, packageId);
        PublicationHeader header = headers.getFirst();
        return Optional.of(new PublicationInput(
                planId, packageId, header.orderId(), header.shopId(),
                header.externalOrderRef(), header.packageNumber(),
                header.carrierCode(), header.serviceCode(),
                header.trackingReference(), header.occurredAt(), lines));
    }

    @Transactional
    public Reservation reserve(
            UUID tenantId,
            UUID planId,
            UUID packageId,
            String idempotencyKey,
            String fingerprint,
            boolean notifyCustomer,
            String trackingUrl) {
        jdbc.queryForObject(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class,
                tenantId + ":shopify-fulfillment-package:" + packageId);
        jdbc.queryForObject(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class,
                tenantId + ":shopify-fulfillment-key:" + idempotencyKey);
        var packageStates = jdbc.query("""
                select package.status
                from tenant_fulfillment_plans plan
                join tenant_fulfillment_packages package
                  on package.tenant_id = plan.tenant_id
                 and package.plan_id = plan.id
                 and package.id = ?
                where plan.tenant_id = ? and plan.id = ?
                for update of plan, package
                """, (rs, row) -> rs.getString(1), packageId, tenantId, planId);
        if (packageStates.size() != 1
                || !"HANDED_OVER".equals(packageStates.getFirst())) {
            throw new IllegalStateException("package_not_publishable");
        }
        var keyOwner = jdbc.query("""
                select package_id
                from tenant_shopify_fulfillment_publications
                where tenant_id = ? and idempotency_key = ?
                for update
                """, (rs, row) -> rs.getObject(1, UUID.class),
                tenantId, idempotencyKey);
        if (!keyOwner.isEmpty() && !packageId.equals(keyOwner.getFirst())) {
            throw new IllegalStateException("idempotency_conflict");
        }
        var existing = jdbc.query("""
                select id, request_fingerprint, notify_customer, tracking_url, status,
                       locked_until, external_fulfillment_ref,
                       recovered_from_shopify, published_at
                from tenant_shopify_fulfillment_publications
                where tenant_id = ? and package_id = ?
                for update
                """, (rs, row) -> new ExistingPublication(
                        rs.getObject("id", UUID.class),
                        rs.getString("request_fingerprint"),
                        rs.getBoolean("notify_customer"),
                        rs.getString("tracking_url"),
                        rs.getString("status"),
                        rs.getTimestamp("locked_until") == null
                                ? null
                                : rs.getTimestamp("locked_until").toInstant(),
                        rs.getString("external_fulfillment_ref"),
                        (Boolean) rs.getObject("recovered_from_shopify"),
                        rs.getTimestamp("published_at") == null
                                ? null
                                : rs.getTimestamp("published_at").toInstant()),
                tenantId, packageId);
        Instant now = Instant.now();
        if (existing.isEmpty()) {
            UUID id = UUID.randomUUID();
            jdbc.update("""
                    insert into tenant_shopify_fulfillment_publications (
                        id, tenant_id, plan_id, package_id, idempotency_key,
                        request_fingerprint, notify_customer, tracking_url, status,
                        locked_until
                    ) values (?, ?, ?, ?, ?, ?, ?, ?, 'PUBLISHING', ?)
                    """, id, tenantId, planId, packageId, idempotencyKey,
                    fingerprint, notifyCustomer, trackingUrl,
                    Timestamp.from(now.plus(LEASE)));
            return new Reservation(id, false, false, null, null, null);
        }
        ExistingPublication publication = existing.getFirst();
        if (!publication.fingerprint().equals(fingerprint)
                || publication.notifyCustomer() != notifyCustomer
                || !java.util.Objects.equals(
                        publication.trackingUrl(), trackingUrl)) {
            throw new IllegalStateException("publication_conflict");
        }
        if ("PUBLISHED".equals(publication.status())) {
            return new Reservation(
                    publication.id(), true, true,
                    publication.externalFulfillmentRef(),
                    publication.recoveredFromShopify(),
                    publication.publishedAt());
        }
        if ("PUBLISHING".equals(publication.status())
                && publication.lockedUntil() != null
                && publication.lockedUntil().isAfter(now)) {
            throw new IllegalStateException("publication_in_progress");
        }
        jdbc.update("""
                update tenant_shopify_fulfillment_publications
                set status = 'PUBLISHING', attempt_count = attempt_count + 1,
                    locked_until = ?, safe_error_code = null,
                    updated_at = now()
                where id = ? and tenant_id = ?
                """, Timestamp.from(now.plus(LEASE)), publication.id(), tenantId);
        return new Reservation(
                publication.id(), true, false, null, null, null);
    }

    public void markPublished(
            UUID tenantId,
            UUID publicationId,
            String fingerprint,
            String externalFulfillmentRef,
            boolean recoveredFromShopify) {
        int changed = jdbc.update("""
                update tenant_shopify_fulfillment_publications
                set status = 'PUBLISHED', locked_until = null,
                    external_fulfillment_ref = ?,
                    recovered_from_shopify = ?, safe_error_code = null,
                    published_at = now(), updated_at = now()
                where tenant_id = ? and id = ?
                  and request_fingerprint = ? and status = 'PUBLISHING'
                """, externalFulfillmentRef, recoveredFromShopify,
                tenantId, publicationId, fingerprint);
        if (changed != 1) {
            throw new IllegalStateException("publication_state_conflict");
        }
    }

    public void markUncertain(
            UUID tenantId,
            UUID publicationId,
            String fingerprint,
            String safeErrorCode) {
        jdbc.update("""
                update tenant_shopify_fulfillment_publications
                set status = 'UNCERTAIN', locked_until = null,
                    safe_error_code = ?, updated_at = now()
                where tenant_id = ? and id = ?
                  and request_fingerprint = ? and status = 'PUBLISHING'
                """, safeErrorCode, tenantId, publicationId, fingerprint);
    }

    public void discardFailedReservation(
            UUID tenantId,
            UUID publicationId,
            String fingerprint) {
        int changed = jdbc.update("""
                delete from tenant_shopify_fulfillment_publications
                where tenant_id = ? and id = ?
                  and request_fingerprint = ? and status = 'PUBLISHING'
                """, tenantId, publicationId, fingerprint);
        if (changed != 1) {
            throw new IllegalStateException("publication_state_conflict");
        }
    }

    public record PublicationInput(
            UUID planId,
            UUID packageId,
            UUID orderId,
            UUID shopId,
            String externalOrderRef,
            String packageNumber,
            String carrierCode,
            String serviceCode,
            String trackingReference,
            Instant occurredAt,
            List<PublicationLine> lines) {
        public PublicationInput {
            lines = List.copyOf(lines);
        }
    }

    public record PublicationLine(
            String externalOrderLineRef,
            int quantity) {
    }

    public record Reservation(
            UUID publicationId,
            boolean existing,
            boolean replay,
            String externalFulfillmentRef,
            Boolean recoveredFromShopify,
            Instant publishedAt) {
    }

    private record PublicationHeader(
            UUID orderId,
            UUID shopId,
            String externalOrderRef,
            String packageNumber,
            String carrierCode,
            String serviceCode,
            String trackingReference,
            Instant occurredAt) {
    }

    private record ExistingPublication(
            UUID id,
            String fingerprint,
            boolean notifyCustomer,
            String trackingUrl,
            String status,
            Instant lockedUntil,
            String externalFulfillmentRef,
            Boolean recoveredFromShopify,
            Instant publishedAt) {
    }
}
