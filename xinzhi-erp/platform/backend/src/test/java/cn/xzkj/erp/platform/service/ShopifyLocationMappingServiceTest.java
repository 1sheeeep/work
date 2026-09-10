package cn.xzkj.erp.platform.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ChannelSnapshot;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Connection;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectorMode;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.LocationCatalogLocation;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.LocationCatalogPage;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyPermissionScope;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyScopeCoverageStatus;
import cn.xzkj.erp.platform.domain.TenantShop;
import cn.xzkj.erp.platform.repository.ShopifyLocationMappingRepository;
import cn.xzkj.erp.platform.repository.ShopifyLocationMappingRepository.LocationMapping;
import cn.xzkj.erp.platform.repository.TenantShopRepository;
import cn.xzkj.erp.warehouse.repository.WarehouseRepository;

class ShopifyLocationMappingServiceTest {

    private final UUID tenantId = UUID.randomUUID();
    private final UUID shopId = UUID.randomUUID();
    private final UUID platformId = UUID.randomUUID();
    private final UUID warehouseId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();

    private TenantShopRepository shops;
    private WarehouseRepository warehouses;
    private ShopifyLocationMappingRepository mappings;
    private ChannelConnectorGateway connector;
    private ShopifyLocationMappingWriter writer;
    private ShopifyLocationMappingService service;

    @BeforeEach
    void setUp() {
        shops = mock(TenantShopRepository.class);
        warehouses = mock(WarehouseRepository.class);
        mappings = mock(ShopifyLocationMappingRepository.class);
        connector = mock(ChannelConnectorGateway.class);
        writer = mock(ShopifyLocationMappingWriter.class);
        service = new ShopifyLocationMappingService(
                shops, warehouses, mappings, connector, writer);
        when(shops.findByIdAndTenantId(shopId, tenantId)).thenReturn(
                Optional.of(new TenantShop(
                        tenantId, platformId, "shop.myshopify.com", "Shop")));
        when(connector.snapshot(tenantId, shopId)).thenReturn(connectedSnapshot());
    }

    @Test
    void paginatesTheCompleteLocationCatalogBeforeReturningMappings() {
        LocationCatalogLocation first = location(
                "gid://shopify/Location/100", "Toronto", true);
        LocationCatalogLocation second = location(
                "gid://shopify/Location/200", "Vancouver", true);
        when(connector.fetchShopifyLocationCatalog(
                tenantId, shopId,
                new ChannelConnectorGateway.LocationCatalogRequest(100, null)))
                .thenReturn(new LocationCatalogPage(
                        ConnectorMode.XZ_ERP_APP, ConnectionStatus.CONNECTED,
                        "next==", true, Instant.now(), List.of(first)));
        when(connector.fetchShopifyLocationCatalog(
                tenantId, shopId,
                new ChannelConnectorGateway.LocationCatalogRequest(
                        100, "next==")))
                .thenReturn(new LocationCatalogPage(
                        ConnectorMode.XZ_ERP_APP, ConnectionStatus.CONNECTED,
                        null, false, Instant.now(), List.of(second)));
        when(mappings.findAll(tenantId, shopId)).thenReturn(List.of());

        var result = service.list(actor(), shopId);

        assertThat(result.locations()).extracting(
                ShopifyLocationMappingService.LocationMappingItem::externalLocationRef)
                .containsExactly(
                        "gid://shopify/Location/100",
                        "gid://shopify/Location/200");
    }

    @Test
    void refusesInactiveProviderLocationBeforeEnteringTheWriteTransaction() {
        LocationCatalogLocation inactive = location(
                "gid://shopify/Location/100", "Closed", false);
        when(connector.fetchShopifyLocationCatalog(
                tenantId, shopId,
                new ChannelConnectorGateway.LocationCatalogRequest(100, null)))
                .thenReturn(new LocationCatalogPage(
                        ConnectorMode.XZ_ERP_APP, ConnectionStatus.CONNECTED,
                        null, false, Instant.now(), List.of(inactive)));

        assertThatThrownBy(() -> service.upsert(
                actor(), shopId, inactive.externalLocationRef(), warehouseId))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("Inactive Shopify locations");

        verify(writer, never()).upsert(
                actor(), shopId, warehouseId, inactive);
    }

    @Test
    void mapsOnlyTheProviderLocationSelectedByItsExactReference() {
        LocationCatalogLocation location = location(
                "gid://shopify/Location/100", "Toronto", true);
        when(connector.fetchShopifyLocationCatalog(
                tenantId, shopId,
                new ChannelConnectorGateway.LocationCatalogRequest(100, null)))
                .thenReturn(new LocationCatalogPage(
                        ConnectorMode.XZ_ERP_APP, ConnectionStatus.CONNECTED,
                        null, false, Instant.now(), List.of(location)));
        LocationMapping saved = new LocationMapping(
                UUID.randomUUID(), location.externalLocationRef(), location.name(),
                true, true, true, false, warehouseId, "CA-01",
                "Canada warehouse", "ACTIVE", 0);
        when(writer.upsert(actor(), shopId, warehouseId, location))
                .thenReturn(saved);

        var result = service.upsert(
                actor(), shopId, location.externalLocationRef(), warehouseId);

        assertThat(result.mapping().warehouseId()).isEqualTo(warehouseId);
        assertThat(result.providerPresent()).isTrue();
    }

    private ShopCenterActor actor() {
        return new ShopCenterActor(
                tenantId, userId, null, "request-1", "127.0.0.1");
    }

    private ChannelSnapshot connectedSnapshot() {
        return new ChannelSnapshot(
                ConnectorMode.XZ_ERP_APP,
                new Connection(
                        ConnectionStatus.CONNECTED, null, null, Instant.now()),
                List.of(new ShopifyPermissionScope(
                        "read_locations", "Location read",
                        ShopifyScopeCoverageStatus.GRANTED)),
                List.of());
    }

    private static LocationCatalogLocation location(
            String ref,
            String name,
            boolean active) {
        return new LocationCatalogLocation(
                ref, name, active, true, true, false,
                null, null, "Toronto", "Ontario", "ON",
                "Canada", "CA", null);
    }
}
