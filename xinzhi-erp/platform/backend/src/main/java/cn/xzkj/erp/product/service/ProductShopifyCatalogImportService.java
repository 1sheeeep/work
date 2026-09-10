package cn.xzkj.erp.product.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Service;

import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.product.domain.ProductListing;
import cn.xzkj.erp.product.service.ProductShopifyCatalogPreviewService.LocalSkuMatch;
import cn.xzkj.erp.product.service.ProductShopifyCatalogPreviewService.ShopifyCatalogMatchStatus;
import cn.xzkj.erp.product.service.ProductShopifyCatalogPreviewService.ShopifyCatalogProductPreview;
import cn.xzkj.erp.product.service.ProductShopifyCatalogPreviewService.ShopifyCatalogVariantPreview;

@Service
public class ProductShopifyCatalogImportService {

    private static final int MAX_SELECTED_VARIANTS = 100;

    private final ProductShopifyCatalogPreviewService previewService;
    private final ProductCenterService productCenterService;

    public ProductShopifyCatalogImportService(
            ProductShopifyCatalogPreviewService previewService,
            ProductCenterService productCenterService) {
        this.previewService = previewService;
        this.productCenterService = productCenterService;
    }

    public ShopifyCatalogImportResult importSelectedListings(
            ProductActor actor,
            UUID shopId,
            int limit,
            String cursor,
            String query,
            List<String> externalVariantRefs) {
        Objects.requireNonNull(actor, "Actor is required");
        UUID tenantId = Objects.requireNonNull(
                actor.tenantId(),
                "Tenant is required");
        Set<String> selectedRefs = selectedRefs(externalVariantRefs);
        var preview = previewService.preview(
                tenantId,
                shopId,
                limit,
                cursor,
                query);
        Map<String, VariantContext> variants = new LinkedHashMap<>();
        for (ShopifyCatalogProductPreview product : preview.products()) {
            for (ShopifyCatalogVariantPreview variant : product.variants()) {
                if (variant.externalVariantRef() != null) {
                    variants.putIfAbsent(
                            variant.externalVariantRef(),
                            new VariantContext(product, variant));
                }
            }
        }

        List<ShopifyCatalogImportItemResult> items = new ArrayList<>();
        for (String selectedRef : selectedRefs) {
            VariantContext context = variants.get(selectedRef);
            if (context == null) {
                items.add(skipped(
                        null,
                        selectedRef,
                        null,
                        ShopifyCatalogImportStatus.SKIPPED_NOT_IN_PAGE,
                        "Selected Shopify variant was not found in the fetched catalog page"));
                continue;
            }
            items.add(importVariant(actor, shopId, context));
        }
        long importedCount = items.stream()
                .filter(item -> item.status()
                        == ShopifyCatalogImportStatus.IMPORTED_OR_ALREADY_BOUND)
                .count();
        return new ShopifyCatalogImportResult(
                selectedRefs.size(),
                importedCount,
                items.size() - importedCount,
                items);
    }

    private ShopifyCatalogImportItemResult importVariant(
            ProductActor actor,
            UUID shopId,
            VariantContext context) {
        ShopifyCatalogProductPreview product = context.product();
        ShopifyCatalogVariantPreview variant = context.variant();
        if (variant.matchStatus() == ShopifyCatalogMatchStatus.EMPTY_PLATFORM_SKU) {
            return skipped(
                    product.externalListingRef(),
                    variant.externalVariantRef(),
                    variant.platformSku(),
                    ShopifyCatalogImportStatus.SKIPPED_EMPTY_PLATFORM_SKU,
                    "Shopify variant has no SKU");
        }
        if (variant.matchStatus() == ShopifyCatalogMatchStatus.MISSING_LOCAL_SKU
                || variant.localSku() == null) {
            return skipped(
                    product.externalListingRef(),
                    variant.externalVariantRef(),
                    variant.platformSku(),
                    ShopifyCatalogImportStatus.SKIPPED_MISSING_LOCAL_SKU,
                    "No active local SKU matched the Shopify variant SKU");
        }
        LocalSkuMatch localSku = variant.localSku();
        try {
            ProductListing listing = productCenterService.createShopifyListing(
                    actor,
                    shopId,
                    localSku.id(),
                    product.externalListingRef(),
                    variant.externalVariantRef(),
                    product.externalStatus(),
                    null,
                    variant.inventoryItemRef());
            return new ShopifyCatalogImportItemResult(
                    product.externalListingRef(),
                    variant.externalVariantRef(),
                    variant.platformSku(),
                    localSku.id(),
                    listing.getId(),
                    ShopifyCatalogImportStatus.IMPORTED_OR_ALREADY_BOUND,
                    null);
        } catch (ConflictException ex) {
            return skipped(
                    product.externalListingRef(),
                    variant.externalVariantRef(),
                    variant.platformSku(),
                    ShopifyCatalogImportStatus.SKIPPED_CONFLICT,
                    "Listing could not be imported because it conflicts with existing product data");
        } catch (ResourceNotFoundException ex) {
            return skipped(
                    product.externalListingRef(),
                    variant.externalVariantRef(),
                    variant.platformSku(),
                    ShopifyCatalogImportStatus.SKIPPED_MISSING_LOCAL_SKU,
                    "Matched local SKU was not found");
        }
    }

    private static ShopifyCatalogImportItemResult skipped(
            String externalListingRef,
            String externalVariantRef,
            String platformSku,
            ShopifyCatalogImportStatus status,
            String safeSummary) {
        return new ShopifyCatalogImportItemResult(
                externalListingRef,
                externalVariantRef,
                platformSku,
                null,
                null,
                status,
                safeSummary);
    }

    private static Set<String> selectedRefs(List<String> externalVariantRefs) {
        if (externalVariantRefs == null || externalVariantRefs.isEmpty()) {
            throw new IllegalArgumentException(
                    "At least one Shopify variant must be selected");
        }
        if (externalVariantRefs.size() > MAX_SELECTED_VARIANTS) {
            throw new IllegalArgumentException(
                    "At most 100 Shopify variants can be imported at once");
        }
        Set<String> refs = new LinkedHashSet<>();
        for (String ref : externalVariantRefs) {
            String normalized = ref == null ? null : ref.strip();
            if (normalized == null || normalized.isBlank()
                    || normalized.length() > 160) {
                throw new IllegalArgumentException(
                        "Shopify variant reference is invalid");
            }
            if (!refs.add(normalized)) {
                throw new IllegalArgumentException(
                        "Shopify variant references must be unique");
            }
        }
        return refs;
    }

    private record VariantContext(
            ShopifyCatalogProductPreview product,
            ShopifyCatalogVariantPreview variant) {
    }

    public record ShopifyCatalogImportResult(
            int requestedCount,
            long importedCount,
            long skippedCount,
            List<ShopifyCatalogImportItemResult> items) {
        public ShopifyCatalogImportResult {
            items = List.copyOf(items);
        }
    }

    public record ShopifyCatalogImportItemResult(
            String externalListingRef,
            String externalVariantRef,
            String platformSku,
            UUID skuId,
            UUID listingId,
            ShopifyCatalogImportStatus status,
            String safeSummary) {
    }

    public enum ShopifyCatalogImportStatus {
        IMPORTED_OR_ALREADY_BOUND,
        SKIPPED_NOT_IN_PAGE,
        SKIPPED_EMPTY_PLATFORM_SKU,
        SKIPPED_MISSING_LOCAL_SKU,
        SKIPPED_CONFLICT
    }
}
