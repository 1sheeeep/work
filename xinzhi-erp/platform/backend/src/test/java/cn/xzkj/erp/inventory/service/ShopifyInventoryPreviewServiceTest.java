package cn.xzkj.erp.inventory.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.domain.TenantShop;
import cn.xzkj.erp.platform.repository.ShopifyLocationMappingRepository;
import cn.xzkj.erp.platform.repository.TenantShopRepository;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.product.domain.ListingStatus;
import cn.xzkj.erp.product.domain.ProductListing;
import cn.xzkj.erp.product.repository.ProductListingRepository;

@ExtendWith(MockitoExtension.class)
class ShopifyInventoryPreviewServiceTest {

    @Mock private InventoryService inventoryService;
    @Mock private TenantShopRepository shopRepository;
    @Mock private ProductListingRepository listingRepository;
    @Mock private ShopifyLocationMappingRepository mappingRepository;
    @Mock private ChannelConnectorGateway connector;

    private ShopifyInventoryPreviewService service;

    @BeforeEach
    void setUp() {
        service = new ShopifyInventoryPreviewService(
                inventoryService, shopRepository, listingRepository,
                mappingRepository, connector);
    }

    @Test
    void previewsErpAvailableAgainstTrackedShopifyInventory() {
        Fixture fixture = fixture();
        stubMappings(fixture, List.of(listing(fixture, "200")));
        when(connector.fetchShopifyInventoryLevel(
                fixture.tenantId(), fixture.shopId(),
                new ChannelConnectorGateway.InventoryLevelRequest(
                        "gid://shopify/InventoryItem/200",
                        "gid://shopify/Location/100")))
                .thenReturn(new ChannelConnectorGateway.InventoryLevelSnapshot(
                        ChannelConnectorGateway.ConnectorMode.XZ_ERP_APP,
                        ChannelConnectorGateway.ConnectionStatus.CONNECTED,
                        "gid://shopify/InventoryItem/200",
                        "gid://shopify/Location/100",
                        true, true, 7, 10,
                        Instant.parse("2026-08-01T00:00:00Z")));

        var result = service.preview(
                fixture.actor(), fixture.shopId(), fixture.balanceId());

        assertThat(result.erpOnHand()).isEqualTo(12);
        assertThat(result.erpReserved()).isEqualTo(3);
        assertThat(result.erpAvailable()).isEqualTo(9);
        assertThat(result.shopifyAvailable()).isEqualTo(7);
        assertThat(result.availableDifference()).isEqualTo(2);
    }

    @Test
    void failsClosedWhenSkuHasMultipleInventoryItemMappings() {
        Fixture fixture = fixture();
        stubMappings(fixture, List.of(
                listing(fixture, "200"), listing(fixture, "201")));

        assertThatThrownBy(() -> service.preview(
                fixture.actor(), fixture.shopId(), fixture.balanceId()))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("multiple");
    }

    private void stubMappings(Fixture fixture, List<ProductListing> listings) {
        when(shopRepository.findByIdAndTenantId(
                fixture.shopId(), fixture.tenantId()))
                .thenReturn(java.util.Optional.of(new TenantShop(
                        fixture.tenantId(), UUID.randomUUID(),
                        "demo.myshopify.com", "Demo")));
        when(inventoryService.getBalance(fixture.actor(), fixture.balanceId()))
                .thenReturn(new InventoryBalanceView(
                        fixture.balanceId(), fixture.skuId(), "SKU-1", "Item",
                        fixture.warehouseId(), "WH-1", "Main",
                        12, 3, 4,
                        Instant.parse("2026-08-01T00:00:00Z")));
        when(listingRepository
                .findAllByTenantIdAndShopIdAndSkuIdAndStatusAndExternalInventoryItemRefIsNotNull(
                        fixture.tenantId(), fixture.shopId(), fixture.skuId(),
                        ListingStatus.ACTIVE))
                .thenReturn(listings);
        if (listings.size() == 1) {
            when(mappingRepository.findAll(fixture.tenantId(), fixture.shopId()))
                    .thenReturn(List.of(new ShopifyLocationMappingRepository.LocationMapping(
                            UUID.randomUUID(), "gid://shopify/Location/100",
                            "Main", true, true, true, false,
                            fixture.warehouseId(), "WH-1", "Main", "ACTIVE", 0)));
        }
    }

    private static ProductListing listing(Fixture fixture, String inventoryItemId) {
        return new ProductListing(
                fixture.tenantId(), fixture.shopId(), UUID.randomUUID(),
                fixture.skuId(), "gid://shopify/Product/1",
                "gid://shopify/ProductVariant/" + inventoryItemId,
                "gid://shopify/InventoryItem/" + inventoryItemId,
                "ACTIVE", null);
    }

    private static Fixture fixture() {
        UUID tenantId = UUID.randomUUID();
        return new Fixture(
                tenantId, UUID.randomUUID(), UUID.randomUUID(),
                UUID.randomUUID(),
                new InventoryActor(tenantId, UUID.randomUUID(), null, null, "127.0.0.1"));
    }

    private record Fixture(
            UUID tenantId,
            UUID shopId,
            UUID skuId,
            UUID warehouseId,
            InventoryActor actor) {
        UUID balanceId() {
            return UUID.nameUUIDFromBytes((skuId + ":" + warehouseId).getBytes());
        }
    }
}
