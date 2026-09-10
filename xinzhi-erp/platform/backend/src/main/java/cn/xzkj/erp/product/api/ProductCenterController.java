package cn.xzkj.erp.product.api;

import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.platform.api.PageEnvelope;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.product.api.ProductCenterDtos.ArchiveRequest;
import cn.xzkj.erp.product.api.ProductCenterDtos.BatchSpuArchiveRequest;
import cn.xzkj.erp.product.api.ProductCenterDtos.BatchSpuImportRequest;
import cn.xzkj.erp.product.api.ProductCenterDtos.BatchSpuStatusRequest;
import cn.xzkj.erp.product.api.ProductCenterDtos.BatchSpuUpdateImportRequest;
import cn.xzkj.erp.product.api.ProductCenterDtos.CreateListingRequest;
import cn.xzkj.erp.product.api.ProductCenterDtos.CreateSkuRequest;
import cn.xzkj.erp.product.api.ProductCenterDtos.CreateSpuRequest;
import cn.xzkj.erp.product.api.ProductCenterDtos.ListingResponse;
import cn.xzkj.erp.product.api.ProductCenterDtos.SkuResponse;
import cn.xzkj.erp.product.api.ProductCenterDtos.SkuListingSummariesResponse;
import cn.xzkj.erp.product.api.ProductCenterDtos.SkuListingSummaryResponse;
import cn.xzkj.erp.product.api.ProductCenterDtos.ShopifyCatalogImportRequest;
import cn.xzkj.erp.product.api.ProductCenterDtos.ShopifyCatalogImportResponse;
import cn.xzkj.erp.product.api.ProductCenterDtos.ShopifyCatalogPreviewResponse;
import cn.xzkj.erp.product.api.ProductCenterDtos.ReassignSkuRequest;
import cn.xzkj.erp.product.api.ProductCenterDtos.SpuResponse;
import cn.xzkj.erp.product.api.ProductCenterDtos.UpdateListingRequest;
import cn.xzkj.erp.product.api.ProductCenterDtos.UpdateSkuRequest;
import cn.xzkj.erp.product.api.ProductCenterDtos.UpdateSkuWeightRequest;
import cn.xzkj.erp.product.api.ProductCenterDtos.UpdateSpuRequest;
import cn.xzkj.erp.product.domain.ListingStatus;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.product.service.ProductCenterService;
import cn.xzkj.erp.product.service.ProductImageService;
import cn.xzkj.erp.product.service.ProductCenterService.ListingSearchField;
import cn.xzkj.erp.product.service.ProductCenterService.SpuWithSummary;
import cn.xzkj.erp.product.service.ProductActor;
import cn.xzkj.erp.product.service.ProductShopifyCatalogImportService;
import cn.xzkj.erp.product.service.ProductShopifyCatalogPreviewService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/product-center")
public class ProductCenterController {
    private static final int MAX_PAGE_SIZE = 200;
    private static final Pattern REQUEST_ID =
            Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");
    private final ProductCenterService service;
    private final ProductImageService imageService;
    private final ProductShopifyCatalogImportService shopifyCatalogImportService;
    private final ProductShopifyCatalogPreviewService shopifyCatalogPreviewService;
    public ProductCenterController(
            ProductCenterService service,
            ProductImageService imageService,
            ProductShopifyCatalogImportService shopifyCatalogImportService,
            ProductShopifyCatalogPreviewService shopifyCatalogPreviewService) {
        this.service = service;
        this.imageService = imageService;
        this.shopifyCatalogImportService = shopifyCatalogImportService;
        this.shopifyCatalogPreviewService = shopifyCatalogPreviewService;
    }

