package cn.xzkj.erp.product.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.product.domain.ProductListing;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.product.service.ProductShopifyCatalogImportService.ShopifyCatalogImportStatus;
import cn.xzkj.erp.product.service.ProductShopifyCatalogPreviewService.LocalSkuMatch;
import cn.xzkj.erp.product.service.ProductShopifyCatalogPreviewService.ShopifyCatalogMatchStatus;
import cn.xzkj.erp.product.service.ProductShopifyCatalogPreviewService.ShopifyCatalogPreview;
import cn.xzkj.erp.product.service.ProductShopifyCatalogPreviewService.ShopifyCatalogProductPreview;
import cn.xzkj.erp.product.service.ProductShopifyCatalogPreviewService.ShopifyCatalogVariantPreview;

@ExtendWith(MockitoExtension.class)
class ProductShopifyCatalogImportServiceTest {

    @Mock private ProductShopifyCatalogPreviewService previewService;
    @Mock private ProductCenterService productCenterService;

    private ProductShopifyCatalogImportService service;

    @BeforeEach
    void setUp() {
        service = new ProductShopifyCatalogImportService(
                previewService,
                productCenterService);
    }

    @Test
    void importSelectedListingsCreatesOnlyExactSkuMatchesAndSkipsOthers() {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        UUID matchedSkuId = UUID.randomUUID();
        UUID conflictSkuId = UUID.randomUUID();
        UUID listingId = UUID.randomUUID();
        ProductActor actor = new ProductActor(
                tenantId,
                userId,
                null,
                "req-1",
                "127.0.0.1");
        when(previewService.preview(
                tenantId,
                shopId,
                50,
                "cursor-1",
                "status:active"))
                .thenReturn(preview(matchedSkuId, conflictSkuId));
        ProductListing listing = new ProductListing(
                tenantId,
                shopId,
                UUID.randomUUID(),
                matchedSkuId,
                "gid://shopify/Product/1",
                "gid://shopify/ProductVariant/10",
                "ACTIVE",
                null);
        ReflectionTestUtils.setField(listing, "id", listingId);
        when(productCenterService.createShopifyListing(
                eq(actor),
                eq(shopId),
                eq(matchedSkuId),
                eq("gid://shopify/Product/1"),
                eq("gid://shopify/ProductVariant/10"),
                eq("ACTIVE"),
                eq(null),
                eq("gid://shopify/InventoryItem/10")))
                .thenReturn(listing);
        when(productCenterService.createShopifyListing(
                eq(actor),
                eq(shopId),
                eq(conflictSkuId),
                eq("gid://shopify/Product/2"),
                eq("gid://shopify/ProductVariant/20"),
                eq("ACTIVE"),
                eq(null),
                eq("gid://shopify/InventoryItem/20")))
                .thenThrow(new ConflictException("private detail"));

        var result = service.importSelectedListings(
                actor,
                shopId,
                50,
                "cursor-1",
                "status:active",
                List.of(
                        "gid://shopify/ProductVariant/10",
                        "gid://shopify/ProductVariant/11",
                        "gid://shopify/ProductVariant/12",
                        "gid://shopify/ProductVariant/20",
                        "gid://shopify/ProductVariant/404"));

        assertThat(result.requestedCount()).isEqualTo(5);
        assertThat(result.importedCount()).isEqualTo(1);
        assertThat(result.skippedCount()).isEqualTo(4);
        assertThat(result.items())
                .extracting(ProductShopifyCatalogImportService.ShopifyCatalogImportItemResult::status)
                .containsExactly(
                        ShopifyCatalogImportStatus.IMPORTED_OR_ALREADY_BOUND,
                        ShopifyCatalogImportStatus.SKIPPED_MISSING_LOCAL_SKU,
                        ShopifyCatalogImportStatus.SKIPPED_EMPTY_PLATFORM_SKU,
                        ShopifyCatalogImportStatus.SKIPPED_CONFLICT,
                        ShopifyCatalogImportStatus.SKIPPED_NOT_IN_PAGE);
        assertThat(result.items().get(0).skuId()).isEqualTo(matchedSkuId);
        assertThat(result.items().get(0).listingId()).isEqualTo(listingId);
        assertThat(result.items().get(3).safeSummary())
                .isEqualTo("Listing could not be imported because it conflicts with existing product data");
        assertThat(result.items().get(4).externalVariantRef())
                .isEqualTo("gid://shopify/ProductVariant/404");

        verify(productCenterService).createShopifyListing(
                actor,
                shopId,
                matchedSkuId,
                "gid://shopify/Product/1",
                "gid://shopify/ProductVariant/10",
                "ACTIVE",
                null,
                "gid://shopify/InventoryItem/10");
    }

