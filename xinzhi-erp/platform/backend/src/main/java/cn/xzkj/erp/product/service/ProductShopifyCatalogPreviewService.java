package cn.xzkj.erp.product.service;

import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.repository.TenantShopRepository;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;
import cn.xzkj.erp.product.domain.ProductSku;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.product.repository.ProductSkuRepository;

@Service
public class ProductShopifyCatalogPreviewService {

    private final TenantShopRepository shopRepository;
    private final ProductSkuRepository skuRepository;
    private final ChannelConnectorGateway connector;

    public ProductShopifyCatalogPreviewService(
            TenantShopRepository shopRepository,
            ProductSkuRepository skuRepository,
            ChannelConnectorGateway connector) {
        this.shopRepository = shopRepository;
        this.skuRepository = skuRepository;
        this.connector = connector;
    }

    @Transactional(readOnly = true)
    public ShopifyCatalogPreview preview(
            UUID tenantId,
            UUID shopId,
            int limit,
            String cursor,
            String query) {
        if (tenantId == null || shopId == null) {
            throw new IllegalArgumentException("Tenant and shop are required");
        }
        if (limit < 1 || limit > 100) {
            throw new IllegalArgumentException(
                    "Shopify catalog preview limit must be between 1 and 100");
        }
        var shop = shopRepository.findByIdAndTenantId(shopId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Shop was not found"));
        if (shop.getStatus() != ShopStatus.ACTIVE) {
            throw new ConflictException(
                    "Shopify catalog preview requires an active shop");
        }
        requireShopifyAccess(tenantId, shopId, "read_products");
        var page = connector.fetchShopifyProductCatalog(
                tenantId,
                shopId,
                new ChannelConnectorGateway.ProductCatalogRequest(
                        limit,
                        nullable(cursor),
                        nullable(query)));
        Map<String, ProductSku> localSkus = localSkuMap(tenantId, page.products()
                .stream()
                .flatMap(product -> product.variants().stream())
                .map(ChannelConnectorGateway.ProductCatalogVariant::sku)
                .toList());
        List<ShopifyCatalogProductPreview> products = page.products().stream()
                .map(product -> new ShopifyCatalogProductPreview(
                        product.externalListingRef(),
                        product.title(),
                        product.handle(),
                        product.externalStatus(),
                        product.updatedAt() == null ? null : product.updatedAt().toString(),
                        product.variants().stream()
                                .map(variant -> variantPreview(variant, localSkus))
                                .toList()))
                .toList();
        return new ShopifyCatalogPreview(
                page.mode(),
                page.connectionStatus(),
                page.cursor(),
                page.hasNextPage(),
                page.fetchedAt(),
                products);
    }

    private Map<String, ProductSku> localSkuMap(
            UUID tenantId,
            Collection<String> platformSkus) {
        List<String> codes = platformSkus.stream()
                .map(ProductShopifyCatalogPreviewService::normalizeSkuCode)
                .filter(Objects::nonNull)
                .distinct()
                .sorted()
                .toList();
        if (codes.isEmpty()) {
            return Map.of();
        }
        return skuRepository.findByTenantIdAndBusinessCodeInAndStatusNot(
                        tenantId,
                        codes,
                        ProductStatus.ARCHIVED)
                .stream()
                .collect(Collectors.toMap(
                        sku -> normalizeSkuCode(sku.getBusinessCode()),
                        sku -> sku,
                        (left, ignored) -> left,
                        HashMap::new));
    }

    private ShopifyCatalogVariantPreview variantPreview(
            ChannelConnectorGateway.ProductCatalogVariant variant,
            Map<String, ProductSku> localSkus) {
        String normalized = normalizeSkuCode(variant.sku());
        ProductSku matched = normalized == null ? null : localSkus.get(normalized);
        ShopifyCatalogMatchStatus status = normalized == null
                ? ShopifyCatalogMatchStatus.EMPTY_PLATFORM_SKU
                : matched == null
                        ? ShopifyCatalogMatchStatus.MISSING_LOCAL_SKU
                        : ShopifyCatalogMatchStatus.EXACT_SKU_MATCH;
        return new ShopifyCatalogVariantPreview(
                variant.externalVariantRef(),
                variant.inventoryItemRef(),
                variant.sku(),
                variant.title(),
                variant.price(),
                variant.currencyCode(),
                variant.availableForSale(),
                variant.inventoryTracked(),
                status,
                matched == null ? null : new LocalSkuMatch(
                        matched.getId(),
                        matched.getBusinessCode(),
                        matched.getName(),
                        matched.getStatus()));
    }

    private static String nullable(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private static String normalizeSkuCode(String value) {
        String normalized = nullable(value);
        return normalized == null ? null : normalized.toUpperCase(Locale.ROOT);
    }

    private void requireShopifyAccess(
            UUID tenantId,
            UUID shopId,
            String requiredScope) {
        var snapshot = connector.snapshot(tenantId, shopId);
        if (snapshot.shopify().status() != ConnectionStatus.CONNECTED) {
            throw ShopifyAuthorizationConflictException.notConnected();
        }
        var scope = snapshot.shopifyScopes().stream()
                .filter(item -> requiredScope.equals(item.scope()))
                .findFirst()
                .orElseThrow(ShopifyAuthorizationConflictException::scopeUnavailable);
        if (scope.status()
                == ChannelConnectorGateway.ShopifyScopeCoverageStatus.MISSING) {
            throw ShopifyAuthorizationConflictException.missingScope(requiredScope);
        }
    }

    public record ShopifyCatalogPreview(
            ChannelConnectorGateway.ConnectorMode mode,
            ConnectionStatus connectionStatus,
            String cursor,
            boolean hasNextPage,
            java.time.Instant fetchedAt,
            List<ShopifyCatalogProductPreview> products) {
        public ShopifyCatalogPreview {
            products = List.copyOf(products);
        }
    }

    public record ShopifyCatalogProductPreview(
            String externalListingRef,
            String title,
            String handle,
            String externalStatus,
            String updatedAt,
            List<ShopifyCatalogVariantPreview> variants) {
        public ShopifyCatalogProductPreview {
            variants = List.copyOf(variants);
        }
    }

    public record ShopifyCatalogVariantPreview(
            String externalVariantRef,
            String inventoryItemRef,
            String platformSku,
            String title,
            String price,
            String currencyCode,
            boolean availableForSale,
            boolean inventoryTracked,
            ShopifyCatalogMatchStatus matchStatus,
            LocalSkuMatch localSku) {
    }

    public enum ShopifyCatalogMatchStatus {
        EXACT_SKU_MATCH,
        MISSING_LOCAL_SKU,
        EMPTY_PLATFORM_SKU
    }

    public record LocalSkuMatch(
            UUID id,
            String businessCode,
            String name,
            ProductStatus status) {
    }
}