    @PostMapping("/spus")
    @PreAuthorize("hasAuthority('products.write')")
    public ResponseEntity<SpuResponse> createSpu(@AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody CreateSpuRequest request, HttpServletRequest httpRequest) {
        SpuResponse response = mapSpu(service.createSpuWithInitialSkus(actor(principal, httpRequest),
                request.businessCode(), request.values(),
                request.sensitiveAttributeCodes(), (request.initialSkus() == null
                        ? java.util.List.<ProductCenterDtos.InitialSkuRequest>of()
                        : request.initialSkus()).stream()
                        .map(sku -> new ProductCenterService.InitialSkuValues(
                                sku.businessCode(), sku.name(), sku.nameEn(),
                                sku.variantSummary(), sku.unitCost(),
                                sku.currencyCode(), sku.defaultWarehouseId()))
                        .toList()));
        return ResponseEntity.created(URI.create("/api/v1/product-center/spus/" + response.id())).body(response);
    }
    @PostMapping(value = "/spus/with-images", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAuthority('products.write')")
    @Transactional
    public ResponseEntity<SpuResponse> createSpuWithImages(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestPart("request") CreateSpuRequest request,
            @RequestPart(value = "images", required = false) java.util.List<MultipartFile> images,
            HttpServletRequest httpRequest) throws java.io.IOException {
        if (images == null || images.isEmpty()) {
            throw new IllegalArgumentException("At least one product image is required");
        }
        if (images.size() > 10) {
            throw new IllegalArgumentException("A product can have at most 10 images");
        }
        ProductActor actor = actor(principal, httpRequest);
        SpuResponse response = mapSpu(service.createSpuWithInitialSkus(actor,
                request.businessCode(), request.values(),
                request.sensitiveAttributeCodes(), (request.initialSkus() == null
                        ? java.util.List.<ProductCenterDtos.InitialSkuRequest>of()
                        : request.initialSkus()).stream()
                        .map(sku -> new ProductCenterService.InitialSkuValues(
                                sku.businessCode(), sku.name(), sku.nameEn(),
                                sku.variantSummary(), sku.unitCost(),
                                sku.currencyCode(), sku.defaultWarehouseId()))
                        .toList()));
        for (int index = 0; index < images.size(); index += 1) {
            MultipartFile image = images.get(index);
            if (image == null || image.isEmpty()) {
                throw new IllegalArgumentException("Image file is required");
            }
            imageService.upload(actor, response.id(), image.getInputStream(),
                    image.getOriginalFilename(), image.getContentType(), index, index == 0);
        }
        return ResponseEntity.created(URI.create("/api/v1/product-center/spus/" + response.id())).body(response);
    }
    @GetMapping("/spus")
    @PreAuthorize("hasAuthority('products.read')")
    public PageEnvelope<SpuResponse> listSpus(@AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @RequestParam(required = false) ProductStatus status, @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(defaultValue = "ALL") String searchField,
            @RequestParam(required = false) UUID categoryId,
            @RequestParam(required = false) UUID developerMemberId,
            @RequestParam(required = false) UUID creatorId,
            @RequestParam(required = false) Instant createdFrom,
            @RequestParam(required = false) Instant createdTo,
            @RequestParam(defaultValue = "BUSINESS_CODE") String sortBy,
            @RequestParam(defaultValue = "false") boolean descending,
            @RequestParam(defaultValue = "0") @Min(0) int page, @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE) int size) {
        return PageEnvelope.from(service.listSpus(tenantId, status, keyword, searchField,
                categoryId, developerMemberId, creatorId, createdFrom, createdTo,
                sortBy, descending,
                pageable(page, size)), ProductCenterController::mapSpu);
    }
    @GetMapping("/spus/{spuId}")
    @PreAuthorize("hasAuthority('products.read')")
    public SpuResponse getSpu(@AuthenticationPrincipal(expression = "tenantId") UUID tenantId, @PathVariable UUID spuId) {
        return mapSpu(service.getSpu(tenantId, spuId));
    }
    @PutMapping("/spus/{spuId}")
    @PreAuthorize("hasAuthority('products.write')")
    public SpuResponse updateSpu(@AuthenticationPrincipal ErpPrincipal principal, @PathVariable UUID spuId,
            @Valid @RequestBody UpdateSpuRequest request, HttpServletRequest httpRequest) {
        return mapSpu(service.updateSpu(actor(principal, httpRequest), spuId,
                request.version(), request.values(), request.status(),
                request.sensitiveAttributeCodes()));
    }

