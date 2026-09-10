package cn.xzkj.erp.logistics.shipment;

import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.Item;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderOperations.TrackingEvent;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class LogisticsShipmentRepository {
    private final JdbcTemplate jdbc;

    LogisticsShipmentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    ShipmentSnapshot snapshot(UUID tenantId, UUID planId, UUID packageId) {
        List<ShipmentSnapshot> rows = jdbc.query("""
                select package.id as package_id, package.plan_id,
                       package.status as package_status,
                       package.weighing_status, package.weight_grams,
                       package.version as package_version,
                       package.logistics_authorization_id,
                       package.logistics_channel_id,
                       package.logistics_provider_code,
                       package.logistics_client_reference,
                       package.logistics_provider_order_reference,
                       package.logistics_tracking_reference,
                       package.logistics_label_url,
                       package.logistics_booking_status,
                       package.logistics_tracking_status,
                       package.logistics_tracking_summary,
                       package.logistics_booking_key,
                       package.logistics_last_synced_at,
                       package.logistics_safe_error_code,
                       package.logistics_provider_handover_pending,
                       plan.order_id, plan.external_order_ref_snapshot,
                       orders.currency, orders.country_code, orders.province,
                       orders.postal_code,
                       profile.recipient_name, profile.recipient_phone,
                       profile.recipient_email, profile.recipient_company,
                       profile.address_line1, profile.address_line2, profile.city
                  from tenant_fulfillment_packages package
                  join tenant_fulfillment_plans plan
                    on plan.tenant_id = package.tenant_id
                   and plan.id = package.plan_id
                  join tenant_orders orders
                    on orders.tenant_id = plan.tenant_id
                   and orders.id = plan.order_id
                  left join tenant_order_profiles profile
                    on profile.tenant_id = orders.tenant_id
                   and profile.order_id = orders.id
                 where package.tenant_id = ?
                   and package.plan_id = ? and package.id = ?
                """, (rs, row) -> mapSnapshot(rs, tenantId),
                tenantId, planId, packageId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    ChannelSelection channel(UUID tenantId, UUID authorizationId,
            UUID channelId) {
        return jdbc.query("""
                select authorization_profile.provider_code,
                       channel.channel_code, channel.channel_name
                  from tenant_logistics_authorizations authorization_profile
                  join tenant_logistics_authorization_channels channel
                    on channel.tenant_id = authorization_profile.tenant_id
                   and channel.authorization_id = authorization_profile.id
                 where authorization_profile.tenant_id = ?
                   and authorization_profile.id = ? and channel.id = ?
                   and authorization_profile.lifecycle_status = 'ACTIVE'
                   and channel.enabled = true
                   and channel.provider_available = true
                """, (rs, row) -> new ChannelSelection(
                        rs.getString("provider_code"),
                        rs.getString("channel_code"),
                        rs.getString("channel_name")), tenantId,
                authorizationId, channelId).stream().findFirst().orElse(null);
    }

    private ShipmentSnapshot mapSnapshot(ResultSet rs, UUID tenantId)
            throws SQLException {
        UUID packageId = rs.getObject("package_id", UUID.class);
        return new ShipmentSnapshot(
                tenantId, rs.getObject("plan_id", UUID.class), packageId,
                rs.getObject("order_id", UUID.class),
                rs.getString("external_order_ref_snapshot"),
                rs.getString("package_status"),
                rs.getString("weighing_status"),
                rs.getLong("weight_grams"), rs.getLong("package_version"),
                rs.getObject("logistics_authorization_id", UUID.class),
                rs.getObject("logistics_channel_id", UUID.class),
                rs.getString("logistics_provider_code"),
                rs.getString("logistics_client_reference"),
                rs.getString("logistics_provider_order_reference"),
                rs.getString("logistics_tracking_reference"),
                rs.getString("logistics_label_url"),
                rs.getString("logistics_booking_status"),
                rs.getString("logistics_tracking_status"),
                rs.getString("logistics_tracking_summary"),
                rs.getString("logistics_booking_key"),
                instant(rs, "logistics_last_synced_at"),
                rs.getString("logistics_safe_error_code"),
                rs.getBoolean("logistics_provider_handover_pending"),
                rs.getString("recipient_name"),
                rs.getString("recipient_company"),
                rs.getString("recipient_phone"),
                rs.getString("recipient_email"),
                rs.getString("address_line1"),
                rs.getString("address_line2"),
                rs.getString("city"), rs.getString("province"),
                rs.getString("postal_code"), rs.getString("country_code"),
                rs.getString("currency"), items(tenantId, packageId));
    }

    private List<Item> items(UUID tenantId, UUID packageId) {
        return jdbc.query("""
                select fulfillment.sku_business_code_snapshot as sku,
                       fulfillment.sku_name_snapshot as name,
                       package_item.quantity,
                       order_line.unit_price_minor,
                       order_line.currency
                  from tenant_fulfillment_package_items package_item
                  join tenant_fulfillment_lines fulfillment
                    on fulfillment.tenant_id = package_item.tenant_id
                   and fulfillment.id = package_item.fulfillment_line_id
                  join tenant_order_lines order_line
                    on order_line.tenant_id = fulfillment.tenant_id
                   and order_line.id = fulfillment.order_line_id
                 where package_item.tenant_id = ?
                   and package_item.package_id = ?
                 order by fulfillment.order_line_id,
                          fulfillment.split_sequence, fulfillment.id
                """, (rs, row) -> new Item(
                        rs.getString("sku"), rs.getString("name"),
                        rs.getInt("quantity"),
                        rs.getLong("unit_price_minor"),
                        rs.getString("currency")), tenantId, packageId);
    }

    boolean claimBooking(UUID tenantId, UUID planId, UUID packageId,
            long packageVersion, UUID authorizationId, UUID channelId,
            String providerCode, String clientReference, String bookingKey) {
        return jdbc.update("""
                update tenant_fulfillment_packages
                   set logistics_authorization_id = ?,
                       logistics_channel_id = ?,
                       logistics_provider_code = ?,
                       logistics_client_reference = ?,
                       logistics_booking_key = ?,
                       logistics_booking_status = 'BOOKING',
                       logistics_safe_error_code = null,
                       version = version + 1,
                       updated_at = now()
                 where tenant_id = ? and plan_id = ? and id = ?
                   and version = ? and status = 'SEALED'
                   and weighing_status in ('PASSED', 'OVERRIDDEN')
                   and weight_grams is not null
                   and logistics_booking_status in ('NOT_REQUESTED', 'FAILED')
                """, authorizationId, channelId, providerCode,
                clientReference, bookingKey, tenantId, planId, packageId,
                packageVersion) == 1;
    }

    void completeBooking(UUID tenantId, UUID packageId,
            String bookingKey, String providerOrderReference,
            String trackingReference, String labelUrl,
            String trackingStatus, String providerStatus) {
        int changed = jdbc.update("""
                update tenant_fulfillment_packages
                   set logistics_booking_status = 'BOOKED',
                       logistics_provider_order_reference = ?,
                       logistics_tracking_reference = ?,
                       logistics_label_url = ?,
                       logistics_tracking_status = ?,
                       logistics_tracking_summary = ?,
                       logistics_next_sync_at = now(),
                       logistics_safe_error_code = null,
                       version = version + 1,
                       updated_at = now()
                 where tenant_id = ? and id = ?
                   and logistics_booking_key = ?
                   and logistics_booking_status = 'BOOKING'
                """, providerOrderReference, trackingReference, labelUrl,
                trackingStatus, safe(providerStatus), tenantId, packageId,
                bookingKey);
        if (changed != 1) throw new IllegalStateException(
                "logistics booking state conflict");
    }

    void failBooking(UUID tenantId, UUID packageId, String bookingKey,
            boolean definitive, String safeErrorCode) {
        jdbc.update("""
                update tenant_fulfillment_packages
                   set logistics_booking_status = ?,
                       logistics_safe_error_code = ?,
                       logistics_next_sync_at = case when ? then null else now() end,
                       version = version + 1,
                       updated_at = now()
                 where tenant_id = ? and id = ?
                   and logistics_booking_key = ?
                   and logistics_booking_status = 'BOOKING'
                """, definitive ? "FAILED" : "UNCERTAIN", safeErrorCode,
                definitive, tenantId, packageId, bookingKey);
    }

    List<ShipmentSnapshot> due(int limit) {
        List<ShipmentIdentity> identities = jdbc.query("""
                select tenant_id, plan_id, id
                  from tenant_fulfillment_packages
                 where logistics_booking_status in ('BOOKED', 'UNCERTAIN')
                   and logistics_tracking_status is distinct from 'DELIVERED'
                   and logistics_next_sync_at is not null
                   and logistics_next_sync_at <= now()
                   and exists (
                       select 1
                         from tenant_enabled_application_modules entitlement
                        where entitlement.tenant_id = tenant_fulfillment_packages.tenant_id
                          and entitlement.application_code = 'ERP'
                          and entitlement.module_code = 'LOGISTICS'
                   )
                 order by logistics_next_sync_at, tenant_id, id
                 limit ?
                """, (rs, row) -> new ShipmentIdentity(
                        rs.getObject("tenant_id", UUID.class),
                        rs.getObject("plan_id", UUID.class),
                        rs.getObject("id", UUID.class)), limit);
        return identities.stream()
                .map(identity -> snapshot(identity.tenantId(),
                        identity.planId(), identity.packageId()))
                .filter(Objects::nonNull)
                .toList();
    }

    void recoverStaleBookings() {
        jdbc.update("""
                update tenant_fulfillment_packages
                   set logistics_booking_status = 'UNCERTAIN',
                       logistics_safe_error_code = 'LOGISTICS_BOOKING_INTERRUPTED',
                       logistics_next_sync_at = now(),
                       version = version + 1,
                       updated_at = now()
                 where logistics_booking_status = 'BOOKING'
                   and updated_at <= now() - interval '10 minutes'
                   and exists (
                       select 1
                         from tenant_enabled_application_modules entitlement
                        where entitlement.tenant_id = tenant_fulfillment_packages.tenant_id
                          and entitlement.application_code = 'ERP'
                          and entitlement.module_code = 'LOGISTICS'
                   )
                """);
    }

    List<ShipmentSnapshot> pendingHandover(int limit) {
        List<ShipmentIdentity> identities = jdbc.query("""
                select tenant_id, plan_id, id
                  from tenant_fulfillment_packages
                 where logistics_provider_handover_pending = true
                   and exists (
                       select 1
                         from tenant_enabled_application_modules entitlement
                        where entitlement.tenant_id = tenant_fulfillment_packages.tenant_id
                          and entitlement.application_code = 'ERP'
                          and entitlement.module_code = 'LOGISTICS'
                   )
                 order by updated_at, tenant_id, id
                 limit ?
                """, (rs, row) -> new ShipmentIdentity(
                        rs.getObject("tenant_id", UUID.class),
                        rs.getObject("plan_id", UUID.class),
                        rs.getObject("id", UUID.class)), limit);
        return identities.stream()
                .map(identity -> snapshot(identity.tenantId(),
                        identity.planId(), identity.packageId()))
                .filter(Objects::nonNull)
                .toList();
    }

    void recordTracking(UUID tenantId, ShipmentSnapshot shipment,
            String trackingReference, String labelUrl,
            String normalizedStatus, String providerStatus,
            String summary, List<TrackingEvent> events) {
        for (TrackingEvent event : events) {
            jdbc.update("""
                    insert into tenant_logistics_tracking_events (
                        id, tenant_id, package_id, provider_event_key,
                        normalized_status, provider_status, description,
                        location, occurred_at
                    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    on conflict (tenant_id, package_id, provider_event_key)
                    do nothing
                    """, UUID.randomUUID(), tenantId, shipment.packageId(),
                    event.providerEventKey(), event.normalizedStatus(),
                    safe120(event.providerStatus()), safe(event.description()),
                    safe240(event.location()), Timestamp.from(event.occurredAt()));
        }
        jdbc.update("""
                update tenant_fulfillment_packages
                   set logistics_tracking_reference = coalesce(?, logistics_tracking_reference),
                       logistics_label_url = coalesce(?, logistics_label_url),
                       logistics_booking_status = case
                           when logistics_booking_status = 'UNCERTAIN'
                               and coalesce(?, logistics_tracking_reference) is not null
                           then 'BOOKED'
                           else logistics_booking_status
                       end,
                       logistics_tracking_status = ?,
                       logistics_tracking_summary = ?,
                       logistics_last_synced_at = now(),
                       logistics_next_sync_at = case when ? = 'DELIVERED'
                           then null else now() + interval '30 minutes' end,
                       logistics_sync_attempt_count = 0,
                       logistics_safe_error_code = null,
                       version = version + 1,
                       updated_at = now()
                 where tenant_id = ? and id = ?
                """, trackingReference, labelUrl, trackingReference,
                normalizedStatus,
                safe(summary == null ? providerStatus : summary),
                normalizedStatus, tenantId, shipment.packageId());
        jdbc.update("""
                update tenant_orders
                   set tracking_status = ?,
                       status = case when ? = 'DELIVERED'
                           and status = 'SHIPPED' then 'DELIVERED' else status end,
                       updated_at = now()
                 where tenant_id = ? and id = ?
                """, normalizedStatus, normalizedStatus,
                tenantId, shipment.orderId());
        jdbc.update("""
                update tenant_order_profiles
                   set tracking_reference = coalesce(?, tracking_reference),
                       delivered_at = case when ? = 'DELIVERED'
                           then coalesce(delivered_at, now()) else delivered_at end,
                       version = version + 1,
                       updated_at = now()
                 where tenant_id = ? and order_id = ?
                """, trackingReference, normalizedStatus,
                tenantId, shipment.orderId());
    }

    void recordSyncFailure(UUID tenantId, UUID packageId, String safeCode) {
        jdbc.update("""
                update tenant_fulfillment_packages
                   set logistics_sync_attempt_count = logistics_sync_attempt_count + 1,
                       logistics_safe_error_code = ?,
                       logistics_next_sync_at = now()
                           + make_interval(mins => least(
                               360, 5 * (logistics_sync_attempt_count + 1))),
                       updated_at = now()
                 where tenant_id = ? and id = ?
                """, safeCode, tenantId, packageId);
    }

    void setProviderHandoverPending(UUID tenantId, UUID packageId,
            boolean pending, String safeErrorCode) {
        jdbc.update("""
                update tenant_fulfillment_packages
                   set logistics_provider_handover_pending = ?,
                       logistics_safe_error_code = ?,
                       updated_at = now()
                 where tenant_id = ? and id = ?
                """, pending, safeErrorCode, tenantId, packageId);
    }

    private static Instant instant(ResultSet rs, String column)
            throws SQLException {
        OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    private static String safe(String value) {
        if (value == null) return null;
        String normalized = value.strip();
        return normalized.substring(0, Math.min(500, normalized.length()));
    }

    private static String safe120(String value) {
        String safe = safe(value);
        return safe == null ? null : safe.substring(0, Math.min(120, safe.length()));
    }

    private static String safe240(String value) {
        String safe = safe(value);
        return safe == null ? null : safe.substring(0, Math.min(240, safe.length()));
    }

    record ShipmentSnapshot(
            UUID tenantId,
            UUID planId,
            UUID packageId,
            UUID orderId,
            String externalOrderReference,
            String packageStatus,
            String weighingStatus,
            long weightGrams,
            long packageVersion,
            UUID authorizationId,
            UUID channelId,
            String providerCode,
            String clientReference,
            String providerOrderReference,
            String trackingReference,
            String labelUrl,
            String bookingStatus,
            String trackingStatus,
            String trackingSummary,
            String bookingKey,
            Instant lastSyncedAt,
            String safeErrorCode,
            boolean providerHandoverPending,
            String recipientName,
            String recipientCompany,
            String recipientPhone,
            String recipientEmail,
            String addressLine1,
            String addressLine2,
            String city,
            String province,
            String postalCode,
            String countryCode,
            String currency,
            List<Item> items) {
        int quantity() {
            return items.stream().mapToInt(Item::quantity).sum();
        }
    }

    record ChannelSelection(
            String providerCode, String channelCode, String channelName) {
    }

    private record ShipmentIdentity(
            UUID tenantId, UUID planId, UUID packageId) {
    }
}
