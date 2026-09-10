package cn.xzkj.erp.platform.repository;

import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.LocationCatalogLocation;
import cn.xzkj.erp.platform.service.ConflictException;

@Repository
public class ShopifyLocationMappingRepository {

    private final JdbcTemplate jdbc;

    public ShopifyLocationMappingRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<LocationMapping> findAll(UUID tenantId, UUID shopId) {
        return jdbc.query("""
                select mapping.id, mapping.external_location_ref,
                       mapping.external_name_snapshot, mapping.external_active,
                       mapping.fulfills_online_orders,
                       mapping.has_active_inventory,
                       mapping.fulfillment_service, mapping.warehouse_id,
                       warehouse.business_code, warehouse.name,
                       warehouse.status, mapping.version
                from tenant_shopify_location_mappings mapping
                join tenant_warehouses warehouse
                  on warehouse.tenant_id = mapping.tenant_id
                 and warehouse.id = mapping.warehouse_id
                where mapping.tenant_id = ? and mapping.shop_id = ?
                order by mapping.external_name_snapshot asc, mapping.id asc
                """, (rs, row) -> new LocationMapping(
                        rs.getObject("id", UUID.class),
                        rs.getString("external_location_ref"),
                        rs.getString("external_name_snapshot"),
                        rs.getBoolean("external_active"),
                        rs.getBoolean("fulfills_online_orders"),
                        rs.getBoolean("has_active_inventory"),
                        rs.getBoolean("fulfillment_service"),
                        rs.getObject("warehouse_id", UUID.class),
                        rs.getString("business_code"),
                        rs.getString("name"),
                        rs.getString("status"),
                        rs.getLong("version")), tenantId, shopId);
    }

    public LocationMapping upsert(
            UUID tenantId,
            UUID shopId,
            UUID warehouseId,
            LocationCatalogLocation location) {
        jdbc.queryForObject(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class,
                tenantId + ":shopify-location-mapping:" + shopId);
        List<LocationMapping> existing = findAll(tenantId, shopId);
        existing.stream()
                .filter(item -> item.warehouseId().equals(warehouseId)
                        && !item.externalLocationRef().equals(
                                location.externalLocationRef()))
                .findFirst()
                .ifPresent(item -> {
                    throw new ConflictException(
                            "ERP warehouse is already mapped to another Shopify location");
                });
        UUID mappingId = existing.stream()
                .filter(item -> item.externalLocationRef().equals(
                        location.externalLocationRef()))
                .map(LocationMapping::id)
                .findFirst()
                .orElseGet(UUID::randomUUID);
        jdbc.update("""
                insert into tenant_shopify_location_mappings (
                    id, tenant_id, shop_id, warehouse_id,
                    external_location_ref, external_name_snapshot,
                    external_active, fulfills_online_orders,
                    has_active_inventory, fulfillment_service)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                on conflict (tenant_id, shop_id, external_location_ref)
                do update set
                    warehouse_id = excluded.warehouse_id,
                    external_name_snapshot = excluded.external_name_snapshot,
                    external_active = excluded.external_active,
                    fulfills_online_orders = excluded.fulfills_online_orders,
                    has_active_inventory = excluded.has_active_inventory,
                    fulfillment_service = excluded.fulfillment_service,
                    updated_at = now(),
                    version = tenant_shopify_location_mappings.version + 1
                """,
                mappingId, tenantId, shopId, warehouseId,
                location.externalLocationRef(), location.name(),
                location.active(), location.fulfillsOnlineOrders(),
                location.hasActiveInventory(), location.fulfillmentService());
        return findAll(tenantId, shopId).stream()
                .filter(item -> item.externalLocationRef().equals(
                        location.externalLocationRef()))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException(
                        "Shopify location mapping was not persisted"));
    }

    public LocationMapping delete(
            UUID tenantId,
            UUID shopId,
            UUID mappingId) {
        jdbc.queryForObject(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class,
                tenantId + ":shopify-location-mapping:" + shopId);
        LocationMapping existing = findAll(tenantId, shopId).stream()
                .filter(item -> item.id().equals(mappingId))
                .findFirst()
                .orElse(null);
        if (existing == null) {
            return null;
        }
        int changed = jdbc.update("""
                delete from tenant_shopify_location_mappings
                where id = ? and tenant_id = ? and shop_id = ?
                """, mappingId, tenantId, shopId);
        if (changed != 1) {
            throw new ConflictException(
                    "Shopify location mapping changed concurrently");
        }
        return existing;
    }

    public record LocationMapping(
            UUID id,
            String externalLocationRef,
            String externalName,
            boolean externalActive,
            boolean fulfillsOnlineOrders,
            boolean hasActiveInventory,
            boolean fulfillmentService,
            UUID warehouseId,
            String warehouseCode,
            String warehouseName,
            String warehouseStatus,
            long version) {
    }
}