    @PutMapping("/skus/{skuId}/standard-weight")
    @PreAuthorize("hasAuthority('products.weight.write')")
    public SkuResponse updateSkuStandardWeight(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID skuId,
            @Valid @RequestBody UpdateSkuWeightRequest request,
            HttpServletRequest httpRequest) {
        return SkuResponse.from(service.updateSkuStandardWeight(
                actor(principal, httpRequest), skuId, request.version(),
                request.standardWeightGrams()));
    }
    @PutMapping(value = "/spus/{spuId}/with-images", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAuthority('products.write')")
    @Transactional
    public SpuResponse updateSpuWithImages(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID spuId,
            @Valid @RequestPart("request") UpdateSpuRequest request,
            @RequestPart(value = "images", required = false) java.util.List<MultipartFile> images,
            HttpServletRequest httpRequest) throws java.io.IOException {
        if (images != null && images.size() > 10) {
            throw new IllegalArgumentException("A product can have at most 10 images");
        }
        ProductActor actor = actor(principal, httpRequest);
        SpuResponse response = mapSpu(service.updateSpu(actor, spuId,
                request.version(), request.values(), request.status(),
                request.sensitiveAttributeCodes()));
        if (images != null) {
            for (int index = 0; index < images.size(); index += 1) {
                MultipartFile image = images.get(index);
                if (image == null || image.isEmpty()) {
                    throw new IllegalArgumentException("Image file is required");
                }
                imageService.upload(actor, spuId, image.getInputStream(),
                        image.getOriginalFilename(), image.getContentType(), index, false);
            }
        }
        return response;
    }
    @PostMapping("/spus/{spuId}/archive")
    @PreAuthorize("hasAuthority('products.write')")
    public SpuResponse archiveSpu(@AuthenticationPrincipal ErpPrincipal principal, @PathVariable UUID spuId,
            @Valid @RequestBody ArchiveRequest request, HttpServletRequest httpRequest) {
        return mapSpu(service.archiveSpuDetails(
                actor(principal, httpRequest),
                spuId,
                request.version()));
    }
    @PutMapping("/spus/batch/status")
    @PreAuthorize("hasAuthority('products.write')")
    public java.util.List<SpuResponse> updateSpuBatchStatus(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody BatchSpuStatusRequest request,
            HttpServletRequest httpRequest) {
        return service.updateSpuBatchStatus(actor(principal, httpRequest),
                request.items().stream().map(item -> new ProductCenterService.VersionedResource(
                        item.id(), item.version())).toList(), request.status())
                .stream().map(ProductCenterController::mapSpu).toList();
    }
    @PostMapping("/spus/batch/archive")
    @PreAuthorize("hasAuthority('products.write')")
    public java.util.List<SpuResponse> archiveSpuBatch(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody BatchSpuArchiveRequest request,
            HttpServletRequest httpRequest) {
        return service.archiveSpuBatch(actor(principal, httpRequest),
                request.items().stream().map(item -> new ProductCenterService.VersionedResource(
                        item.id(), item.version())).toList())
                .stream().map(ProductCenterController::mapSpu).toList();
    }
    @PostMapping("/spus/import")
    @PreAuthorize("hasAuthority('products.write')")
    public java.util.List<SpuResponse> importSpus(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody BatchSpuImportRequest request,
            HttpServletRequest httpRequest) {
        ProductActor actor = actor(principal, httpRequest);
        return service.importSpus(actor, request.items().stream()
                .map(item -> new ProductCenterService.ImportedSpuValues(
                        item.businessCode(), item.values(), item.sensitiveAttributeCodes(),
                        item.initialSkus() == null ? java.util.List.of() : item.initialSkus().stream()
                                .map(sku -> new ProductCenterService.InitialSkuValues(
                                        sku.businessCode(), sku.name(), sku.nameEn(),
                                        sku.variantSummary(), sku.unitCost(),
                                        sku.currencyCode(), sku.defaultWarehouseId()))
                                .toList()))
                .toList()).stream().map(ProductCenterController::mapSpu).toList();
    }
    @PutMapping("/spus/import")
    @PreAuthorize("hasAuthority('products.write')")
    public java.util.List<SpuResponse> importSpuUpdates(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody BatchSpuUpdateImportRequest request,
            HttpServletRequest httpRequest) {
        ProductActor actor = actor(principal, httpRequest);
        return service.importSpuUpdates(actor, request.items().stream()
                .map(item -> new ProductCenterService.ImportedSpuUpdateValues(item.id(),
                        item.values().version(), item.values().values(), item.values().status(),
                        item.values().sensitiveAttributeCodes()))
                .toList()).stream().map(ProductCenterController::mapSpu).toList();
    }

    @PostMapping("/spus/{spuId}/skus")
    @PreAuthorize("hasAuthority('products.write')")
    public ResponseEntity<SkuResponse> createSku(@AuthenticationPrincipal ErpPrincipal principal, @PathVariable UUID spuId,
            @Valid @RequestBody CreateSkuRequest request, HttpServletRequest httpRequest) {
        SkuResponse response = SkuResponse.from(service.createSkuWithValues(actor(principal, httpRequest), spuId,
                request.businessCode(), request.values()));
        return ResponseEntity.created(URI.create("/api/v1/product-center/skus/" + response.id())).body(response);
    }
    @GetMapping("/skus")
    @PreAuthorize("""
            hasAuthority('products.read')
            and ((#searchField != 'DEFAULT_SUPPLIER'
                  and #searchField != 'ORIGINAL_SKU')
                 or hasAuthority('suppliers.read'))
            """)
    public PageEnvelope<SkuResponse> listSkus(@AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @RequestParam(required = false) UUID spuId, @RequestParam(required = false) ProductStatus status,
            @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(required = false) UUID categoryId,
            @RequestParam(required = false) UUID developerMemberId,
            @RequestParam(required = false) UUID developerAssistantMemberId,
            @RequestParam(required = false) UUID salesMemberId,
            @RequestParam(required = false) UUID artMemberId,
            @RequestParam(required = false) UUID creatorId,
            @RequestParam(required = false) Instant createdFrom,
            @RequestParam(required = false) Instant createdTo,
            @RequestParam(defaultValue = "ALL") String searchField,
            @RequestParam(defaultValue = "CONTAINS") String matchMode,
            @RequestParam(defaultValue = "BUSINESS_CODE") String sortBy,
            @RequestParam(defaultValue = "false") boolean descending,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE) int size) {
        return PageEnvelope.from(service.listSkusWithMasterIdentity(
                tenantId, spuId, status, keyword, categoryId,
                developerMemberId, developerAssistantMemberId,
                salesMemberId, artMemberId, creatorId,
                createdFrom, createdTo,
                searchField, matchMode,
                sortBy, descending,
                pageable(page, size)), SkuResponse::from);
    }
    @GetMapping("/skus/{skuId}")
    @PreAuthorize("hasAuthority('products.read')")
    public SkuResponse getSku(@AuthenticationPrincipal(expression = "tenantId") UUID tenantId, @PathVariable UUID skuId) {
        return SkuResponse.from(service.getSku(tenantId, skuId));
    }
    @PutMapping("/skus/{skuId}")
    @PreAuthorize("hasAuthority('products.write')")
    public SkuResponse updateSku(@AuthenticationPrincipal ErpPrincipal principal, @PathVariable UUID skuId,
            @Valid @RequestBody UpdateSkuRequest request, HttpServletRequest httpRequest) {
        return SkuResponse.from(service.updateSkuWithValues(actor(principal, httpRequest), skuId,
                request.version(), new ProductCenterService.SkuValues(
                        request.name(), request.nameEn(), request.variantSummary(),
                        request.unitCost(), request.currencyCode(),
                        request.defaultWarehouseId()), request.status()));
    }
    @PutMapping("/skus/{skuId}/parent")
    @PreAuthorize("hasAuthority('products.write')")
    public SkuResponse reassignSku(@AuthenticationPrincipal ErpPrincipal principal, @PathVariable UUID skuId,
            @Valid @RequestBody ReassignSkuRequest request, HttpServletRequest httpRequest) {
        return SkuResponse.from(service.reassignSku(actor(principal, httpRequest), skuId,
                request.spuId(), request.version()));
    }
    @PostMapping("/skus/{skuId}/archive")
    @PreAuthorize("hasAuthority('products.write')")
    public SkuResponse archiveSku(@AuthenticationPrincipal ErpPrincipal principal, @PathVariable UUID skuId,
            @Valid @RequestBody ArchiveRequest request, HttpServletRequest httpRequest) {
        return SkuResponse.from(service.archiveSku(actor(principal, httpRequest), skuId,
                request.version()));
    }

