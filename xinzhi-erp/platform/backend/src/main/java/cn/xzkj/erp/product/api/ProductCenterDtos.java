package cn.xzkj.erp.product.api;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonIgnore;
import cn.xzkj.erp.product.domain.ListingStatus;
import cn.xzkj.erp.product.domain.ProductListing;
import cn.xzkj.erp.product.domain.ProductSensitiveAttributeCode;
import cn.xzkj.erp.product.domain.ProductSku;
import cn.xzkj.erp.product.domain.ProductSpu;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.product.service.ProductCenterService.SkuSummary;
import cn.xzkj.erp.product.service.ProductCenterService.SkuWithMasterIdentity;
import cn.xzkj.erp.product.service.ProductCenterService.ListingWithSku;
import cn.xzkj.erp.product.service.ProductCenterService.MasterSpuMetrics;
import cn.xzkj.erp.product.service.ProductCenterService.SpuValues;
import cn.xzkj.erp.product.service.ProductCenterService.SkuValues;
import cn.xzkj.erp.product.service.SkuListingSummary;
import cn.xzkj.erp.product.service.ProductShopifyCatalogImportService;
import cn.xzkj.erp.product.service.ProductShopifyCatalogPreviewService;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class ProductCenterDtos {
    public static final String BUSINESS_CODE_PATTERN = "[A-Z][A-Z0-9_-]{1,63}";
    private ProductCenterDtos() { }

    public record CreateSpuRequest(
            @NotBlank @Pattern(regexp = BUSINESS_CODE_PATTERN) String businessCode,
            @Size(max = 200) String name,
            @Size(max = 200) String nameZh,
            @Size(max = 200) String nameEn,
            @Size(max = 160) String brandName,
            @Size(max = 2000) String productNote,
            UUID categoryId,
            @Min(1) @jakarta.validation.constraints.Max(1_000_000)
                    Long lengthMm,
            @Min(1) @jakarta.validation.constraints.Max(1_000_000)
                    Long widthMm,
            @Min(1) @jakarta.validation.constraints.Max(1_000_000)
                    Long heightMm,
            @Min(1) @jakarta.validation.constraints.Max(1_000_000_000L)
                    Long actualWeightGrams,
            Integer volumetricDivisor,
            UUID packageMaterialId,
            @Min(1) @jakarta.validation.constraints.Max(1_000_000)
                    Integer packageableCount,
            UUID artMemberId,
            UUID developerMemberId,
            UUID developerAssistantMemberId,
            UUID salesMemberId,
            List<ProductSensitiveAttributeCode> sensitiveAttributeCodes,
            @Size(max = 100) List<@NotNull @Valid InitialSkuRequest> initialSkus) {
        @JsonIgnore
        @AssertTrue
        public boolean isChineseNameCompatible() {
            return compatibleChineseName(name, nameZh);
        }

        @JsonIgnore
        @AssertTrue
        public boolean isDimensionsComplete() {
            return completeDimensions(lengthMm, widthMm, heightMm);
        }

        @JsonIgnore
        @AssertTrue
        public boolean isPackageMaterialComplete() {
            return paired(packageMaterialId, packageableCount);
        }

        @JsonIgnore
        @AssertTrue
        public boolean isVolumetricDivisorValid() {
            return volumetricDivisor == null
                    || volumetricDivisor == 5000
                    || volumetricDivisor == 6000;
        }

        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown product SPU request field");
        }

        SpuValues values() {
            return new SpuValues(
                    name,
                    nameZh,
                    nameEn,
                    brandName,
                    productNote,
                    categoryId,
                    lengthMm,
                    widthMm,
                    heightMm,
                    actualWeightGrams,
                    volumetricDivisor == null ? 5000 : volumetricDivisor,
                    packageMaterialId,
                    packageableCount,
                    artMemberId,
                    developerMemberId,
                    developerAssistantMemberId,
                    salesMemberId);
        }
    }
    public record InitialSkuRequest(
            @NotBlank @Pattern(regexp = BUSINESS_CODE_PATTERN) String businessCode,
            @NotBlank @Size(max = 200) String name,
            @Size(max = 200) String nameEn,
            @Size(max = 1000) String variantSummary,
            @Pattern(regexp = "(0|[1-9][0-9]{0,9})(\\.[0-9]{1,4})?") String unitCost,
            @Pattern(regexp = "[A-Z]{3}") String currencyCode,
            UUID defaultWarehouseId) {
        @JsonIgnore
        @AssertTrue
        public boolean isCostComplete() {
            return paired(unitCost, currencyCode);
        }

        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException("Unknown product SKU request field");
        }

        SkuValues values() {
            return new SkuValues(name, nameEn, variantSummary, unitCost,
                    currencyCode, defaultWarehouseId);
        }
    }
    public record UpdateSpuRequest(
            @NotNull @Min(0) Long version,
            @Size(max = 200) String name,
            @Size(max = 200) String nameZh,
            @Size(max = 200) String nameEn,
            @Size(max = 160) String brandName,
            @Size(max = 2000) String productNote,
            UUID categoryId,
            @Min(1) @jakarta.validation.constraints.Max(1_000_000)
                    Long lengthMm,
            @Min(1) @jakarta.validation.constraints.Max(1_000_000)
                    Long widthMm,
            @Min(1) @jakarta.validation.constraints.Max(1_000_000)
                    Long heightMm,
            @Min(1) @jakarta.validation.constraints.Max(1_000_000_000L)
                    Long actualWeightGrams,
            Integer volumetricDivisor,
            UUID packageMaterialId,
            @Min(1) @jakarta.validation.constraints.Max(1_000_000)
                    Integer packageableCount,
            UUID artMemberId,
            UUID developerMemberId,
            UUID developerAssistantMemberId,
            UUID salesMemberId,
            List<ProductSensitiveAttributeCode> sensitiveAttributeCodes,
            @NotNull ProductStatus status) {
        @JsonIgnore
        @AssertTrue
        public boolean isChineseNameCompatible() {
            return compatibleChineseName(name, nameZh);
        }

        @JsonIgnore
        @AssertTrue
        public boolean isDimensionsComplete() {
            return completeDimensions(lengthMm, widthMm, heightMm);
        }

        @JsonIgnore
        @AssertTrue
        public boolean isPackageMaterialComplete() {
            return paired(packageMaterialId, packageableCount);
        }

        @JsonIgnore
        @AssertTrue
        public boolean isVolumetricDivisorValid() {
            return volumetricDivisor == null
                    || volumetricDivisor == 5000
                    || volumetricDivisor == 6000;
        }

        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException(
                    "Unknown product SPU request field");
        }

        SpuValues values() {
            return new SpuValues(
                    name,
                    nameZh,
                    nameEn,
                    brandName,
                    productNote,
                    categoryId,
                    lengthMm,
                    widthMm,
                    heightMm,
                    actualWeightGrams,
                    volumetricDivisor,
                    packageMaterialId,
                    packageableCount,
                    artMemberId,
                    developerMemberId,
                    developerAssistantMemberId,
                    salesMemberId);
        }
    }
    public record CreateSkuRequest(
            @NotBlank @Pattern(regexp = BUSINESS_CODE_PATTERN) String businessCode,
            @NotBlank @Size(max = 200) String name,
            @Size(max = 200) String nameEn,
            @Size(max = 1000) String variantSummary,
            @Pattern(regexp = "(0|[1-9][0-9]{0,9})(\\.[0-9]{1,4})?") String unitCost,
            @Pattern(regexp = "[A-Z]{3}") String currencyCode,
            UUID defaultWarehouseId) {
        @JsonIgnore
        @AssertTrue
        public boolean isCostComplete() {
            return paired(unitCost, currencyCode);
        }

        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException("Unknown product SKU request field");
        }

        SkuValues values() {
            return new SkuValues(name, nameEn, variantSummary, unitCost,
                    currencyCode, defaultWarehouseId);
        }
    }
    public record UpdateSkuRequest(
            @NotNull @Min(0) Long version,
            @NotBlank @Size(max = 200) String name,
            @Size(max = 200) String nameEn,
            @Size(max = 1000) String variantSummary,
            @Pattern(regexp = "(0|[1-9][0-9]{0,9})(\\.[0-9]{1,4})?") String unitCost,
            @Pattern(regexp = "[A-Z]{3}") String currencyCode,
            UUID defaultWarehouseId,
            @NotNull ProductStatus status) {
        @JsonIgnore
        @AssertTrue
        public boolean isCostComplete() {
            return paired(unitCost, currencyCode);
        }

        @JsonAnySetter
        public void rejectUnknownField(String field, Object value) {
            throw new IllegalArgumentException("Unknown product SKU request field");
        }
    }
    public record UpdateSkuWeightRequest(
            @NotNull @Min(0) Long version,
            @Min(1) @Max(999999999) Long standardWeightGrams) {
    }
    public record ReassignSkuRequest(
            @NotNull UUID spuId,
            @NotNull @Min(0) Long version) { }
    public record CreateListingRequest(
            @NotNull UUID shopId,
            @NotNull UUID skuId,
            @NotBlank @Size(max = 160) String externalListingRef,
            @Size(max = 160) String externalVariantRef,
            @Size(max = 80) String externalStatus,
            @Size(max = 1000) String metadataNote) { }
    public record UpdateListingRequest(
            @NotNull @Min(0) Long version,
            @Size(max = 80) String externalStatus,
            @Size(max = 1000) String metadataNote,
            @NotNull ListingStatus status) { }
    public record ArchiveRequest(@NotNull @Min(0) Long version) { }
    public record VersionedResourceRequest(
            @NotNull UUID id,
            @NotNull @Min(0) Long version) { }
    public record BatchSpuStatusRequest(
            @NotNull @Size(min = 1, max = 200) List<@NotNull @Valid VersionedResourceRequest> items,
            @NotNull ProductStatus status) { }
    public record BatchSpuArchiveRequest(
            @NotNull @Size(min = 1, max = 200) List<@NotNull @Valid VersionedResourceRequest> items) { }
    public record BatchSpuImportRequest(
            @NotNull @Size(min = 1, max = 200) List<@NotNull @Valid CreateSpuRequest> items) { }
    public record ImportedSpuUpdateRequest(
            @NotNull UUID id,
            @NotNull @Valid UpdateSpuRequest values) { }
    public record BatchSpuUpdateImportRequest(
            @NotNull @Size(min = 1, max = 200) List<@NotNull @Valid ImportedSpuUpdateRequest> items) { }

    public record SkuSummaryResponse(long totalSkuCount, long activeSkuCount) {
        static SkuSummaryResponse from(SkuSummary summary) {
            return new SkuSummaryResponse(summary.totalSkuCount(), summary.activeSkuCount());
        }
    }
    public record ReferenceResponse(UUID id, String displayName) { }

    public record MasterSpuMetricsResponse(
            long totalInventory,
            long sales7,
            long sales28,
            long sales42,
            double forecastDailySales,
            String creatorName) {
        static MasterSpuMetricsResponse from(MasterSpuMetrics value) {
            return value == null ? null : new MasterSpuMetricsResponse(
                    value.totalInventory(), value.sales7(), value.sales28(),
                    value.sales42(), value.forecastDailySales(),
                    value.creatorName());
        }
    }

    public record SpuResponse(UUID id, String businessCode, String name,
            String nameZh, String nameEn, String brandName,
            String productNote,
            ReferenceResponse category,
            Long lengthMm, Long widthMm, Long heightMm,
            Long actualWeightGrams, int volumetricDivisor,
            ReferenceResponse packageMaterial, Integer packageableCount,
            ReferenceResponse artMember,
            ReferenceResponse developerMember,
            ReferenceResponse developerAssistantMember,
            ReferenceResponse salesMember,
            List<ProductSensitiveAttributeCode> sensitiveAttributeCodes,
            ProductStatus status, SkuSummaryResponse skuSummary, Instant createdAt,
            Instant updatedAt, long version, MasterSpuMetricsResponse metrics) {
        static SpuResponse from(
                ProductSpu entity,
                SkuSummary summary,
                List<ProductSensitiveAttributeCode> sensitiveAttributeCodes,
                MasterSpuMetrics metrics) {
            return new SpuResponse(entity.getId(), entity.getBusinessCode(),
                    entity.getName(), entity.getNameZh(), entity.getNameEn(),
                    entity.getBrandName(), entity.getProductNote(),
                    reference(entity.getCategoryId(),
                            entity.getCategoryNameSnapshot()),
                    entity.getLengthMm(), entity.getWidthMm(),
                    entity.getHeightMm(), entity.getActualWeightGrams(),
                    entity.getVolumetricDivisor(),
                    reference(entity.getPackageMaterialId(),
                            entity.getPackageMaterialNameSnapshot()),
                    entity.getPackageableCount(),
                    reference(entity.getArtMemberId(),
                            entity.getArtMemberNameSnapshot()),
                    reference(entity.getDeveloperMemberId(),
                            entity.getDeveloperMemberNameSnapshot()),
                    reference(entity.getDeveloperAssistantMemberId(),
                            entity.getDeveloperAssistantMemberNameSnapshot()),
                    reference(entity.getSalesMemberId(),
                            entity.getSalesMemberNameSnapshot()),
                    sensitiveAttributeCodes, entity.getStatus(),
                    SkuSummaryResponse.from(summary),
                    entity.getCreatedAt(), entity.getUpdatedAt(), entity.getVersion(),
                    MasterSpuMetricsResponse.from(metrics));
        }
    }
    public record MasterSkuReferenceResponse(
            UUID id,
            String businessCode,
            String name,
            UUID thumbnailImageId,
            String brandName,
            ReferenceResponse category,
            ReferenceResponse developerMember,
            ReferenceResponse developerAssistantMember,
            ReferenceResponse artMember,
            ReferenceResponse salesMember,
            Long actualWeightGrams,
            Long lengthMm,
            Long widthMm,
            Long heightMm,
            ReferenceResponse packageMaterial,
            Integer packageableCount) { }

    public record SkuResponse(UUID id, UUID spuId,
            MasterSkuReferenceResponse masterSku,
            String creatorName,
            String businessCode, String name, String nameEn, String variantSummary,
            String unitCost, String currencyCode, ReferenceResponse defaultWarehouse,
            Long standardWeightGrams,
            ProductStatus status, Instant createdAt, Instant updatedAt, long version) {
        static SkuResponse from(ProductSku entity) {
            return from(entity, null, null, null);
        }

        static SkuResponse from(
                SkuWithMasterIdentity value) {
            return from(
                    value.sku(),
                    value.master(),
                    value.thumbnail() == null
                            ? null
                            : value.thumbnail().getId(),
                    value.creatorName());
        }

        private static SkuResponse from(
                ProductSku entity,
                ProductSpu master,
                UUID thumbnailImageId,
                String creatorName) {
            MasterSkuReferenceResponse masterSku = master == null
                    ? null
                    : new MasterSkuReferenceResponse(
                            master.getId(),
                            master.getBusinessCode(),
                            master.getName(),
                            thumbnailImageId,
                            master.getBrandName(),
                            reference(
                                    master.getCategoryId(),
                                    master.getCategoryNameSnapshot()),
                            reference(
                                    master.getDeveloperMemberId(),
                                    master.getDeveloperMemberNameSnapshot()),
                            reference(
                                    master.getDeveloperAssistantMemberId(),
                                    master.getDeveloperAssistantMemberNameSnapshot()),
                            reference(
                                    master.getArtMemberId(),
                                    master.getArtMemberNameSnapshot()),
                            reference(
                                    master.getSalesMemberId(),
                                    master.getSalesMemberNameSnapshot()),
                            master.getActualWeightGrams(),
                            master.getLengthMm(),
                            master.getWidthMm(),
                            master.getHeightMm(),
                            reference(
                                    master.getPackageMaterialId(),
                                    master.getPackageMaterialNameSnapshot()),
                            master.getPackageableCount());
            return new SkuResponse(entity.getId(), entity.getSpuId(), masterSku,
                    creatorName,
                    entity.getBusinessCode(), entity.getName(),
                    entity.getNameEn(), entity.getVariantSummary(),
                    entity.getUnitCost() == null ? null : entity.getUnitCost().toPlainString(),
                    entity.getCurrencyCode(), reference(entity.getDefaultWarehouseId(),
                            entity.getDefaultWarehouseNameSnapshot()),
                    entity.getStandardWeightGrams(), entity.getStatus(),
                    entity.getCreatedAt(), entity.getUpdatedAt(), entity.getVersion());
        }
    }
    public record ListingSkuResponse(
            UUID id,
            String businessCode,
            String name) {
        static ListingSkuResponse from(ProductSku entity) {
            return new ListingSkuResponse(
                    entity.getId(),
                    entity.getBusinessCode(),
                    entity.getName());
        }
    }
    public record ListingResponse(UUID id, UUID shopId, UUID platformId, UUID skuId,
            ListingSkuResponse sku, String externalListingRef,
            String externalVariantRef, String externalStatus, String metadataNote, ListingStatus status,
            Instant createdAt, Instant updatedAt, long version) {
        static ListingResponse from(
                ProductListing entity,
                ProductSku sku) {
            return new ListingResponse(entity.getId(), entity.getShopId(), entity.getPlatformId(), entity.getSkuId(),
                    ListingSkuResponse.from(sku),
                    entity.getExternalListingRef(), entity.getExternalVariantRef(), entity.getExternalStatus(),
                    entity.getMetadataNote(), entity.getStatus(), entity.getCreatedAt(), entity.getUpdatedAt(), entity.getVersion());
        }
        static ListingResponse from(ListingWithSku value) {
            return from(value.listing(), value.sku());
        }
    }

    public record SkuListingSummaryResponse(
            UUID skuId,
            long activeListingCount) {
        static SkuListingSummaryResponse from(SkuListingSummary source) {
            return new SkuListingSummaryResponse(
                    source.skuId(),
                    source.activeListingCount());
        }
    }

    public record SkuListingSummariesResponse(
            List<SkuListingSummaryResponse> items) {
        public SkuListingSummariesResponse {
            items = List.copyOf(items);
        }
    }

    public record ShopifyCatalogPreviewResponse(
            ChannelConnectorGateway.ConnectorMode mode,
            ChannelConnectorGateway.ConnectionStatus connectionStatus,
            String cursor,
            boolean hasNextPage,
            Instant fetchedAt,
            List<ShopifyCatalogProductPreviewResponse> products) {
        static ShopifyCatalogPreviewResponse from(
                ProductShopifyCatalogPreviewService.ShopifyCatalogPreview value) {
            return new ShopifyCatalogPreviewResponse(
                    value.mode(),
                    value.connectionStatus(),
                    value.cursor(),
                    value.hasNextPage(),
                    value.fetchedAt(),
                    value.products().stream()
                            .map(ShopifyCatalogProductPreviewResponse::from)
                            .toList());
        }
    }

    public record ShopifyCatalogImportRequest(
            @NotNull UUID shopId,
            @Min(1) @Max(100) Integer limit,
            @Size(max = 4096) String cursor,
            @Size(max = 500) String query,
            @NotNull @Size(min = 1, max = 100)
                    List<@NotBlank @Size(max = 160) String> externalVariantRefs) {
        int limitOrDefault() {
            return limit == null ? 50 : limit;
        }
    }

    public record ShopifyCatalogImportResponse(
            int requestedCount,
            long importedCount,
            long skippedCount,
            List<ShopifyCatalogImportItemResponse> items) {
        static ShopifyCatalogImportResponse from(
                ProductShopifyCatalogImportService.ShopifyCatalogImportResult value) {
            return new ShopifyCatalogImportResponse(
                    value.requestedCount(),
                    value.importedCount(),
                    value.skippedCount(),
                    value.items().stream()
                            .map(ShopifyCatalogImportItemResponse::from)
                            .toList());
        }
    }

    public record ShopifyCatalogImportItemResponse(
            String externalListingRef,
            String externalVariantRef,
            String platformSku,
            UUID skuId,
            UUID listingId,
            ProductShopifyCatalogImportService.ShopifyCatalogImportStatus status,
            String safeSummary) {
        static ShopifyCatalogImportItemResponse from(
                ProductShopifyCatalogImportService.ShopifyCatalogImportItemResult value) {
            return new ShopifyCatalogImportItemResponse(
                    value.externalListingRef(),
                    value.externalVariantRef(),
                    value.platformSku(),
                    value.skuId(),
                    value.listingId(),
                    value.status(),
                    value.safeSummary());
        }
    }

    public record ShopifyCatalogProductPreviewResponse(
            String externalListingRef,
            String title,
            String handle,
            String externalStatus,
            String updatedAt,
            List<ShopifyCatalogVariantPreviewResponse> variants) {
        static ShopifyCatalogProductPreviewResponse from(
                ProductShopifyCatalogPreviewService.ShopifyCatalogProductPreview value) {
            return new ShopifyCatalogProductPreviewResponse(
                    value.externalListingRef(),
                    value.title(),
                    value.handle(),
                    value.externalStatus(),
                    value.updatedAt(),
                    value.variants().stream()
                            .map(ShopifyCatalogVariantPreviewResponse::from)
                            .toList());
        }
    }

    public record ShopifyCatalogVariantPreviewResponse(
            String externalVariantRef,
            String inventoryItemRef,
            String platformSku,
            String title,
            String price,
            String currencyCode,
            boolean availableForSale,
            boolean inventoryTracked,
            ProductShopifyCatalogPreviewService.ShopifyCatalogMatchStatus matchStatus,
            LocalSkuMatchResponse localSku) {
        static ShopifyCatalogVariantPreviewResponse from(
                ProductShopifyCatalogPreviewService.ShopifyCatalogVariantPreview value) {
            return new ShopifyCatalogVariantPreviewResponse(
                    value.externalVariantRef(),
                    value.inventoryItemRef(),
                    value.platformSku(),
                    value.title(),
                    value.price(),
                    value.currencyCode(),
                    value.availableForSale(),
                    value.inventoryTracked(),
                    value.matchStatus(),
                    value.localSku() == null
                            ? null
                            : LocalSkuMatchResponse.from(value.localSku()));
        }
    }

    public record LocalSkuMatchResponse(
            UUID id,
            String businessCode,
            String name,
            ProductStatus status) {
        static LocalSkuMatchResponse from(
                ProductShopifyCatalogPreviewService.LocalSkuMatch value) {
            return new LocalSkuMatchResponse(
                    value.id(),
                    value.businessCode(),
                    value.name(),
                    value.status());
        }
    }

    private static boolean compatibleChineseName(
            String name,
            String nameZh) {
        String legacy = normalized(name);
        String chinese = normalized(nameZh);
        return (legacy != null || chinese != null)
                && (legacy == null
                        || chinese == null
                        || legacy.equals(chinese));
    }

    private static boolean completeDimensions(
            Long length,
            Long width,
            Long height) {
        int present = (length == null ? 0 : 1)
                + (width == null ? 0 : 1)
                + (height == null ? 0 : 1);
        return present == 0 || present == 3;
    }

    private static boolean paired(Object first, Object second) {
        return (first == null) == (second == null);
    }

    private static ReferenceResponse reference(UUID id, String name) {
        return id == null ? null : new ReferenceResponse(id, name);
    }

    private static String normalized(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
