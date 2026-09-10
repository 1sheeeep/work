package cn.xzkj.erp.product.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.domain.TenantShop;
import cn.xzkj.erp.platform.repository.TenantShopRepository;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.product.domain.ProductSku;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.product.repository.ProductSkuRepository;

@ExtendWith(MockitoExtension.class)
class ProductShopifyCatalogPreviewServiceTest {

    @Mock private TenantShopRepository shopRepository;
    @Mock private ProductSkuRepository skuRepository;
    @Mock private ChannelConnectorGateway connector;

    private ProductShopifyCatalogPreviewService service;

    @BeforeEach
    void setUp() {
        service = new ProductShopifyCatalogPreviewService(
                shopRepository,
                skuRepository,
                connector);
    }

    @Test
    void previewFetchesShopifyCatalogAndMarksSkuMatchesReadOnly() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        TenantShop shop = new TenantShop(
                tenantId,
                UUID.randomUUID(),
                "xz-dev.myshopify.com",
                "XZ Dev");
        ReflectionTestUtils.setField(shop, "id", shopId);
        when(shopRepository.findByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(shop));
        when(connector.snapshot(tenantId, shopId))
                .thenReturn(connectedSnapshot("read_products"));
        when(connector.fetchShopifyProductCatalog(
                eq(tenantId),
                eq(shopId),
                eq(new ChannelConnectorGateway.ProductCatalogRequest(
                        50,
                        "cursor-1",
                        "status:active"))))
                .thenReturn(new ChannelConnectorGateway.ProductCatalogPage(
                        ChannelConnectorGateway.ConnectorMode.XZ_ERP_APP,
                        ChannelConnectorGateway.ConnectionStatus.CONNECTED,
                        "cursor-2",
                        true,
                        Instant.parse("2026-07-31T06:00:00Z"),
                        List.of(new ChannelConnectorGateway.ProductCatalogProduct(
                                "gid://shopify/Product/1",
                                "HD Sunglasses",
                                "hd-sunglasses",
                                "ACTIVE",
                                Instant.parse("2026-07-31T05:59:00Z"),
                                List.of(
                                        new ChannelConnectorGateway.ProductCatalogVariant(
                                                "gid://shopify/ProductVariant/10",
                                                "gid://shopify/InventoryItem/20",
                                                " hd-b-m ",
                                                "Black / M",
                                                "19.99",
                                                "USD",
                                                true,
                                                true),
                                        new ChannelConnectorGateway.ProductCatalogVariant(
                                                "gid://shopify/ProductVariant/11",
                                                "gid://shopify/InventoryItem/21",
                                                "NO-LOCAL",
                                                "White / M",
                                                "20.99",
                                                "USD",
                                                true,
                                                true),
                                        new ChannelConnectorGateway.ProductCatalogVariant(
                                                "gid://shopify/ProductVariant/12",
                                                "gid://shopify/InventoryItem/22",
                                                " ",
                                                "No SKU",
                                                "21.99",
                                                "USD",
                                                false,
                                                false))))));
        UUID skuId = UUID.randomUUID();
        ProductSku matchedSku = new ProductSku(
                tenantId,
                UUID.randomUUID(),
                "HD-B-M",
                "HD Sunglasses Black M",
                null);
        ReflectionTestUtils.setField(matchedSku, "id", skuId);
        when(skuRepository.findByTenantIdAndBusinessCodeInAndStatusNot(
                eq(tenantId),
                argThat(ProductShopifyCatalogPreviewServiceTest::containsOnlyLookupSkus),
                eq(ProductStatus.ARCHIVED)))
                .thenReturn(List.of(matchedSku));

        var preview = service.preview(
                tenantId,
                shopId,
                50,
                " cursor-1 ",
                " status:active ");

