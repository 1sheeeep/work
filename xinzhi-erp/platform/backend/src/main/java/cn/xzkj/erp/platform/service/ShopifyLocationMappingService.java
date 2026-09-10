package cn.xzkj.erp.platform.service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;

import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.LocationCatalogLocation;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.repository.ShopifyLocationMappingRepository;
import cn.xzkj.erp.platform.repository.ShopifyLocationMappingRepository.LocationMapping;
import cn.xzkj.erp.platform.repository.TenantShopRepository;
import cn.xzkj.erp.warehouse.domain.WarehouseStatus;
import cn.xzkj.erp.warehouse.repository.WarehouseRepository;

@Service
public class ShopifyLocationMappingService {

    private static final Pattern LOCATION_REF = Pattern.compile(
            "^gid://shopify/Location/[0-9]+$");
    private static final int PAGE_SIZE = 100;
    private static final int MAX_PAGES = 10;
    private final TenantShopRepository shopRepository;
    private final WarehouseRepository warehouseRepository;
    private final ShopifyLocationMappingRepository mappingRepository;
    private final ChannelConnectorGateway connector;
    private final ShopifyLocationMappingWriter writer;

    public ShopifyLocationMappingService(
            TenantShopRepository shopRepository,
            WarehouseRepository warehouseRepository,
            ShopifyLocationMappingRepository mappingRepository,
            ChannelConnectorGateway connector,
            ShopifyLocationMappingWriter writer) {
        this.shopRepository = shopRepository;
        this.warehouseRepository = warehouseRepository;
        this.mappingRepository = mappingRepository;
        this.connector = connector;
        this.writer = writer;
    }

    public LocationMappingCatalog list(ShopCenterActor actor, UUID shopId) {
        requireActiveShop(actor, shopId);
        List<LocationCatalogLocation> providerLocations = fetchAllLocations(
                actor.tenantId(), shopId);
        List<LocationMapping> mappings = mappingRepository.findAll(
                actor.tenantId(), shopId);
        Map<String, LocationMapping> mappingsByRef = new LinkedHashMap<>();
        mappings.forEach(mapping -> mappingsByRef.put(
                mapping.externalLocationRef(), mapping));
        List<LocationMappingItem> items = new ArrayList<>();
        for (LocationCatalogLocation location : providerLocations) {
            LocationMapping mapping = mappingsByRef.remove(
                    location.externalLocationRef());
            items.add(item(location, mapping, true));
        }
        mappingsByRef.values().forEach(mapping -> items.add(new LocationMappingItem(
                mapping.externalLocationRef(),
                mapping.externalName(),
                mapping.externalActive(),
                mapping.fulfillsOnlineOrders(),
                mapping.hasActiveInventory(),
                mapping.fulfillmentService(),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                false,
                mappedWarehouse(mapping))));
        List<WarehouseOption> warehouses = warehouseRepository
                .findAllByTenantIdAndStatusOrderByBusinessCodeAscIdAsc(
                        actor.tenantId(), WarehouseStatus.ACTIVE)
                .stream()
                .map(warehouse -> new WarehouseOption(
                        warehouse.getId(),
                        warehouse.getBusinessCode(),
                        warehouse.getName()))
                .toList();
        return new LocationMappingCatalog(items, warehouses);
    }

    public LocationMappingItem upsert(
            ShopCenterActor actor,
            UUID shopId,
            String externalLocationRef,
            UUID warehouseId) {
        requireActiveShop(actor, shopId);
        String normalizedRef = requireLocationRef(externalLocationRef);
        LocationCatalogLocation location = fetchAllLocations(
                        actor.tenantId(), shopId)
                .stream()
                .filter(item -> item.externalLocationRef().equals(normalizedRef))
                .findFirst()
                .orElseThrow(() -> new ConflictException(
                        "Shopify location is no longer available; refresh before mapping"));
        if (!location.active()) {
            throw new ConflictException(
                    "Inactive Shopify locations cannot be mapped");
        }
        LocationMapping mapping = writer.upsert(
                actor, shopId, warehouseId, location);
        return item(location, mapping, true);
    }

    public void delete(
            ShopCenterActor actor,
            UUID shopId,
            UUID mappingId) {
        requireActiveShop(actor, shopId);
        writer.delete(actor, shopId, mappingId);
    }

