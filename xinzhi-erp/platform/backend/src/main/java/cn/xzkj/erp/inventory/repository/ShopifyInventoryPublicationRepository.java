package cn.xzkj.erp.inventory.repository;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class ShopifyInventoryPublicationRepository {

    private static final Duration LEASE = Duration.ofMinutes(2);
    private final JdbcTemplate jdbc;

    public ShopifyInventoryPublicationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public Reservation enqueue(
            UUID tenantId,
            UUID shopId,
            UUID balanceId,
            long expectedBalanceVersion,
            int expectedShopifyAvailable,
            String idempotencyKey,
            String fingerprint,
            UUID actorUserId,
            UUID actorSystemAdminId,
            String requestId,
            String sourceIp) {
        advisory(tenantId + ":shopify-inventory-balance:" + balanceId);
        advisory(tenantId + ":shopify-inventory-key:" + idempotencyKey);
        List<Publication> byKey = findByKey(tenantId, idempotencyKey, true);
        if (!byKey.isEmpty()) {
            Publication existing = byKey.getFirst();
            if (!existing.requestFingerprint().equals(fingerprint)
                    || !existing.shopId().equals(shopId)
                    || !existing.balanceId().equals(balanceId)
                    || existing.expectedBalanceVersion() != expectedBalanceVersion
                    || existing.expectedShopifyAvailable() != expectedShopifyAvailable) {
                throw new IllegalStateException("idempotency_conflict");
            }
            return new Reservation(existing, false);
        }
        List<PublicationInput> inputs = jdbc.query("""
                select b.sku_id, b.warehouse_id, b.version,
                       b.on_hand - coalesce((
                           select sum(r.quantity - r.consumed_quantity - r.released_quantity)
                           from tenant_inventory_reservations r
                           where r.tenant_id = b.tenant_id
                             and r.sku_id = b.sku_id
                             and r.warehouse_id = b.warehouse_id
                       ), 0) as available,
                       listing.external_inventory_item_ref,
                       mapping.external_location_ref
                from inventory_balances b
                join tenant_product_listings listing
                  on listing.tenant_id = b.tenant_id
                 and listing.shop_id = ?
                 and listing.sku_id = b.sku_id
                 and listing.status = 'ACTIVE'
                 and listing.external_inventory_item_ref is not null
                join tenant_shopify_location_mappings mapping
                  on mapping.tenant_id = b.tenant_id
                 and mapping.shop_id = ?
                 and mapping.warehouse_id = b.warehouse_id
                 and mapping.external_active = true
                where b.tenant_id = ? and b.id = ?
                for update of b
                """, (rs, row) -> new PublicationInput(
                        rs.getObject("sku_id", UUID.class),
                        rs.getObject("warehouse_id", UUID.class),
                        rs.getLong("version"), rs.getLong("available"),
                        rs.getString("external_inventory_item_ref"),
                        rs.getString("external_location_ref")),
                shopId, shopId, tenantId, balanceId);
        if (inputs.size() != 1) {
            throw new IllegalStateException("inventory_mapping_not_unique");
        }
        PublicationInput input = inputs.getFirst();
        if (input.balanceVersion() != expectedBalanceVersion) {
            throw new IllegalStateException("inventory_balance_stale");
        }
        if (input.available() < -1_000_000_000L
                || input.available() > 1_000_000_000L) {
            throw new IllegalStateException("inventory_quantity_out_of_range");
        }
        if (!jdbc.queryForList("""
                select id from tenant_shopify_inventory_publications
                where tenant_id = ? and shop_id = ? and balance_id = ?
                  and status in ('QUEUED', 'PROCESSING', 'UNCERTAIN')
                for update
                """, UUID.class, tenantId, shopId, balanceId).isEmpty()) {
            throw new IllegalStateException("inventory_publication_in_progress");
        }
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into tenant_shopify_inventory_publications (
                    id, tenant_id, shop_id, balance_id, sku_id, warehouse_id,
                    external_inventory_item_ref, external_location_ref,
                    expected_balance_version, expected_shopify_available,
                    target_available, idempotency_key, request_fingerprint,
                    actor_user_id, actor_system_admin_id, request_id, source_ip)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, id, tenantId, shopId, balanceId, input.skuId(),
                input.warehouseId(), input.inventoryItemRef(),
                input.locationRef(), expectedBalanceVersion,
                expectedShopifyAvailable, Math.toIntExact(input.available()),
                idempotencyKey, fingerprint, actorUserId, actorSystemAdminId,
                requestId, sourceIp);
        return new Reservation(
                findByKey(tenantId, idempotencyKey, false).getFirst(), true);
    }

    @Transactional
    public Optional<Claim> claimNext() {
        List<Publication> candidates = jdbc.query("""
                select publication.*
                from tenant_shopify_inventory_publications publication
                where publication.available_at <= now()
                  and (publication.status in ('QUEUED', 'UNCERTAIN')
                       or (publication.status = 'PROCESSING'
                           and publication.locked_until < now()))
                  and exists (
                      select 1
                      from tenant_enabled_application_modules entitlement
                      where entitlement.tenant_id = publication.tenant_id
                        and entitlement.application_code = 'ERP'
                        and entitlement.module_code = 'WAREHOUSE'
                  )
                order by publication.available_at, publication.created_at,
                         publication.id
                for update skip locked
                limit 1
                """, (rs, row) -> map(rs));
        if (candidates.isEmpty()) {
            return Optional.empty();
        }
        Publication item = candidates.getFirst();
        List<CurrentState> states = jdbc.query("""
                select b.version,
                       b.on_hand - coalesce((
                           select sum(r.quantity - r.consumed_quantity - r.released_quantity)
                           from tenant_inventory_reservations r
                           where r.tenant_id = b.tenant_id
                             and r.sku_id = b.sku_id
                             and r.warehouse_id = b.warehouse_id
                       ), 0) as available,
                       exists (
                           select 1 from tenant_product_listings listing
                           where listing.tenant_id = b.tenant_id
                             and listing.shop_id = ? and listing.sku_id = b.sku_id
                             and listing.status = 'ACTIVE'
                             and listing.external_inventory_item_ref = ?
                       ) and exists (
                           select 1 from tenant_shopify_location_mappings mapping
                           where mapping.tenant_id = b.tenant_id
                             and mapping.shop_id = ?
                             and mapping.warehouse_id = b.warehouse_id
                             and mapping.external_location_ref = ?
                             and mapping.external_active = true
                       ) as mappings_current
                from inventory_balances b
                where b.tenant_id = ? and b.id = ?
                """, (rs, row) -> new CurrentState(
                        rs.getLong("version"), rs.getLong("available"),
                        rs.getBoolean("mappings_current")),
                item.shopId(), item.externalInventoryItemRef(), item.shopId(),
                item.externalLocationRef(), item.tenantId(), item.balanceId());
        CurrentState state = states.size() == 1
                ? states.getFirst() : new CurrentState(-1, 0, false);
        jdbc.update("""
                update tenant_shopify_inventory_publications
                set status = 'PROCESSING', attempt_count = attempt_count + 1,
                    locked_until = ?, safe_error_code = null, updated_at = now()
                where tenant_id = ? and id = ?
                """, Timestamp.from(Instant.now().plus(LEASE)),
                item.tenantId(), item.id());
        return Optional.of(new Claim(item, state.balanceVersion(),
                state.available(), state.mappingsCurrent()));
    }

    public void markTerminal(
            UUID tenantId, UUID id, String status,
            String safeErrorCode, Instant providerUpdatedAt) {
        int changed = jdbc.update("""
                update tenant_shopify_inventory_publications
                set status = ?, locked_until = null, safe_error_code = ?,
                    provider_updated_at = ?, completed_at = now(), updated_at = now()
                where tenant_id = ? and id = ? and status = 'PROCESSING'
                """, status, safeErrorCode,
                providerUpdatedAt == null ? null : Timestamp.from(providerUpdatedAt),
                tenantId, id);
        if (changed != 1) {
            throw new IllegalStateException("inventory_publication_state_conflict");
        }
    }

    public void markUncertain(UUID tenantId, UUID id) {
        jdbc.update("""
                update tenant_shopify_inventory_publications
                set status = 'UNCERTAIN', locked_until = null,
                    safe_error_code = 'SHOPIFY_INVENTORY_UNCERTAIN',
                    available_at = now() + interval '30 seconds', updated_at = now()
                where tenant_id = ? and id = ? and status = 'PROCESSING'
                """, tenantId, id);
    }

    public void requeueBusy(UUID tenantId, UUID id) {
        jdbc.update("""
                update tenant_shopify_inventory_publications
                set status = 'QUEUED', locked_until = null,
                    safe_error_code = 'SHOPIFY_IDEMPOTENCY_BUSY',
                    available_at = now() + interval '15 seconds', updated_at = now()
                where tenant_id = ? and id = ? and status = 'PROCESSING'
                """, tenantId, id);
    }

    public Optional<Publication> findById(UUID tenantId, UUID id) {
        List<Publication> rows = jdbc.query("""
                select * from tenant_shopify_inventory_publications
                where tenant_id = ? and id = ?
                """, (rs, row) -> map(rs), tenantId, id);
        return rows.stream().findFirst();
    }

    public Optional<Publication> findLatest(
            UUID tenantId, UUID shopId, UUID balanceId) {
        List<Publication> rows = jdbc.query("""
                select * from tenant_shopify_inventory_publications
                where tenant_id = ? and shop_id = ? and balance_id = ?
                order by created_at desc, id desc
                limit 1
                """, (rs, row) -> map(rs), tenantId, shopId, balanceId);
        return rows.stream().findFirst();
    }

    public List<ExceptionView> findExceptions(
            UUID tenantId,
            UUID shopId,
            Instant createdFrom,
            Instant createdBefore,
            String keyword,
            int limit) {
        StringBuilder sql = new StringBuilder("""
                select publication.id, publication.shop_id,
                       shop.display_name as shop_name,
                       shop.external_shop_ref,
                       publication.balance_id,
                       publication.sku_id,
                       sku.business_code as sku_code,
                       sku.name as sku_name,
                       publication.warehouse_id,
                       warehouse.business_code as warehouse_code,
                       warehouse.name as warehouse_name,
                       publication.expected_shopify_available,
                       publication.target_available,
                       publication.status,
                       publication.attempt_count,
                       publication.safe_error_code,
                       publication.created_at,
                       publication.updated_at,
                       publication.completed_at
                from tenant_shopify_inventory_publications publication
                join tenant_shops shop
                  on shop.tenant_id = publication.tenant_id
                 and shop.id = publication.shop_id
                join tenant_product_skus sku
                  on sku.tenant_id = publication.tenant_id
                 and sku.id = publication.sku_id
                join tenant_warehouses warehouse
                  on warehouse.tenant_id = publication.tenant_id
                 and warehouse.id = publication.warehouse_id
                where publication.tenant_id = ?
                  and publication.status in ('STALE', 'REJECTED', 'UNCERTAIN')
                """);
        List<Object> parameters = new ArrayList<>();
        parameters.add(tenantId);
        if (shopId != null) {
            sql.append(" and publication.shop_id = ?");
            parameters.add(shopId);
        }
        if (createdFrom != null) {
            sql.append(" and publication.created_at >= ?");
            parameters.add(Timestamp.from(createdFrom));
        }
        if (createdBefore != null) {
            sql.append(" and publication.created_at < ?");
            parameters.add(Timestamp.from(createdBefore));
        }
        if (keyword != null && !keyword.isBlank()) {
            sql.append("""
                     and lower(concat_ws(' ',
                         shop.display_name, shop.external_shop_ref,
                         sku.business_code, sku.name,
                         warehouse.business_code, warehouse.name,
                         publication.safe_error_code)) like ? escape '\\'
                    """);
            parameters.add("%" + escapeLike(keyword.toLowerCase()) + "%");
        }
        sql.append(" order by publication.updated_at desc, publication.id desc limit ?");
        parameters.add(limit);
        return jdbc.query(
                sql.toString(),
                (rs, row) -> new ExceptionView(
                        rs.getObject("id", UUID.class),
                        rs.getObject("shop_id", UUID.class),
                        rs.getString("shop_name"),
                        rs.getString("external_shop_ref"),
                        rs.getObject("balance_id", UUID.class),
                        rs.getObject("sku_id", UUID.class),
                        rs.getString("sku_code"),
                        rs.getString("sku_name"),
                        rs.getObject("warehouse_id", UUID.class),
                        rs.getString("warehouse_code"),
                        rs.getString("warehouse_name"),
                        rs.getInt("expected_shopify_available"),
                        rs.getInt("target_available"),
                        rs.getString("status"),
                        rs.getInt("attempt_count"),
                        rs.getString("safe_error_code"),
                        rs.getTimestamp("created_at").toInstant(),
                        rs.getTimestamp("updated_at").toInstant(),
                        rs.getTimestamp("completed_at") == null
                                ? null
                                : rs.getTimestamp("completed_at").toInstant()),
                parameters.toArray());
    }

    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
    }

    private List<Publication> findByKey(
            UUID tenantId, String key, boolean lock) {
        return jdbc.query("""
                select * from tenant_shopify_inventory_publications
                where tenant_id = ? and idempotency_key = ?
                """ + (lock ? " for update" : ""),
                (rs, row) -> map(rs), tenantId, key);
    }

    private void advisory(String value) {
        jdbc.queryForObject(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class, value);
    }

    private static Publication map(java.sql.ResultSet rs)
            throws java.sql.SQLException {
        return new Publication(
                rs.getObject("id", UUID.class),
                rs.getObject("tenant_id", UUID.class),
                rs.getObject("shop_id", UUID.class),
                rs.getObject("balance_id", UUID.class),
                rs.getObject("sku_id", UUID.class),
                rs.getObject("warehouse_id", UUID.class),
                rs.getString("external_inventory_item_ref"),
                rs.getString("external_location_ref"),
                rs.getLong("expected_balance_version"),
                rs.getInt("expected_shopify_available"),
                rs.getInt("target_available"),
                rs.getString("idempotency_key"),
                rs.getString("request_fingerprint"),
                rs.getString("status"),
                rs.getInt("attempt_count"),
                rs.getString("safe_error_code"),
                rs.getObject("actor_user_id", UUID.class),
                rs.getObject("actor_system_admin_id", UUID.class),
                rs.getString("request_id"), rs.getString("source_ip"));
    }

    private record PublicationInput(
            UUID skuId, UUID warehouseId, long balanceVersion,
            long available, String inventoryItemRef, String locationRef) {
    }

    private record CurrentState(
            long balanceVersion, long available, boolean mappingsCurrent) {
    }

    public record Publication(
            UUID id, UUID tenantId, UUID shopId, UUID balanceId,
            UUID skuId, UUID warehouseId,
            String externalInventoryItemRef, String externalLocationRef,
            long expectedBalanceVersion, int expectedShopifyAvailable,
            int targetAvailable, String idempotencyKey,
            String requestFingerprint, String status, int attemptCount,
            String safeErrorCode, UUID actorUserId,
            UUID actorSystemAdminId, String requestId, String sourceIp) {
    }

    public record Claim(
            Publication publication,
            long currentBalanceVersion,
            long currentAvailable,
            boolean mappingsCurrent) {
    }

    public record Reservation(Publication publication, boolean created) {
    }

    public record ExceptionView(
            UUID id,
            UUID shopId,
            String shopName,
            String externalShopRef,
            UUID balanceId,
            UUID skuId,
            String skuCode,
            String skuName,
            UUID warehouseId,
            String warehouseCode,
            String warehouseName,
            int expectedShopifyAvailable,
            int targetAvailable,
            String status,
            int attemptCount,
            String safeErrorCode,
            Instant createdAt,
            Instant updatedAt,
            Instant completedAt) {
    }
}