    @PostMapping("/listings")
    @PreAuthorize("hasAuthority('products.listing.write')")
    public ResponseEntity<ListingResponse> createListing(@AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody CreateListingRequest request, HttpServletRequest httpRequest) {
        var listing = service.createListing(actor(principal, httpRequest),
                request.shopId(), request.skuId(),
                request.externalListingRef(), request.externalVariantRef(), request.externalStatus(), request.metadataNote());
        ListingResponse response = ListingResponse.from(
                listing,
                service.getSku(principal.tenantId(), listing.getSkuId()));
        return ResponseEntity.created(URI.create("/api/v1/product-center/listings/" + response.id())).body(response);
    }
    @GetMapping("/listings")
    @PreAuthorize("hasAuthority('products.listing.read')")
    public PageEnvelope<ListingResponse> listListings(@AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @RequestParam(required = false) UUID shopId, @RequestParam(required = false) UUID skuId,
            @RequestParam(required = false) ListingStatus status, @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(defaultValue = "ALL") ListingSearchField searchField,
            @RequestParam(defaultValue = "0") @Min(0) int page, @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE) int size) {
        return PageEnvelope.from(
                service.listListingsWithSku(
                        tenantId,
                        shopId,
                        skuId,
                        status,
                        keyword,
                        searchField,
                        pageable(page, size)),
                ListingResponse::from);
    }
    @GetMapping("/listings/shopify/catalog-preview")
    @PreAuthorize("hasAuthority('products.listing.read')")
    public ShopifyCatalogPreviewResponse previewShopifyCatalog(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @RequestParam UUID shopId,
            @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit,
            @RequestParam(required = false) @Size(max = 4096) String cursor,
            @RequestParam(required = false) @Size(max = 500) String query) {
        return ShopifyCatalogPreviewResponse.from(
                shopifyCatalogPreviewService.preview(
                        tenantId,
                        shopId,
                        limit,
                        cursor,
                        query));
    }
    @PostMapping("/listings/shopify/catalog-import")
    @PreAuthorize("hasAuthority('products.listing.write')")
    public ShopifyCatalogImportResponse importShopifyCatalogListings(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ShopifyCatalogImportRequest request,
            HttpServletRequest httpRequest) {
        return ShopifyCatalogImportResponse.from(
                shopifyCatalogImportService.importSelectedListings(
                        actor(principal, httpRequest),
                        request.shopId(),
                        request.limitOrDefault(),
                        request.cursor(),
                        request.query(),
                        request.externalVariantRefs()));
    }
    @GetMapping("/skus/listing-summaries")
    @PreAuthorize("hasAuthority('products.listing.read')")
    public SkuListingSummariesResponse listSkuListingSummaries(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @RequestParam(name = "skuId")
            @Size(min = 1, max = 50)
            List<@NotNull UUID> skuIds) {
        return new SkuListingSummariesResponse(
                service.listSkuListingSummaries(tenantId, skuIds).stream()
                        .map(SkuListingSummaryResponse::from)
                        .toList());
    }
    @GetMapping("/listings/{listingId}")
    @PreAuthorize("hasAuthority('products.listing.read')")
    public ListingResponse getListing(@AuthenticationPrincipal(expression = "tenantId") UUID tenantId, @PathVariable UUID listingId) {
        var listing = service.getListing(tenantId, listingId);
        return ListingResponse.from(
                listing,
                service.getSku(tenantId, listing.getSkuId()));
    }
    @PutMapping("/listings/{listingId}")
    @PreAuthorize("hasAuthority('products.listing.write')")
    public ListingResponse updateListing(@AuthenticationPrincipal ErpPrincipal principal, @PathVariable UUID listingId,
            @Valid @RequestBody UpdateListingRequest request, HttpServletRequest httpRequest) {
        var listing = service.updateListing(actor(principal, httpRequest), listingId,
                request.version(), request.externalStatus(), request.metadataNote(), request.status());
        return ListingResponse.from(
                listing,
                service.getSku(principal.tenantId(), listing.getSkuId()));
    }
    @PostMapping("/listings/{listingId}/archive")
    @PreAuthorize("hasAuthority('products.listing.write')")
    public ListingResponse archiveListing(@AuthenticationPrincipal ErpPrincipal principal, @PathVariable UUID listingId,
            @Valid @RequestBody ArchiveRequest request, HttpServletRequest httpRequest) {
        var listing = service.archiveListing(actor(principal, httpRequest), listingId,
                request.version());
        return ListingResponse.from(
                listing,
                service.getSku(principal.tenantId(), listing.getSkuId()));
    }

    private static SpuResponse mapSpu(SpuWithSummary value) {
        return SpuResponse.from(
                value.spu(),
                value.skuSummary(),
                value.sensitiveAttributeCodes(),
                value.masterMetrics());
    }
    private static ProductActor actor(
            ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId != null) {
            requestId = requestId.strip();
            if (!REQUEST_ID.matcher(requestId).matches()) {
                requestId = null;
            }
        }
        return new ProductActor(
                principal.tenantId(),
                principal.userId(),
                principal.systemAdminId(),
                requestId,
                request.getRemoteAddr());
    }

    private static Pageable pageable(int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new ConstraintViolationException(Set.of());
        }
        return PageRequest.of(page, size);
    }
}