    @Test
    void importRequiresUniqueSelectedVariantRefs() {
        ProductActor actor = new ProductActor(
                UUID.randomUUID(),
                UUID.randomUUID(),
                null,
                null,
                null);

        assertThatThrownBy(() -> service.importSelectedListings(
                actor,
                UUID.randomUUID(),
                50,
                null,
                null,
                List.of(
                        "gid://shopify/ProductVariant/10",
                        " gid://shopify/ProductVariant/10 ")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("unique");
    }

    private static ShopifyCatalogPreview preview(
            UUID matchedSkuId,
            UUID conflictSkuId) {
        return new ShopifyCatalogPreview(
                ChannelConnectorGateway.ConnectorMode.XZ_ERP_APP,
                ChannelConnectorGateway.ConnectionStatus.CONNECTED,
                null,
                false,
                Instant.parse("2026-07-31T06:00:00Z"),
                List.of(
                        new ShopifyCatalogProductPreview(
                                "gid://shopify/Product/1",
                                "HD Sunglasses",
                                "hd-sunglasses",
                                "ACTIVE",
                                "2026-07-31T05:59:00Z",
                                List.of(
                                        new ShopifyCatalogVariantPreview(
                                                "gid://shopify/ProductVariant/10",
                                                "gid://shopify/InventoryItem/10",
                                                "HD-B-M",
                                                "Black / M",
                                                "19.99",
                                                "USD",
                                                true,
                                                true,
                                                ShopifyCatalogMatchStatus.EXACT_SKU_MATCH,
                                                new LocalSkuMatch(
                                                        matchedSkuId,
                                                        "HD-B-M",
                                                        "HD Black M",
                                                        ProductStatus.ACTIVE)),
                                        new ShopifyCatalogVariantPreview(
                                                "gid://shopify/ProductVariant/11",
                                                "gid://shopify/InventoryItem/11",
                                                "NO-LOCAL",
                                                "White / M",
                                                "20.99",
                                                "USD",
                                                true,
                                                true,
                                                ShopifyCatalogMatchStatus.MISSING_LOCAL_SKU,
                                                null),
                                        new ShopifyCatalogVariantPreview(
                                                "gid://shopify/ProductVariant/12",
                                                "gid://shopify/InventoryItem/12",
                                                "",
                                                "No SKU",
                                                "21.99",
                                                "USD",
                                                false,
                                                false,
                                                ShopifyCatalogMatchStatus.EMPTY_PLATFORM_SKU,
                                                null))),
                        new ShopifyCatalogProductPreview(
                                "gid://shopify/Product/2",
                                "Conflict Product",
                                "conflict-product",
                                "ACTIVE",
                                "2026-07-31T05:58:00Z",
                                List.of(new ShopifyCatalogVariantPreview(
                                        "gid://shopify/ProductVariant/20",
                                        "gid://shopify/InventoryItem/20",
                                        "CONFLICT",
                                        "Conflict",
                                        "29.99",
                                        "USD",
                                        true,
                                        true,
                                        ShopifyCatalogMatchStatus.EXACT_SKU_MATCH,
                                        new LocalSkuMatch(
                                                conflictSkuId,
                                                "CONFLICT",
                                                "Conflict",
                                                ProductStatus.ACTIVE))))));
    }
}