        assertThat(preview.mode())
                .isEqualTo(ChannelConnectorGateway.ConnectorMode.XZ_ERP_APP);
        assertThat(preview.connectionStatus())
                .isEqualTo(ChannelConnectorGateway.ConnectionStatus.CONNECTED);
        assertThat(preview.cursor()).isEqualTo("cursor-2");
        assertThat(preview.products()).hasSize(1);
        assertThat(preview.products().get(0).updatedAt())
                .isEqualTo("2026-07-31T05:59:00Z");
        assertThat(preview.products().get(0).variants())
                .extracting(ProductShopifyCatalogPreviewService.ShopifyCatalogVariantPreview::matchStatus)
                .containsExactly(
                        ProductShopifyCatalogPreviewService.ShopifyCatalogMatchStatus.EXACT_SKU_MATCH,
                        ProductShopifyCatalogPreviewService.ShopifyCatalogMatchStatus.MISSING_LOCAL_SKU,
                        ProductShopifyCatalogPreviewService.ShopifyCatalogMatchStatus.EMPTY_PLATFORM_SKU);
        assertThat(preview.products().get(0).variants().get(0).localSku())
                .isEqualTo(new ProductShopifyCatalogPreviewService.LocalSkuMatch(
                        skuId,
                        "HD-B-M",
                        "HD Sunglasses Black M",
                        ProductStatus.ACTIVE));
    }

    @Test
    void inactiveShopCannotPreviewCatalog() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        TenantShop shop = new TenantShop(
                tenantId,
                UUID.randomUUID(),
                "xz-dev.myshopify.com",
                "XZ Dev");
        shop.update("xz-dev.myshopify.com", "XZ Dev", ShopStatus.ARCHIVED);
        when(shopRepository.findByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(shop));

        assertThatThrownBy(() -> service.preview(
                tenantId,
                shopId,
                50,
                null,
                null))
                .isInstanceOf(ConflictException.class);
        verify(connector, never()).fetchShopifyProductCatalog(
                eq(tenantId),
                eq(shopId),
                org.mockito.ArgumentMatchers.any());
    }

    @Test
    void missingReadProductsScopeBlocksPreviewBeforeCatalogFetch() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        TenantShop shop = new TenantShop(
                tenantId,
                UUID.randomUUID(),
                "xz-dev.myshopify.com",
                "XZ Dev");
        when(shopRepository.findByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(shop));
        when(connector.snapshot(tenantId, shopId))
                .thenReturn(new ChannelConnectorGateway.ChannelSnapshot(
                        ChannelConnectorGateway.ConnectorMode.XZ_ERP_APP,
                        new ChannelConnectorGateway.Connection(
                                ChannelConnectorGateway.ConnectionStatus.CONNECTED,
                                null,
                                null,
                                Instant.parse("2026-07-31T06:00:00Z")),
                        ChannelConnectorGateway.plannedShopifyScopes(
                                List.of("read_orders"),
                                true),
                        List.of()));

        assertThatThrownBy(() -> service.preview(
                tenantId,
                shopId,
                50,
                null,
                null))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("read_products");

        verify(connector, never()).fetchShopifyProductCatalog(
                eq(tenantId),
                eq(shopId),
                org.mockito.ArgumentMatchers.any());
    }

    private static boolean containsOnlyLookupSkus(Collection<String> values) {
        return values != null
                && values.size() == 2
                && values.contains("HD-B-M")
                && values.contains("NO-LOCAL");
    }

    private static ChannelConnectorGateway.ChannelSnapshot connectedSnapshot(
            String scope) {
        return new ChannelConnectorGateway.ChannelSnapshot(
                ChannelConnectorGateway.ConnectorMode.XZ_ERP_APP,
                new ChannelConnectorGateway.Connection(
                        ChannelConnectorGateway.ConnectionStatus.CONNECTED,
                        null,
                        null,
                        Instant.parse("2026-07-31T06:00:00Z")),
                ChannelConnectorGateway.plannedShopifyScopes(
                        List.of(scope),
                        true),
                List.of());
    }
}