    private List<LocationCatalogLocation> fetchAllLocations(
            UUID tenantId,
            UUID shopId) {
        requireShopifyAccess(tenantId, shopId);
        List<LocationCatalogLocation> locations = new ArrayList<>();
        Set<String> refs = new HashSet<>();
        Set<String> cursors = new HashSet<>();
        String cursor = null;
        for (int pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
            var page = connector.fetchShopifyLocationCatalog(
                    tenantId,
                    shopId,
                    new ChannelConnectorGateway.LocationCatalogRequest(
                            PAGE_SIZE, cursor));
            if (page.connectionStatus() != ConnectionStatus.CONNECTED) {
                throw ShopifyAuthorizationConflictException.notConnected();
            }
            for (LocationCatalogLocation location : page.locations()) {
                if (!LOCATION_REF.matcher(location.externalLocationRef()).matches()
                        || location.name() == null
                        || location.name().isBlank()
                        || location.name().length() > 255
                        || !refs.add(location.externalLocationRef())) {
                    throw new ConflictException(
                            "Shopify location catalog returned invalid or ambiguous data");
                }
                locations.add(location);
            }
            if (!page.hasNextPage()) {
                return List.copyOf(locations);
            }
            cursor = page.cursor();
            if (cursor == null || cursor.isBlank() || !cursors.add(cursor)) {
                throw new ConflictException(
                        "Shopify location catalog pagination is invalid");
            }
        }
        throw new ConflictException(
                "Shopify location catalog exceeds the safe mapping limit");
    }

    private void requireShopifyAccess(UUID tenantId, UUID shopId) {
        var snapshot = connector.snapshot(tenantId, shopId);
        if (snapshot.shopify().status() != ConnectionStatus.CONNECTED) {
            throw ShopifyAuthorizationConflictException.notConnected();
        }
        var scope = snapshot.shopifyScopes().stream()
                .filter(item -> "read_locations".equals(item.scope()))
                .findFirst()
                .orElseThrow(ShopifyAuthorizationConflictException::scopeUnavailable);
        if (scope.status()
                == ChannelConnectorGateway.ShopifyScopeCoverageStatus.MISSING) {
            throw ShopifyAuthorizationConflictException.missingScope(
                    "read_locations");
        }
    }

    private void requireActiveShop(ShopCenterActor actor, UUID shopId) {
        if (actor == null || actor.tenantId() == null || shopId == null) {
            throw new IllegalArgumentException("Actor, tenant and shop are required");
        }
        if ((actor.userId() == null) == (actor.systemAdminId() == null)) {
            throw new IllegalArgumentException(
                    "Exactly one actor identity is required");
        }
        var shop = shopRepository.findByIdAndTenantId(shopId, actor.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Shop was not found"));
        if (shop.getStatus() != ShopStatus.ACTIVE) {
            throw new ConflictException(
                    "Shopify location mappings require an active shop");
        }
    }

    private static String requireLocationRef(String value) {
        String normalized = value == null ? "" : value.strip();
        if (!LOCATION_REF.matcher(normalized).matches()) {
            throw new IllegalArgumentException(
                    "A valid Shopify location reference is required");
        }
        return normalized;
    }

    private static LocationMappingItem item(
            LocationCatalogLocation location,
            LocationMapping mapping,
            boolean providerPresent) {
        return new LocationMappingItem(
                location.externalLocationRef(), location.name(),
                location.active(), location.fulfillsOnlineOrders(),
                location.hasActiveInventory(), location.fulfillmentService(),
                location.address1(), location.address2(), location.city(),
                location.province(), location.provinceCode(),
                location.country(), location.countryCode(), location.zip(),
                providerPresent,
                mapping == null ? null : mappedWarehouse(mapping));
    }

    private static MappedWarehouse mappedWarehouse(LocationMapping mapping) {
        return new MappedWarehouse(
                mapping.id(), mapping.warehouseId(), mapping.warehouseCode(),
                mapping.warehouseName(), mapping.warehouseStatus(),
                mapping.version());
    }

    public record LocationMappingCatalog(
            List<LocationMappingItem> locations,
            List<WarehouseOption> warehouses) {
        public LocationMappingCatalog {
            locations = List.copyOf(locations);
            warehouses = List.copyOf(warehouses);
        }
    }

    public record LocationMappingItem(
            String externalLocationRef,
            String name,
            boolean active,
            boolean fulfillsOnlineOrders,
            boolean hasActiveInventory,
            boolean fulfillmentService,
            String address1,
            String address2,
            String city,
            String province,
            String provinceCode,
            String country,
            String countryCode,
            String zip,
            boolean providerPresent,
            MappedWarehouse mapping) {
    }

    public record MappedWarehouse(
            UUID mappingId,
            UUID warehouseId,
            String businessCode,
            String name,
            String status,
            long version) {
    }

    public record WarehouseOption(UUID id, String businessCode, String name) {
    }
}
