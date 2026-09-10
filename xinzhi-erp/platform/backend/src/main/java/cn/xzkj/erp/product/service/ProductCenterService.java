package cn.xzkj.erp.product.service;

import static cn.xzkj.erp.product.domain.ProductAuditActions.LISTING_ARCHIVED;
import static cn.xzkj.erp.product.domain.ProductAuditActions.LISTING_CREATED;
import static cn.xzkj.erp.product.domain.ProductAuditActions.LISTING_UPDATED;
import static cn.xzkj.erp.product.domain.ProductAuditActions.SKU_ARCHIVED;
import static cn.xzkj.erp.product.domain.ProductAuditActions.SKU_CREATED;
import static cn.xzkj.erp.product.domain.ProductAuditActions.SKU_UPDATED;
import static cn.xzkj.erp.product.domain.ProductAuditActions.SKU_WEIGHT_UPDATED;
import static cn.xzkj.erp.product.domain.ProductAuditActions.SPU_ARCHIVED;
import static cn.xzkj.erp.product.domain.ProductAuditActions.SPU_CREATED;
import static cn.xzkj.erp.product.domain.ProductAuditActions.SPU_UPDATED;

import java.util.ArrayList;
import java.util.Collection;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.math.BigDecimal;
import java.math.RoundingMode;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.platform.domain.PlatformCatalogEntry;
import cn.xzkj.erp.platform.domain.PlatformStatus;
import cn.xzkj.erp.platform.domain.SensitiveTextRedactor;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.domain.TenantShop;
import cn.xzkj.erp.platform.repository.PlatformCatalogRepository;
import cn.xzkj.erp.platform.repository.TenantShopRepository;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.product.domain.ListingStatus;
import cn.xzkj.erp.product.domain.ProductListing;
import cn.xzkj.erp.product.domain.ProductCategory;
import cn.xzkj.erp.product.domain.ProductMasterDataStatus;
import cn.xzkj.erp.product.domain.ProductPackageMaterial;
import cn.xzkj.erp.product.domain.ProductSensitiveAttributeCode;
import cn.xzkj.erp.product.domain.ProductSku;
import cn.xzkj.erp.product.domain.ProductSpu;
import cn.xzkj.erp.product.domain.ProductSpuImage;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.product.repository.ProductListingRepository;
import cn.xzkj.erp.product.repository.ProductCategoryRepository;
import cn.xzkj.erp.product.repository.ProductPackageMaterialRepository;
import cn.xzkj.erp.product.repository.ProductSkuRepository;
import cn.xzkj.erp.product.repository.ProductSpuRepository;
import cn.xzkj.erp.product.repository.ProductSpuImageRepository;
import cn.xzkj.erp.product.repository.ProductSpuSensitiveAttributeRepository;
import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.domain.AccountStatus;
import cn.xzkj.erp.iam.persistence.UserAccountEntity;
import cn.xzkj.erp.iam.persistence.UserAccountRepository;
import cn.xzkj.erp.inventory.service.InventoryArchiveGuard;
import cn.xzkj.erp.warehouse.domain.Warehouse;
import cn.xzkj.erp.warehouse.domain.WarehouseStatus;
import cn.xzkj.erp.warehouse.repository.WarehouseRepository;

@Service
public class ProductCenterService {

    private static final String SUPPORTED_LISTING_PLATFORM_CODE = "SHOPIFY";

    private final ProductSpuRepository spuRepository;
    private final ProductSpuImageRepository spuImageRepository;
    private final ProductSpuSensitiveAttributeRepository
            spuSensitiveAttributeRepository;
    private final ProductSkuRepository skuRepository;
    private final ProductListingRepository listingRepository;
    private final ProductCategoryRepository categoryRepository;
    private final ProductPackageMaterialRepository packageRepository;
    private final UserAccountRepository userRepository;
    private final TenantShopRepository shopRepository;
    private final PlatformCatalogRepository platformRepository;
    private final SecurityAuditRecorder auditRecorder;
    private final InventoryArchiveGuard inventoryArchiveGuard;
    private final WarehouseRepository warehouseRepository;

    public ProductCenterService(
            ProductSpuRepository spuRepository,
            ProductSpuImageRepository spuImageRepository,
            ProductSpuSensitiveAttributeRepository
                    spuSensitiveAttributeRepository,
            ProductSkuRepository skuRepository,
            ProductListingRepository listingRepository,
            ProductCategoryRepository categoryRepository,
            ProductPackageMaterialRepository packageRepository,
            UserAccountRepository userRepository,
            TenantShopRepository shopRepository,
            PlatformCatalogRepository platformRepository,
            SecurityAuditRecorder auditRecorder,
            InventoryArchiveGuard inventoryArchiveGuard,
            WarehouseRepository warehouseRepository) {
        this.spuRepository = spuRepository;
        this.spuImageRepository = spuImageRepository;
        this.spuSensitiveAttributeRepository =
                spuSensitiveAttributeRepository;
        this.skuRepository = skuRepository;
        this.listingRepository = listingRepository;
        this.categoryRepository = categoryRepository;
        this.packageRepository = packageRepository;
        this.userRepository = userRepository;
        this.shopRepository = shopRepository;
        this.platformRepository = platformRepository;
        this.auditRecorder = auditRecorder;
        this.inventoryArchiveGuard = inventoryArchiveGuard;
        this.warehouseRepository = warehouseRepository;
    }

    @Transactional
    public SpuWithSummary createSpu(
            ProductActor actor,
            String businessCode,
            SpuValues values,
            Collection<ProductSensitiveAttributeCode>
                    sensitiveAttributeCodes) {
        return createSpuWithInitialSkus(actor, businessCode, values,
                sensitiveAttributeCodes, List.of());
    }

    @Transactional
    public SpuWithSummary createSpuWithInitialSkus(
            ProductActor actor,
            String businessCode,
            SpuValues values,
            Collection<ProductSensitiveAttributeCode>
                    sensitiveAttributeCodes,
            Collection<InitialSkuValues> initialSkus) {
        UUID tenantId = requireActor(actor);
        String code = normalizeCode(businessCode);
        if (spuRepository.existsByTenantIdAndBusinessCode(tenantId, code)) {
            throw new ProductSpuBusinessCodeConflictException();
        }
        SpuValues normalized = normalizeSpuValues(values, null);
        ResolvedReferences references = resolveReferences(
                tenantId,
                null,
                normalized);
        List<ProductSensitiveAttributeCode> attributes =
                ProductSensitiveAttributeCode.stableDistinct(
                        sensitiveAttributeCodes);
        ProductSpu saved = spuRepository.save(new ProductSpu(
                tenantId,
                code,
                normalizedName(normalized),
                normalized.nameEn(),
                normalized.brandName(),
                normalized.productNote(),
                references.category().id(),
                references.category().name(),
                normalized.lengthMm(),
                normalized.widthMm(),
                normalized.heightMm(),
                normalized.volumetricDivisor(),
                normalized.actualWeightGrams(),
                references.packageMaterial().id(),
                references.packageMaterial().name(),
                normalized.packageableCount(),
                references.artMember().id(),
                references.artMember().name(),
                references.developerMember().id(),
                references.developerMember().name(),
                references.developerAssistantMember().id(),
                references.developerAssistantMember().name(),
                references.salesMember().id(),
                references.salesMember().name()));
        spuRepository.flush();
        spuSensitiveAttributeRepository.replaceByTenantIdAndSpuId(
                tenantId,
                saved.getId(),
                attributes);
        audit(actor, SPU_CREATED, "product_spu", saved.getId(),
                saved.getVersion(), Map.of(
                        "status", saved.getStatus().name(),
                        "changedFields", summarizeAuditFields(
                                createSpuFieldKeys(saved, attributes))));
        List<InitialSkuValues> children = initialSkus == null
                ? List.of()
                : List.copyOf(initialSkus);
        Set<String> childCodes = new HashSet<>();
        for (InitialSkuValues child : children) {
            if (child == null || !childCodes.add(normalizeCode(child.businessCode()))) {
                throw new IllegalArgumentException("Initial SKU business codes must be distinct");
            }
            createSkuWithValues(actor, saved.getId(), child.businessCode(), child.values());
        }
        return new SpuWithSummary(saved,
                summariesFor(tenantId, List.of(saved.getId()))
                        .getOrDefault(saved.getId(), SkuSummary.EMPTY),
                attributes);
    }

    @Transactional(readOnly = true)
    public Page<SpuWithSummary> listSpus(UUID tenantId, ProductStatus status, String keyword, Pageable pageable) {
        return listSpus(tenantId, status, keyword, "ALL", null, null,
                null, null, null, "BUSINESS_CODE", false, pageable);
    }

    @Transactional(readOnly = true)
    public Page<SpuWithSummary> listSpus(
            UUID tenantId,
            ProductStatus status,
            String keyword,
            String searchField,
            UUID categoryId,
            UUID developerMemberId,
            UUID creatorId,
            Instant createdFrom,
            Instant createdTo,
            String sortBy,
            boolean descending,
            Pageable pageable) {
        requireTenant(tenantId);
        String normalizedKeyword = normalizedKeyword(keyword);
        String field = switch (searchField == null ? "ALL" : searchField) {
            case "ALL", "MASTER_CODE", "NAME_ZH", "NAME_EN", "INVENTORY_SKU" -> searchField == null ? "ALL" : searchField;
            default -> throw new IllegalArgumentException("Invalid master SKU search field");
        };
        if (createdFrom != null && createdTo != null && !createdFrom.isBefore(createdTo)) {
            throw new IllegalArgumentException("Created time range is invalid");
        }
        String safeSort = switch (sortBy == null ? "BUSINESS_CODE" : sortBy) {
            case "BUSINESS_CODE", "CATEGORY", "SALES_42",
                    "FORECAST_DAILY_SALES", "CREATED_AT" ->
                    sortBy == null ? "BUSINESS_CODE" : sortBy;
            default -> throw new IllegalArgumentException("Invalid master SKU sort field");
        };
        Page<ProductSpu> spus = spuRepository.searchMasterByTenantId(
                tenantId, status == null ? null : status.name(), ProductStatus.ARCHIVED.name(),
                normalizedKeyword != null,
                normalizedKeyword == null ? "" : normalizedKeyword, field,
                categoryId, developerMemberId, creatorId, createdFrom, createdTo,
                safeSort, descending, pageable);
        return withSummaries(tenantId, spus, pageable);
    }

    @Transactional(readOnly = true)
    public SpuWithSummary getSpu(UUID tenantId, UUID spuId) {
        ProductSpu spu = findSpu(tenantId, spuId);
        return new SpuWithSummary(
                spu,
                summariesFor(tenantId, List.of(spuId))
                        .getOrDefault(spuId, SkuSummary.EMPTY),
                spuSensitiveAttributeRepository
                        .findByTenantIdAndSpuId(tenantId, spuId));
    }

    @Transactional
    public SpuWithSummary updateSpu(
            ProductActor actor,
            UUID spuId,
            long expectedVersion,
            SpuValues values,
            ProductStatus status,
            Collection<ProductSensitiveAttributeCode>
                    sensitiveAttributeCodes) {
        UUID tenantId = requireActor(actor);
        ProductSpu spu = findSpuForUpdate(tenantId, spuId);
        requireVersion(spu.getVersion(), expectedVersion);
        if (status == ProductStatus.ARCHIVED) {
            throw new IllegalArgumentException("Use archive for an SPU");
        }
        if (spu.getStatus() == ProductStatus.ARCHIVED) {
            throw new ConflictException("Archived SPUs cannot be changed");
        }
        SpuValues normalized = normalizeSpuValues(values, spu);
        ResolvedReferences references = resolveReferences(
                tenantId,
                spu,
                normalized);
        List<ProductSensitiveAttributeCode> existingAttributes =
                spuSensitiveAttributeRepository.findByTenantIdAndSpuId(
                        tenantId,
                        spuId);
        List<ProductSensitiveAttributeCode> attributes =
                sensitiveAttributeCodes == null
                        ? existingAttributes
                        : ProductSensitiveAttributeCode.stableDistinct(
                                sensitiveAttributeCodes);
        List<String> changedFields = changedSpuFieldKeys(
                spu,
                normalized,
                references,
                status,
                existingAttributes,
                attributes);
        boolean attributesChanged = !existingAttributes.equals(attributes);
        spu.update(
                normalizedName(normalized),
                normalized.nameEn(),
                normalized.brandName(),
                normalized.productNote(),
                status,
                references.category().id(),
                references.category().name(),
                normalized.lengthMm(),
                normalized.widthMm(),
                normalized.heightMm(),
                normalized.actualWeightGrams(),
                normalized.volumetricDivisor(),
                references.packageMaterial().id(),
                references.packageMaterial().name(),
                normalized.packageableCount(),
                references.artMember().id(),
                references.artMember().name(),
                references.developerMember().id(),
                references.developerMember().name(),
                references.developerAssistantMember().id(),
                references.developerAssistantMember().name(),
                references.salesMember().id(),
                references.salesMember().name());
        if (attributesChanged) {
            spu.markSensitiveAttributesChanged();
        }
        ProductSpu saved = spuRepository.save(spu);
        spuRepository.flush();
        if (attributesChanged) {
            spuSensitiveAttributeRepository.replaceByTenantIdAndSpuId(
                    tenantId,
                    spuId,
                    attributes);
        }
        audit(actor, SPU_UPDATED, "product_spu", saved.getId(),
                saved.getVersion(), Map.of(
                        "status", saved.getStatus().name(),
                        "changedFields", summarizeAuditFields(changedFields)));
        return new SpuWithSummary(saved, SkuSummary.EMPTY, attributes);
    }

    @Transactional
    public ProductSpu archiveSpu(ProductActor actor, UUID spuId, long expectedVersion) {
        return archiveSpuDetails(actor, spuId, expectedVersion).spu();
    }

    @Transactional
    public SpuWithSummary archiveSpuDetails(
            ProductActor actor,
            UUID spuId,
            long expectedVersion) {
        UUID tenantId = requireActor(actor);
        ProductSpu spu = findSpu(tenantId, spuId);
        requireVersion(spu.getVersion(), expectedVersion);
        if (spu.getStatus() == ProductStatus.ARCHIVED) {
            return new SpuWithSummary(
                    spu,
                    SkuSummary.EMPTY,
                    spuSensitiveAttributeRepository
                            .findByTenantIdAndSpuId(tenantId, spuId));
        }
        if (skuRepository.existsByTenantIdAndSpuIdAndStatusNot(tenantId, spuId, ProductStatus.ARCHIVED)) {
            throw new ConflictException("Archive child SKUs before archiving the SPU");
        }
        spu.archive();
        ProductSpu saved = spuRepository.save(spu);
        audit(actor, SPU_ARCHIVED, "product_spu", saved.getId(),
                expectedVersion + 1, Map.of(
                        "status", saved.getStatus().name(),
                        "changedFields", "status"));
        return new SpuWithSummary(
                saved,
                SkuSummary.EMPTY,
                spuSensitiveAttributeRepository
                        .findByTenantIdAndSpuId(tenantId, spuId));
    }

    @Transactional
    public List<SpuWithSummary> updateSpuBatchStatus(
            ProductActor actor,
            Collection<VersionedResource> items,
            ProductStatus status) {
        if (status == null || status == ProductStatus.ARCHIVED) {
            throw new IllegalArgumentException("Use batch archive for archived SPUs");
        }
        UUID tenantId = requireActor(actor);
        List<VersionedResource> resources = normalizedBatch(items);
        List<SpuWithSummary> result = new ArrayList<>();
        for (VersionedResource item : resources) {
            ProductSpu spu = findSpuForUpdate(tenantId, item.id());
            requireVersion(spu.getVersion(), item.version());
            if (spu.getStatus() == ProductStatus.ARCHIVED) {
                throw new ConflictException("Archived SPUs cannot be changed");
            }
            spu.changeStatus(status);
            ProductSpu saved = spuRepository.save(spu);
            audit(actor, SPU_UPDATED, "product_spu", saved.getId(), saved.getVersion(),
                    Map.of("status", saved.getStatus().name(), "changedFields", "status"));
            result.add(new SpuWithSummary(saved, SkuSummary.EMPTY,
                    spuSensitiveAttributeRepository.findByTenantIdAndSpuId(tenantId, saved.getId())));
        }
        return result;
    }

    @Transactional
    public List<SpuWithSummary> archiveSpuBatch(
            ProductActor actor,
            Collection<VersionedResource> items) {
        List<VersionedResource> resources = normalizedBatch(items);
        List<SpuWithSummary> result = new ArrayList<>();
        for (VersionedResource item : resources) {
            result.add(archiveSpuDetails(actor, item.id(), item.version()));
        }
        return result;
    }

    @Transactional
    public List<SpuWithSummary> importSpus(
            ProductActor actor,
            Collection<ImportedSpuValues> items) {
        List<ImportedSpuValues> bounded = boundedImport(items);
        return bounded.stream().map(item -> createSpuWithInitialSkus(actor, item.businessCode(),
                item.values(), item.sensitiveAttributeCodes(), item.initialSkus())).toList();
    }

    @Transactional
    public List<SpuWithSummary> importSpuUpdates(
            ProductActor actor,
            Collection<ImportedSpuUpdateValues> items) {
        List<ImportedSpuUpdateValues> bounded = boundedUpdateImport(items);
        UUID tenantId = requireActor(actor);
        return bounded.stream().map(item -> {
            ProductSpu existing = findSpu(tenantId, item.id());
            return updateSpu(actor, item.id(), item.version(),
                    mergeImportedValues(existing, item.values()), item.status(),
                    item.sensitiveAttributeCodes());
        }).toList();
    }

    @Transactional
    public ProductSku createSku(ProductActor actor, UUID spuId, String businessCode, String name, String variantSummary) {
        return createSkuWithValues(actor, spuId, businessCode,
                new SkuValues(name, null, variantSummary, null, null, null));
    }

    @Transactional
    public ProductSku createSkuWithValues(
            ProductActor actor,
            UUID spuId,
            String businessCode,
            SkuValues values) {
        UUID tenantId = requireActor(actor);
        ProductSpu spu = findSpu(tenantId, spuId);
        if (spu.getStatus() != ProductStatus.ACTIVE) {
            throw new ConflictException("SKUs can only be created under active SPUs");
        }
        String code = normalizeCode(businessCode);
        if (skuRepository.existsByTenantIdAndBusinessCode(tenantId, code)) {
            throw new ConflictException("SKU business code already exists");
        }
        NormalizedSkuValues normalized = normalizeSkuValues(values, null);
        WarehouseReference warehouse = resolveWarehouse(
                tenantId, normalized.defaultWarehouseId(), null, null);
        ProductSku saved = skuRepository.save(new ProductSku(
                tenantId, spuId, code, normalized.name(),
                normalized.variantSummary(), normalized.nameEn(),
                normalized.unitCost(), normalized.currencyCode(), warehouse.id(),
                warehouse.name()));
        audit(actor, SKU_CREATED, "product_sku", saved.getId(),
                saved.getVersion(), Map.of(
                        "spuId", saved.getSpuId().toString(),
                        "status", saved.getStatus().name()));
        return saved;
    }

    @Transactional(readOnly = true)
    public Page<ProductSku> listSkus(UUID tenantId, UUID spuId, ProductStatus status, String keyword, Pageable pageable) {
        return listSkus(
                tenantId, spuId, status, keyword, "ALL", "CONTAINS",
                pageable);
    }

    @Transactional(readOnly = true)
    public Page<ProductSku> listSkus(
            UUID tenantId,
            UUID spuId,
            ProductStatus status,
            String keyword,
            String searchField,
            Pageable pageable) {
        return listSkus(
                tenantId, spuId, status, keyword, searchField, "CONTAINS",
                pageable);
    }

    @Transactional(readOnly = true)
    public Page<SkuWithMasterIdentity> listSkusWithMasterIdentity(
            UUID tenantId,
            UUID spuId,
            ProductStatus status,
            String keyword,
            String searchField,
            String matchMode,
            Pageable pageable) {
        return listSkusWithMasterIdentity(
                tenantId, spuId, status, keyword,
                null, null, null, null, null, null, null, null,
                searchField, matchMode, "BUSINESS_CODE", false, pageable);
    }

    @Transactional(readOnly = true)
    public Page<SkuWithMasterIdentity> listSkusWithMasterIdentity(
            UUID tenantId,
            UUID spuId,
            ProductStatus status,
            String keyword,
            String searchField,
            String matchMode,
            String sortBy,
            boolean descending,
            Pageable pageable) {
        return listSkusWithMasterIdentity(
                tenantId, spuId, status, keyword,
                null, null, null, null, null, null, null, null,
                searchField, matchMode, sortBy, descending, pageable);
    }

    @Transactional(readOnly = true)
    public Page<SkuWithMasterIdentity> listSkusWithMasterIdentity(
            UUID tenantId,
            UUID spuId,
            ProductStatus status,
            String keyword,
            UUID categoryId,
            UUID developerMemberId,
            UUID developerAssistantMemberId,
            UUID salesMemberId,
            UUID artMemberId,
            UUID creatorId,
            Instant createdFrom,
            Instant createdTo,
            String searchField,
            String matchMode,
            String sortBy,
            boolean descending,
            Pageable pageable) {
        Page<ProductSku> skus = listSkus(
                tenantId, spuId, status, keyword, categoryId,
                developerMemberId, developerAssistantMemberId,
                salesMemberId, artMemberId, creatorId,
                createdFrom, createdTo,
                searchField, matchMode,
                sortBy, descending, pageable);
        Set<UUID> parentIds = skus.getContent().stream()
                .map(ProductSku::getSpuId)
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
        if (parentIds.isEmpty()) {
            return new PageImpl<>(
                    List.of(),
                    skus.getPageable(),
                    skus.getTotalElements());
        }
        Map<UUID, ProductSpu> parents = spuRepository
                .findByTenantIdAndIdIn(tenantId, parentIds)
                .stream()
                .collect(java.util.stream.Collectors.toUnmodifiableMap(
                        ProductSpu::getId,
                        parent -> parent));
        if (!parents.keySet().containsAll(parentIds)) {
            throw new IllegalStateException(
                    "Inventory SKU parent identity is incomplete");
        }
        Map<UUID, ProductSpuImage> thumbnails = new HashMap<>();
        spuImageRepository.findAllByTenantIdAndSpuIdIn(tenantId, parentIds)
                .forEach(image -> thumbnails.putIfAbsent(
                        image.getSpuId(),
                        image));
        Set<UUID> skuIds = skus.getContent().stream()
                .map(ProductSku::getId)
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
        Map<UUID, String> creators = new HashMap<>();
        skuRepository.creatorsByTenantIdAndSkuIdIn(tenantId, skuIds)
                .forEach(value -> {
                    if (value.getCreatorName() != null) {
                        creators.put(
                                value.getSkuId(),
                                value.getCreatorName());
                    }
                });
        return skus.map(sku -> new SkuWithMasterIdentity(
                sku,
                parents.get(sku.getSpuId()),
                thumbnails.get(sku.getSpuId()),
                creators.get(sku.getId())));
    }

    @Transactional(readOnly = true)
    public Page<ProductSku> listSkus(
            UUID tenantId,
            UUID spuId,
            ProductStatus status,
            String keyword,
            String searchField,
            String matchMode,
            Pageable pageable) {
        return listSkus(
                tenantId, spuId, status, keyword,
                null, null, null, null, null, null, null, null,
                searchField, matchMode, "BUSINESS_CODE", false, pageable);
    }

    @Transactional(readOnly = true)
    public Page<ProductSku> listSkus(
            UUID tenantId,
            UUID spuId,
            ProductStatus status,
            String keyword,
            String searchField,
            String matchMode,
            String sortBy,
            boolean descending,
            Pageable pageable) {
        return listSkus(
                tenantId, spuId, status, keyword,
                null, null, null, null, null, null, null, null,
                searchField, matchMode, sortBy, descending, pageable);
    }

    @Transactional(readOnly = true)
    public Page<ProductSku> listSkus(
            UUID tenantId,
            UUID spuId,
            ProductStatus status,
            String keyword,
            UUID categoryId,
            UUID developerMemberId,
            UUID developerAssistantMemberId,
            UUID salesMemberId,
            UUID artMemberId,
            UUID creatorId,
            Instant createdFrom,
            Instant createdTo,
            String searchField,
            String matchMode,
            String sortBy,
            boolean descending,
            Pageable pageable) {
        requireTenant(tenantId);
        if (spuId != null) {
            findSpu(tenantId, spuId);
        }
        if (createdFrom != null && createdTo != null
                && !createdFrom.isBefore(createdTo)) {
            throw new IllegalArgumentException(
                    "Inventory SKU created time range is invalid");
        }
        String normalizedKeyword = normalizedKeyword(keyword);
        String field = switch (searchField == null ? "ALL" : searchField) {
            case "ALL", "INVENTORY_SKU", "NAME_ZH", "NAME_EN",
                    "MASTER_CODE", "ORIGINAL_SKU", "DEFAULT_SUPPLIER" ->
                    searchField == null ? "ALL" : searchField;
            default ->
                    throw new IllegalArgumentException(
                            "Invalid inventory SKU search field");
        };
        String mode = switch (matchMode == null ? "CONTAINS" : matchMode) {
            case "STARTS_WITH", "EQUALS", "CONTAINS", "ENDS_WITH",
                    "EMPTY", "NOT_EMPTY" ->
                    matchMode == null ? "CONTAINS" : matchMode;
            default ->
                    throw new IllegalArgumentException(
                            "Invalid inventory SKU match mode");
        };
        if ("ALL".equals(field) && !"CONTAINS".equals(mode)) {
            throw new IllegalArgumentException(
                    "Inventory SKU match mode requires a specific field");
        }
        boolean presenceMode = "EMPTY".equals(mode)
                || "NOT_EMPTY".equals(mode);
        String safeSort = switch (sortBy == null
                ? "BUSINESS_CODE" : sortBy) {
            case "BUSINESS_CODE", "CREATED_AT" ->
                    sortBy == null ? "BUSINESS_CODE" : sortBy;
            default -> throw new IllegalArgumentException(
                    "Invalid inventory SKU sort field");
        };
        String sortKey = safeSort + (descending ? "_DESC" : "_ASC");
        return skuRepository.searchByTenantId(
                tenantId, spuId, categoryId, developerMemberId,
                developerAssistantMemberId, salesMemberId, artMemberId,
                creatorId,
                createdFrom != null, createdFrom,
                createdTo != null, createdTo, status,
                ProductStatus.ARCHIVED,
                normalizedKeyword != null || presenceMode,
                normalizedKeyword == null ? "" : normalizedKeyword, field,
                mode, sortKey,
                pageable);
    }

    @Transactional(readOnly = true)
    public ProductSku getSku(UUID tenantId, UUID skuId) {
        return findSku(tenantId, skuId);
    }

    @Transactional
    public ProductSku updateSku(ProductActor actor, UUID skuId, long expectedVersion, String name, String variantSummary,
            ProductStatus status) {
        return updateSkuWithValues(actor, skuId, expectedVersion,
                new SkuValues(name, null, variantSummary, null, null, null), status);
    }

    @Transactional
    public ProductSku updateSkuWithValues(
            ProductActor actor,
            UUID skuId,
            long expectedVersion,
            SkuValues values,
            ProductStatus status) {
        UUID tenantId = requireActor(actor);
        ProductSku sku = findSku(tenantId, skuId);
        requireVersion(sku.getVersion(), expectedVersion);
        if (status == ProductStatus.ARCHIVED) {
            throw new IllegalArgumentException("Use archive for a SKU");
        }
        if (sku.getStatus() == ProductStatus.ARCHIVED) {
            throw new ConflictException("Archived SKUs cannot be changed");
        }
        NormalizedSkuValues normalized = normalizeSkuValues(values, sku);
        WarehouseReference warehouse = resolveWarehouse(tenantId,
                normalized.defaultWarehouseId(), sku.getDefaultWarehouseId(),
                sku.getDefaultWarehouseNameSnapshot());
        sku.update(normalized.name(), normalized.variantSummary(), normalized.nameEn(),
                normalized.unitCost(), normalized.currencyCode(), warehouse.id(),
                warehouse.name(), status);
        ProductSku saved = skuRepository.save(sku);
        audit(actor, SKU_UPDATED, "product_sku", saved.getId(),
                expectedVersion + 1, Map.of(
                        "spuId", saved.getSpuId().toString(),
                        "status", saved.getStatus().name()));
        return saved;
    }

    @Transactional
    public ProductSku updateSkuStandardWeight(
            ProductActor actor,
            UUID skuId,
            long expectedVersion,
            Long standardWeightGrams) {
        UUID tenantId = requireActor(actor);
        ProductSku sku = skuRepository.findForUpdateByIdAndTenantId(skuId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("SKU was not found"));
        requireVersion(sku.getVersion(), expectedVersion);
        if (sku.getStatus() == ProductStatus.ARCHIVED) {
            throw new ConflictException("Archived SKUs cannot be changed");
        }
        sku.updateStandardWeight(standardWeightGrams);
        ProductSku saved = skuRepository.save(sku);
        audit(actor, SKU_WEIGHT_UPDATED, "product_sku", saved.getId(),
                expectedVersion + 1, Map.of(
                        "spuId", saved.getSpuId().toString(),
                        "weightState", standardWeightGrams == null
                                ? "PENDING" : "READY"));
        return saved;
    }

    @Transactional
    public ProductSku reassignSku(
            ProductActor actor,
            UUID skuId,
            UUID targetSpuId,
            long expectedVersion) {
        UUID tenantId = requireActor(actor);
        ProductSku sku = skuRepository.findForUpdateByIdAndTenantId(skuId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("SKU was not found"));
        requireVersion(sku.getVersion(), expectedVersion);
        ProductSpu target = findSpuForUpdate(tenantId, targetSpuId);
        if (sku.getStatus() == ProductStatus.ARCHIVED || target.getStatus() != ProductStatus.ACTIVE) {
            throw new ConflictException("Only non-archived SKUs can be linked to an active SPU");
        }
        UUID previousSpuId = sku.getSpuId();
        if (previousSpuId.equals(targetSpuId)) return sku;
        sku.reassignTo(targetSpuId);
        ProductSku saved = skuRepository.save(sku);
        audit(actor, SKU_UPDATED, "product_sku", saved.getId(), saved.getVersion(), Map.of(
                "spuId", saved.getSpuId().toString(),
                "previousSpuId", previousSpuId.toString(),
                "changedFields", "spuId"));
        return saved;
    }

    @Transactional
    public ProductSku archiveSku(ProductActor actor, UUID skuId, long expectedVersion) {
        UUID tenantId = requireActor(actor);
        ProductSku sku = skuRepository.findForUpdateByIdAndTenantId(
                        skuId, tenantId)
                .orElseThrow(() ->
                        new ResourceNotFoundException("SKU was not found"));
        requireVersion(sku.getVersion(), expectedVersion);
        if (sku.getStatus() == ProductStatus.ARCHIVED) {
            return sku;
        }
        if (listingRepository.existsByTenantIdAndSkuIdAndStatusNot(tenantId, skuId, ListingStatus.ARCHIVED)) {
            throw new ConflictException("Archive active listings before archiving the SKU");
        }
        inventoryArchiveGuard.requireSkuHasZeroBalance(tenantId, skuId);
        sku.archive();
        ProductSku saved = skuRepository.save(sku);
        audit(actor, SKU_ARCHIVED, "product_sku", saved.getId(),
                expectedVersion + 1, Map.of(
                        "spuId", saved.getSpuId().toString(),
                        "status", saved.getStatus().name()));
        return saved;
    }

    @Transactional
    public ProductListing createListing(ProductActor actor, UUID shopId, UUID skuId, String externalListingRef,
            String externalVariantRef, String externalStatus, String metadataNote) {
        UUID tenantId = requireActor(actor);
        TenantShop shop = findShop(tenantId, shopId);
        if (shop.getStatus() != ShopStatus.ACTIVE) {
            throw new ConflictException("Listings can only be created for active shops");
        }
        requireActiveShopifyPlatform(shop.getPlatformId());
        ProductSku sku = findSku(tenantId, skuId);
        if (sku.getStatus() != ProductStatus.ACTIVE || findSpu(tenantId, sku.getSpuId()).getStatus() != ProductStatus.ACTIVE) {
            throw new ConflictException("Listings can only be created for active products");
        }
        String listingRef = required(externalListingRef);
        String variantRef = nullable(externalVariantRef);
        var existing = listingRepository
                .findByTenantIdAndShopIdAndExternalListingRefAndExternalVariantRef(
                        tenantId, shopId, listingRef, variantRef);
        if (existing.isPresent()) {
            return idempotentListing(existing.get(), skuId);
        }
        ProductListing saved = listingRepository.save(new ProductListing(
                tenantId, shopId, shop.getPlatformId(), skuId,
                listingRef, variantRef, nullable(externalStatus), safeNote(metadataNote)));
        audit(actor, LISTING_CREATED, "product_listing", saved.getId(),
                saved.getVersion(), Map.of(
                        "shopId", saved.getShopId().toString(),
                        "skuId", saved.getSkuId().toString(),
                        "status", saved.getStatus().name()));
        return saved;
    }

    @Transactional
    public ProductListing createShopifyListing(ProductActor actor, UUID shopId, UUID skuId, String externalListingRef,
            String externalVariantRef, String externalStatus, String metadataNote,
            String externalInventoryItemRef) {
        UUID tenantId = requireActor(actor);
        TenantShop shop = findShop(tenantId, shopId);
        if (shop.getStatus() != ShopStatus.ACTIVE) {
            throw new ConflictException("Listings can only be created for active shops");
        }
        requireActiveShopifyPlatform(shop.getPlatformId());
        ProductSku sku = findSku(tenantId, skuId);
        if (sku.getStatus() != ProductStatus.ACTIVE || findSpu(tenantId, sku.getSpuId()).getStatus() != ProductStatus.ACTIVE) {
            throw new ConflictException("Listings can only be created for active products");
        }
        String listingRef = required(externalListingRef);
        String variantRef = nullable(externalVariantRef);
        String inventoryItemRef = nullable(externalInventoryItemRef);
        if (inventoryItemRef != null
                && !inventoryItemRef.matches("^gid://shopify/InventoryItem/[0-9]+$")) {
            throw new IllegalArgumentException(
                    "Shopify inventory item reference is invalid");
        }
        var existing = listingRepository
                .findByTenantIdAndShopIdAndExternalListingRefAndExternalVariantRef(
                        tenantId, shopId, listingRef, variantRef);
        if (existing.isPresent()) {
            return idempotentListing(existing.get(), skuId, inventoryItemRef);
        }
        ProductListing saved = listingRepository.save(new ProductListing(
                tenantId, shopId, shop.getPlatformId(), skuId,
                listingRef, variantRef, inventoryItemRef,
                nullable(externalStatus), safeNote(metadataNote)));
        audit(actor, LISTING_CREATED, "product_listing", saved.getId(),
                saved.getVersion(), Map.of(
                        "shopId", saved.getShopId().toString(),
                        "skuId", saved.getSkuId().toString(),
                        "status", saved.getStatus().name()));
        return saved;
    }

    @Transactional(readOnly = true)
    public Page<ProductListing> listListings(UUID tenantId, UUID shopId, UUID skuId, ListingStatus status,
            String keyword, Pageable pageable) {
        return listListings(
                tenantId,
                shopId,
                skuId,
                status,
                keyword,
                ListingSearchField.ALL,
                pageable);
    }

    @Transactional(readOnly = true)
    public Page<ProductListing> listListings(
            UUID tenantId,
            UUID shopId,
            UUID skuId,
            ListingStatus status,
            String keyword,
            ListingSearchField searchField,
            Pageable pageable) {
        requireTenant(tenantId);
        Objects.requireNonNull(searchField, "Listing search field is required");
        if (shopId != null) {
            findShop(tenantId, shopId);
        }
        if (skuId != null) {
            findSku(tenantId, skuId);
        }
        String normalizedKeyword = normalizedKeyword(keyword);
        return listingRepository.searchByTenantId(
                tenantId, shopId, skuId, status, ListingStatus.ARCHIVED, normalizedKeyword != null,
                normalizedKeyword == null ? "" : normalizedKeyword,
                searchField.name(),
                pageable);
    }

    @Transactional(readOnly = true)
    public Page<ListingWithSku> listListingsWithSku(
            UUID tenantId,
            UUID shopId,
            UUID skuId,
            ListingStatus status,
            String keyword,
            Pageable pageable) {
        return listListingsWithSku(
                tenantId,
                shopId,
                skuId,
                status,
                keyword,
                ListingSearchField.ALL,
                pageable);
    }

    @Transactional(readOnly = true)
    public Page<ListingWithSku> listListingsWithSku(
            UUID tenantId,
            UUID shopId,
            UUID skuId,
            ListingStatus status,
            String keyword,
            ListingSearchField searchField,
            Pageable pageable) {
        Page<ProductListing> listings = listListings(
                tenantId,
                shopId,
                skuId,
                status,
                keyword,
                searchField,
                pageable);
        Set<UUID> requiredSkuIds = listings.getContent().stream()
                .map(ProductListing::getSkuId)
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
        if (requiredSkuIds.isEmpty()) {
            return new PageImpl<>(
                    List.of(),
                    listings.getPageable(),
                    listings.getTotalElements());
        }
        Map<UUID, ProductSku> skus = skuRepository
                .findByTenantIdAndIdIn(tenantId, requiredSkuIds)
                .stream()
                .collect(java.util.stream.Collectors.toUnmodifiableMap(
                        ProductSku::getId,
                        item -> item));
        if (!skus.keySet().containsAll(requiredSkuIds)) {
            throw new IllegalStateException(
                    "Online product listing SKU identity is incomplete");
        }
        return listings.map(listing -> new ListingWithSku(
                listing,
                skus.get(listing.getSkuId())));
    }

    @Transactional(readOnly = true)
    public List<SkuListingSummary> listSkuListingSummaries(
            UUID tenantId,
            List<UUID> skuIds) {
        requireTenant(tenantId);
        if (skuIds == null || skuIds.isEmpty() || skuIds.size() > 50
                || skuIds.stream().anyMatch(Objects::isNull)) {
            throw new IllegalArgumentException(
                    "Between 1 and 50 SKU identities are required");
        }
        Set<UUID> requiredSkuIds = Set.copyOf(skuIds);
        if (requiredSkuIds.size() != skuIds.size()) {
            throw new IllegalArgumentException(
                    "SKU identities must be unique");
        }
        return listingRepository.summarizeByTenantIdAndSkuIdIn(
                tenantId,
                requiredSkuIds,
                ListingStatus.ACTIVE);
    }

    @Transactional(readOnly = true)
    public ProductListing getListing(UUID tenantId, UUID listingId) {
        return findListing(tenantId, listingId);
    }

    @Transactional
    public ProductListing updateListing(ProductActor actor, UUID listingId, long expectedVersion, String externalStatus,
            String metadataNote, ListingStatus status) {
        UUID tenantId = requireActor(actor);
        ProductListing listing = findListing(tenantId, listingId);
        requireVersion(listing.getVersion(), expectedVersion);
        if (status == ListingStatus.ARCHIVED) {
            throw new IllegalArgumentException("Use archive for a listing");
        }
        if (listing.getStatus() == ListingStatus.ARCHIVED) {
            throw new ConflictException("Archived listings cannot be changed");
        }
        listing.update(nullable(externalStatus), safeNote(metadataNote), status);
        ProductListing saved = listingRepository.save(listing);
        audit(actor, LISTING_UPDATED, "product_listing", saved.getId(),
                expectedVersion + 1, Map.of(
                        "shopId", saved.getShopId().toString(),
                        "skuId", saved.getSkuId().toString(),
                        "status", saved.getStatus().name()));
        return saved;
    }

    @Transactional
    public ProductListing archiveListing(ProductActor actor, UUID listingId, long expectedVersion) {
        UUID tenantId = requireActor(actor);
        ProductListing listing = findListing(tenantId, listingId);
        requireVersion(listing.getVersion(), expectedVersion);
        if (listing.getStatus() == ListingStatus.ARCHIVED) {
            return listing;
        }
        listing.archive();
        ProductListing saved = listingRepository.save(listing);
        audit(actor, LISTING_ARCHIVED, "product_listing", saved.getId(),
                expectedVersion + 1, Map.of(
                        "shopId", saved.getShopId().toString(),
                        "skuId", saved.getSkuId().toString(),
                        "status", saved.getStatus().name()));
        return saved;
    }

    private Page<SpuWithSummary> withSummaries(UUID tenantId, Page<ProductSpu> page, Pageable pageable) {
        List<UUID> spuIds =
                page.getContent().stream().map(ProductSpu::getId).toList();
        Map<UUID, SkuSummary> summaries = summariesFor(tenantId, spuIds);
        Map<UUID, MasterSpuMetrics> metrics = masterMetricsFor(tenantId, spuIds);
        Map<UUID, List<ProductSensitiveAttributeCode>> attributes =
                spuSensitiveAttributeRepository
                        .findByTenantIdAndSpuIdIn(tenantId, spuIds);
        return new PageImpl<>(page.getContent().stream()
                .map(spu -> new SpuWithSummary(
                        spu,
                        summaries.getOrDefault(
                                spu.getId(),
                                SkuSummary.EMPTY),
                        attributes.getOrDefault(
                                spu.getId(),
                                List.of()),
                        metrics.get(spu.getId())))
                .toList(), pageable, page.getTotalElements());
    }

    private static List<String> createSpuFieldKeys(
            ProductSpu spu,
            Collection<ProductSensitiveAttributeCode> attributes) {
        List<String> fields =
                new ArrayList<>(List.of("businessCode", "name", "nameZh"));
        addIfPresent(fields, "nameEn", spu.getNameEn());
        addIfPresent(fields, "brandName", spu.getBrandName());
        addIfPresent(fields, "productNote", spu.getProductNote());
        addIfPresent(fields, "categoryId", spu.getCategoryId());
        addIfPresent(fields, "lengthMm", spu.getLengthMm());
        addIfPresent(fields, "widthMm", spu.getWidthMm());
        addIfPresent(fields, "heightMm", spu.getHeightMm());
        addIfPresent(
                fields,
                "actualWeightGrams",
                spu.getActualWeightGrams());
        fields.add("volumetricDivisor");
        addIfPresent(
                fields,
                "packageMaterialId",
                spu.getPackageMaterialId());
        addIfPresent(
                fields,
                "packageableCount",
                spu.getPackageableCount());
        addIfPresent(fields, "artMemberId", spu.getArtMemberId());
        addIfPresent(
                fields,
                "developerMemberId",
                spu.getDeveloperMemberId());
        addIfPresent(
                fields,
                "developerAssistantMemberId",
                spu.getDeveloperAssistantMemberId());
        addIfPresent(fields, "salesMemberId", spu.getSalesMemberId());
        if (!attributes.isEmpty()) {
            fields.add("sensitiveAttributeCodes");
        }
        fields.add("status");
        return fields;
    }

    private static String summarizeAuditFields(Collection<String> fields) {
        String joined = String.join(",", fields);
        if (joined.length() <= 160) {
            return joined;
        }
        List<String> visible = new ArrayList<>();
        int remaining = fields.size();
        for (String field : fields) {
            String candidate = visible.isEmpty()
                    ? field
                    : String.join(",", visible) + "," + field;
            String suffix = "…(+" + (remaining - 1) + ")";
            if (candidate.length() + suffix.length() > 160) {
                return String.join(",", visible) + suffix;
            }
            visible.add(field);
            remaining -= 1;
        }
        return joined;
    }

    private static List<String> changedSpuFieldKeys(
            ProductSpu spu,
            SpuValues values,
            ResolvedReferences references,
            ProductStatus status,
            List<ProductSensitiveAttributeCode> existingAttributes,
            List<ProductSensitiveAttributeCode> attributes) {
        List<String> fields = new ArrayList<>();
        if (!Objects.equals(spu.getNameZh(), normalizedName(values))) {
            fields.add("name");
            fields.add("nameZh");
        }
        addIfChanged(fields, "nameEn", spu.getNameEn(), values.nameEn());
        addIfChanged(
                fields,
                "brandName",
                spu.getBrandName(),
                values.brandName());
        addIfChanged(
                fields,
                "productNote",
                spu.getProductNote(),
                values.productNote());
        addIfChanged(
                fields,
                "categoryId",
                spu.getCategoryId(),
                references.category().id());
        addIfChanged(fields, "lengthMm", spu.getLengthMm(), values.lengthMm());
        addIfChanged(fields, "widthMm", spu.getWidthMm(), values.widthMm());
        addIfChanged(fields, "heightMm", spu.getHeightMm(), values.heightMm());
        addIfChanged(
                fields,
                "actualWeightGrams",
                spu.getActualWeightGrams(),
                values.actualWeightGrams());
        addIfChanged(
                fields,
                "volumetricDivisor",
                spu.getVolumetricDivisor(),
                values.volumetricDivisor());
        addIfChanged(
                fields,
                "packageMaterialId",
                spu.getPackageMaterialId(),
                references.packageMaterial().id());
        addIfChanged(
                fields,
                "packageableCount",
                spu.getPackageableCount(),
                values.packageableCount());
        addIfChanged(
                fields,
                "artMemberId",
                spu.getArtMemberId(),
                references.artMember().id());
        addIfChanged(
                fields,
                "developerMemberId",
                spu.getDeveloperMemberId(),
                references.developerMember().id());
        addIfChanged(
                fields,
                "developerAssistantMemberId",
                spu.getDeveloperAssistantMemberId(),
                references.developerAssistantMember().id());
        addIfChanged(
                fields,
                "salesMemberId",
                spu.getSalesMemberId(),
                references.salesMember().id());
        if (!Objects.equals(existingAttributes, attributes)) {
            fields.add("sensitiveAttributeCodes");
        }
        if (!Objects.equals(spu.getStatus(), status)) {
            fields.add("status");
        }
        return fields;
    }

    private static void addIfPresent(
            List<String> fields,
            String field,
            Object value) {
        if (value != null) {
            fields.add(field);
        }
    }

    private static void addIfChanged(
            List<String> fields,
            String field,
            Object oldValue,
            Object newValue) {
        if (!Objects.equals(oldValue, newValue)) {
            fields.add(field);
        }
    }

    private SpuValues normalizeSpuValues(
            SpuValues values,
            ProductSpu existing) {
        if (values == null) {
            throw new IllegalArgumentException("SPU values are required");
        }
        String name = compatibleName(values.name(), values.nameZh());
        String nameEn = values.nameEn() == null && existing != null
                ? existing.getNameEn()
                : limitedNullable(values.nameEn(), 200, "nameEn");
        String productNote = values.productNote() == null && existing != null
                ? existing.getProductNote()
                : limitedNullable(values.productNote(), 2000, "productNote");
        boolean anyDimension = values.lengthMm() != null
                || values.widthMm() != null
                || values.heightMm() != null;
        boolean allDimensions = values.lengthMm() != null
                && values.widthMm() != null
                && values.heightMm() != null;
        if (anyDimension != allDimensions) {
            throw new IllegalArgumentException(
                    "lengthMm, widthMm and heightMm must be provided together");
        }
        range(values.lengthMm(), 1, 1_000_000, "lengthMm");
        range(values.widthMm(), 1, 1_000_000, "widthMm");
        range(values.heightMm(), 1, 1_000_000, "heightMm");
        range(values.actualWeightGrams(), 1, 1_000_000_000L,
                "actualWeightGrams");
        Integer divisor = values.volumetricDivisor();
        if (divisor == null) {
            divisor = existing == null ? 5000 : existing.getVolumetricDivisor();
        }
        if (divisor != 5000 && divisor != 6000) {
            throw new IllegalArgumentException(
                    "volumetricDivisor must be 5000 or 6000");
        }
        if ((values.packageMaterialId() == null)
                != (values.packageableCount() == null)) {
            throw new IllegalArgumentException(
                    "packageMaterialId and packageableCount must be provided together");
        }
        range(values.packageableCount(), 1, 1_000_000,
                "packageableCount");
        return new SpuValues(
                name,
                name,
                nameEn,
                limitedNullable(values.brandName(), 160, "brandName"),
                productNote,
                values.categoryId(),
                values.lengthMm(),
                values.widthMm(),
                values.heightMm(),
                values.actualWeightGrams(),
                divisor,
                values.packageMaterialId(),
                values.packageableCount(),
                values.artMemberId(),
                values.developerMemberId(),
                values.developerAssistantMemberId(),
                values.salesMemberId());
    }

    private NormalizedSkuValues normalizeSkuValues(
            SkuValues values,
            ProductSku existing) {
        if (values == null) {
            throw new IllegalArgumentException("SKU values are required");
        }
        String name = required(values.name());
        String nameEn = values.nameEn() == null && existing != null
                ? existing.getNameEn()
                : nullable(values.nameEn());
        String variant = values.variantSummary() == null && existing != null
                ? existing.getVariantSummary()
                : nullable(values.variantSummary());
        String rawCost = values.unitCost() == null && existing != null
                ? (existing.getUnitCost() == null
                        ? null : existing.getUnitCost().toPlainString())
                : nullable(values.unitCost());
        String currency = values.currencyCode() == null && existing != null
                ? existing.getCurrencyCode()
                : nullable(values.currencyCode());
        if ((rawCost == null) != (currency == null)) {
            throw new IllegalArgumentException(
                    "unitCost and currencyCode must be provided together");
        }
        BigDecimal unitCost = null;
        if (rawCost != null) {
            if (!rawCost.matches("(0|[1-9][0-9]{0,9})(\\.[0-9]{1,4})?")) {
                throw new IllegalArgumentException("unitCost is invalid");
            }
            unitCost = new BigDecimal(rawCost).setScale(4, RoundingMode.UNNECESSARY);
        }
        if (currency != null && !currency.matches("[A-Z]{3}")) {
            throw new IllegalArgumentException("currencyCode is invalid");
        }
        UUID warehouseId = values.defaultWarehouseId() == null && existing != null
                ? existing.getDefaultWarehouseId()
                : values.defaultWarehouseId();
        return new NormalizedSkuValues(name, nameEn, variant, unitCost,
                currency, warehouseId);
    }

    private WarehouseReference resolveWarehouse(
            UUID tenantId,
            UUID requestedId,
            UUID existingId,
            String existingName) {
        if (requestedId == null) return WarehouseReference.NONE;
        if (requestedId.equals(existingId)) {
            return new WarehouseReference(existingId, existingName);
        }
        Warehouse warehouse = warehouseRepository.findByIdAndTenantId(
                        requestedId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Default warehouse was not found"));
        if (warehouse.getStatus() != WarehouseStatus.ACTIVE) {
            throw new ConflictException("Only active warehouses can be selected");
        }
        return new WarehouseReference(warehouse.getId(), warehouse.getName());
    }

    private ResolvedReferences resolveReferences(
            UUID tenantId,
            ProductSpu existing,
            SpuValues values) {
        ReferenceValue category = resolveCategory(
                tenantId,
                values.categoryId(),
                existing == null ? null : existing.getCategoryId(),
                existing == null
                        ? null
                        : existing.getCategoryNameSnapshot());
        ReferenceValue packageMaterial = resolvePackageMaterial(
                tenantId,
                values.packageMaterialId(),
                existing == null ? null : existing.getPackageMaterialId(),
                existing == null
                        ? null
                        : existing.getPackageMaterialNameSnapshot());

        Map<String, UUID> requestedMembers = new HashMap<>();
        requestedMembers.put("art", values.artMemberId());
        requestedMembers.put("developer", values.developerMemberId());
        requestedMembers.put(
                "developerAssistant",
                values.developerAssistantMemberId());
        requestedMembers.put("sales", values.salesMemberId());
        Map<String, UUID> existingMembers = new HashMap<>();
        if (existing != null) {
            existingMembers.put("art", existing.getArtMemberId());
            existingMembers.put(
                    "developer",
                    existing.getDeveloperMemberId());
            existingMembers.put(
                    "developerAssistant",
                    existing.getDeveloperAssistantMemberId());
            existingMembers.put("sales", existing.getSalesMemberId());
        }
        Set<UUID> additions = new TreeSet<>();
        requestedMembers.forEach((role, requestedId) -> {
            if (requestedId != null
                    && !requestedId.equals(existingMembers.get(role))) {
                additions.add(requestedId);
            }
        });
        Map<UUID, UserAccountEntity> loaded = new HashMap<>();
        for (UUID memberId : additions) {
            UserAccountEntity member = userRepository
                    .findByIdAndTenantIdForUpdate(memberId, tenantId)
                    .orElseThrow(() -> new ResourceNotFoundException(
                            "Product member reference was not found"));
            if (member.getStatus() != AccountStatus.ACTIVE) {
                throw new ConflictException(
                        "Only active members can be assigned to products");
            }
            loaded.put(memberId, member);
        }
        return new ResolvedReferences(
                category,
                packageMaterial,
                resolveMember(
                        values.artMemberId(),
                        existing == null ? null : existing.getArtMemberId(),
                        existing == null
                                ? null
                                : existing.getArtMemberNameSnapshot(),
                        loaded),
                resolveMember(
                        values.developerMemberId(),
                        existing == null
                                ? null
                                : existing.getDeveloperMemberId(),
                        existing == null
                                ? null
                                : existing.getDeveloperMemberNameSnapshot(),
                        loaded),
                resolveMember(
                        values.developerAssistantMemberId(),
                        existing == null
                                ? null
                                : existing.getDeveloperAssistantMemberId(),
                        existing == null
                                ? null
                                : existing
                                        .getDeveloperAssistantMemberNameSnapshot(),
                        loaded),
                resolveMember(
                        values.salesMemberId(),
                        existing == null ? null : existing.getSalesMemberId(),
                        existing == null
                                ? null
                                : existing.getSalesMemberNameSnapshot(),
                        loaded));
    }

    private ReferenceValue resolveCategory(
            UUID tenantId,
            UUID requestedId,
            UUID currentId,
            String currentName) {
        if (requestedId == null) {
            return ReferenceValue.NONE;
        }
        if (requestedId.equals(currentId)) {
            return new ReferenceValue(currentId, currentName);
        }
        ProductCategory category = categoryRepository
                .findForUpdateByIdAndTenantId(requestedId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product category was not found"));
        if (category.getStatus() != ProductMasterDataStatus.ACTIVE) {
            throw new ConflictException(
                    "Only active product categories can be selected");
        }
        return new ReferenceValue(category.getId(), category.getName());
    }

    private ReferenceValue resolvePackageMaterial(
            UUID tenantId,
            UUID requestedId,
            UUID currentId,
            String currentName) {
        if (requestedId == null) {
            return ReferenceValue.NONE;
        }
        if (requestedId.equals(currentId)) {
            return new ReferenceValue(currentId, currentName);
        }
        ProductPackageMaterial material = packageRepository
                .findForUpdateByIdAndTenantId(requestedId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product package material was not found"));
        if (material.getStatus() != ProductMasterDataStatus.ACTIVE) {
            throw new ConflictException(
                    "Only active package materials can be selected");
        }
        return new ReferenceValue(material.getId(), material.getName());
    }

    private static ReferenceValue resolveMember(
            UUID requestedId,
            UUID currentId,
            String currentName,
            Map<UUID, UserAccountEntity> loaded) {
        if (requestedId == null) {
            return ReferenceValue.NONE;
        }
        if (requestedId.equals(currentId)) {
            return new ReferenceValue(currentId, currentName);
        }
        UserAccountEntity member = loaded.get(requestedId);
        if (member == null) {
            throw new ResourceNotFoundException(
                    "Product member reference was not found");
        }
        return new ReferenceValue(member.getId(), member.getDisplayName());
    }

    private static String normalizedName(SpuValues values) {
        return values.nameZh();
    }

    private static void range(
            Number value,
            long minimum,
            long maximum,
            String field) {
        if (value != null
                && (value.longValue() < minimum
                || value.longValue() > maximum)) {
            throw new IllegalArgumentException(field + " is out of range");
        }
    }

    private Map<UUID, SkuSummary> summariesFor(UUID tenantId, Collection<UUID> spuIds) {
        if (spuIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, SkuSummary> result = new HashMap<>();
        skuRepository.summarizeByTenantIdAndSpuIdIn(tenantId, spuIds, ProductStatus.ACTIVE)
                .forEach(value -> result.put(value.getSpuId(), new SkuSummary(value.getSkuCount(), value.getActiveSkuCount())));
        return result;
    }

    private Map<UUID, MasterSpuMetrics> masterMetricsFor(
            UUID tenantId,
            Collection<UUID> spuIds) {
        if (spuIds.isEmpty()) {
            return Map.of();
        }
        Instant now = Instant.now();
        Map<UUID, MasterSpuMetrics> result = new HashMap<>();
        spuRepository.masterMetricsByTenantIdAndSpuIdIn(
                tenantId,
                spuIds,
                now.minus(java.time.Duration.ofDays(7)),
                now.minus(java.time.Duration.ofDays(28)),
                now.minus(java.time.Duration.ofDays(42)))
                .forEach(value -> result.put(value.getSpuId(),
                        new MasterSpuMetrics(
                                value.getTotalInventory(),
                                value.getSales7(),
                                value.getSales28(),
                                value.getSales42(),
                                value.getSales28() / 28.0d,
                                value.getCreatorName())));
        return result;
    }

    private ProductListing idempotentListing(
            ProductListing existing,
            UUID skuId) {
        if (!existing.getSkuId().equals(skuId)) {
            throw new ConflictException("Listing reference is already mapped to another SKU");
        }
        return existing;
    }

    private ProductListing idempotentListing(
            ProductListing existing,
            UUID skuId,
            String externalInventoryItemRef) {
        if (!existing.getSkuId().equals(skuId)) {
            throw new ConflictException("Listing reference is already mapped to another SKU");
        }
        if (!Objects.equals(
                existing.getExternalInventoryItemRef(),
                externalInventoryItemRef)) {
            throw new ConflictException(
                    "Listing inventory item reference conflicts with existing product data");
        }
        return existing;
    }
    private void audit(
            ProductActor actor,
            String action,
            String resourceType,
            UUID resourceId,
            long version,
            Map<String, String> facts) {
        Map<String, String> details = new java.util.LinkedHashMap<>();
        details.put("version", Long.toString(version));
        details.putAll(facts);
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                action,
                resourceType,
                resourceId.toString(),
                actor.requestId(),
                actor.sourceIp(),
                details));
    }
    private static UUID requireActor(ProductActor actor) {
        if (actor == null) {
            throw new IllegalArgumentException("Actor is required");
        }
        requireTenant(actor.tenantId());
        boolean userActor = actor.userId() != null;
        boolean systemAdminActor = actor.systemAdminId() != null;
        if (userActor == systemAdminActor) {
            throw new IllegalArgumentException("Exactly one actor identity is required");
        }
        return actor.tenantId();
    }

    private ProductSpu findSpu(UUID tenantId, UUID spuId) {
        requireTenant(tenantId);
        return spuRepository.findByIdAndTenantId(spuId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Product SPU was not found"));
    }

    private ProductSpu findSpuForUpdate(UUID tenantId, UUID spuId) {
        requireTenant(tenantId);
        return spuRepository.findForUpdateByIdAndTenantId(spuId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product SPU was not found"));
    }

    private ProductSku findSku(UUID tenantId, UUID skuId) {
        requireTenant(tenantId);
        return skuRepository.findByIdAndTenantId(skuId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Product SKU was not found"));
    }
    private ProductListing findListing(UUID tenantId, UUID listingId) {
        requireTenant(tenantId);
        return listingRepository.findByIdAndTenantId(listingId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Product listing was not found"));
    }
    private TenantShop findShop(UUID tenantId, UUID shopId) {
        requireTenant(tenantId);
        return shopRepository.findByIdAndTenantId(shopId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Shop was not found"));
    }
    private void requireActiveShopifyPlatform(UUID platformId) {
        PlatformCatalogEntry platform = platformRepository.findById(platformId)
                .orElseThrow(() -> new ResourceNotFoundException("Shop platform was not found"));
        if (platform.getStatus() != PlatformStatus.ACTIVE
                || !SUPPORTED_LISTING_PLATFORM_CODE.equals(platform.getCode())) {
            throw new ConflictException(
                    "Listings can only be created for active Shopify shops");
        }
    }
    private static void requireVersion(long current, long expected) {
        if (current != expected) {
            throw new ConflictException("The resource has changed");
        }
    }
    private static List<VersionedResource> normalizedBatch(
            Collection<VersionedResource> items) {
        if (items == null || items.isEmpty() || items.size() > 200) {
            throw new IllegalArgumentException("A bounded batch is required");
        }
        Map<UUID, VersionedResource> unique = new HashMap<>();
        for (VersionedResource item : items) {
            if (item == null || item.id() == null || item.version() < 0
                    || unique.putIfAbsent(item.id(), item) != null) {
                throw new IllegalArgumentException("Batch resources must be distinct and versioned");
            }
        }
        return unique.values().stream()
                .sorted(java.util.Comparator.comparing(item -> item.id().toString()))
                .toList();
    }
    private static List<ImportedSpuValues> boundedImport(Collection<ImportedSpuValues> items) {
        if (items == null || items.isEmpty() || items.size() > 200 || items.stream().anyMatch(Objects::isNull)) {
            throw new IllegalArgumentException("A bounded SPU import is required");
        }
        return List.copyOf(items);
    }
    private static List<ImportedSpuUpdateValues> boundedUpdateImport(Collection<ImportedSpuUpdateValues> items) {
        if (items == null || items.isEmpty() || items.size() > 200 || items.stream().anyMatch(item -> item == null || item.id() == null)) {
            throw new IllegalArgumentException("A bounded SPU update import is required");
        }
        Set<UUID> ids = new HashSet<>();
        if (items.stream().anyMatch(item -> !ids.add(item.id()))) {
            throw new IllegalArgumentException("Imported SPU updates must be distinct");
        }
        return items.stream().sorted(java.util.Comparator.comparing(item -> item.id().toString())).toList();
    }
    private static SpuValues mergeImportedValues(ProductSpu existing, SpuValues values) {
        if (values == null) throw new IllegalArgumentException("Imported SPU values are required");
        boolean dimensionsMissing = values.lengthMm() == null && values.widthMm() == null && values.heightMm() == null;
        boolean packageMissing = values.packageMaterialId() == null && values.packageableCount() == null;
        return new SpuValues(
                values.name() == null ? existing.getName() : values.name(),
                values.nameZh() == null ? existing.getNameZh() : values.nameZh(),
                values.nameEn() == null ? existing.getNameEn() : values.nameEn(),
                values.brandName() == null ? existing.getBrandName() : values.brandName(),
                values.productNote() == null ? existing.getProductNote() : values.productNote(),
                values.categoryId() == null ? existing.getCategoryId() : values.categoryId(),
                dimensionsMissing ? existing.getLengthMm() : values.lengthMm(),
                dimensionsMissing ? existing.getWidthMm() : values.widthMm(),
                dimensionsMissing ? existing.getHeightMm() : values.heightMm(),
                values.actualWeightGrams() == null ? existing.getActualWeightGrams() : values.actualWeightGrams(),
                values.volumetricDivisor() == null ? existing.getVolumetricDivisor() : values.volumetricDivisor(),
                packageMissing ? existing.getPackageMaterialId() : values.packageMaterialId(),
                packageMissing ? existing.getPackageableCount() : values.packageableCount(),
                values.artMemberId() == null ? existing.getArtMemberId() : values.artMemberId(),
                values.developerMemberId() == null ? existing.getDeveloperMemberId() : values.developerMemberId(),
                values.developerAssistantMemberId() == null ? existing.getDeveloperAssistantMemberId() : values.developerAssistantMemberId(),
                values.salesMemberId() == null ? existing.getSalesMemberId() : values.salesMemberId());
    }
    private static void requireTenant(UUID tenantId) {
        if (tenantId == null) {
            throw new IllegalArgumentException("Tenant ID is required");
        }
    }
    private static String normalizeCode(String value) { return required(value).toUpperCase(Locale.ROOT); }
    private static String normalizedKeyword(String value) {
        String normalized = nullable(value);
        return normalized == null ? null : normalized.toLowerCase(Locale.ROOT);
    }
    private static String required(String value) {
        String normalized = nullable(value);
        if (normalized == null) {
            throw new IllegalArgumentException("A required value is missing");
        }
        return normalized;
    }
    private static String compatibleName(String name, String nameZh) {
        String legacy = limitedNullable(name, 200, "name");
        String chinese = limitedNullable(nameZh, 200, "nameZh");
        if (legacy == null && chinese == null) {
            throw new IllegalArgumentException("Chinese name is required");
        }
        if (legacy != null && chinese != null && !legacy.equals(chinese)) {
            throw new IllegalArgumentException(
                    "name and nameZh must identify the same Chinese name");
        }
        return legacy == null ? chinese : legacy;
    }
    private static String limitedNullable(
            String value,
            int maximumLength,
            String field) {
        String normalized = nullable(value);
        if (normalized != null && normalized.length() > maximumLength) {
            throw new IllegalArgumentException(field + " is too long");
        }
        return normalized;
    }
    private static String nullable(String value) { return value == null || value.isBlank() ? null : value.trim(); }
    private static String safeNote(String value) { return SensitiveTextRedactor.redactNullable(value); }

    public record SpuValues(
            String name,
            String nameZh,
            String nameEn,
            String brandName,
            String productNote,
            UUID categoryId,
            Long lengthMm,
            Long widthMm,
            Long heightMm,
            Long actualWeightGrams,
            Integer volumetricDivisor,
            UUID packageMaterialId,
            Integer packageableCount,
            UUID artMemberId,
            UUID developerMemberId,
            UUID developerAssistantMemberId,
            UUID salesMemberId) {
    }

    public record InitialSkuValues(
            String businessCode,
            String name,
            String nameEn,
            String variantSummary,
            String unitCost,
            String currencyCode,
            UUID defaultWarehouseId) {
        public InitialSkuValues(
                String businessCode, String name, String variantSummary) {
            this(businessCode, name, null, variantSummary, null, null, null);
        }
        SkuValues values() {
            return new SkuValues(name, nameEn, variantSummary, unitCost,
                    currencyCode, defaultWarehouseId);
        }
    }
    public record SkuValues(
            String name,
            String nameEn,
            String variantSummary,
            String unitCost,
            String currencyCode,
            UUID defaultWarehouseId) { }
    public record VersionedResource(UUID id, long version) { }
    public record ImportedSpuValues(
            String businessCode,
            SpuValues values,
            Collection<ProductSensitiveAttributeCode> sensitiveAttributeCodes,
            Collection<InitialSkuValues> initialSkus) { }
    public record ImportedSpuUpdateValues(
            UUID id,
            long version,
            SpuValues values,
            ProductStatus status,
            Collection<ProductSensitiveAttributeCode> sensitiveAttributeCodes) { }

    private record ReferenceValue(UUID id, String name) {
        private static final ReferenceValue NONE =
                new ReferenceValue(null, null);
    }
    private record WarehouseReference(UUID id, String name) {
        private static final WarehouseReference NONE =
                new WarehouseReference(null, null);
    }
    private record NormalizedSkuValues(
            String name,
            String nameEn,
            String variantSummary,
            BigDecimal unitCost,
            String currencyCode,
            UUID defaultWarehouseId) { }

    private record ResolvedReferences(
            ReferenceValue category,
            ReferenceValue packageMaterial,
            ReferenceValue artMember,
            ReferenceValue developerMember,
            ReferenceValue developerAssistantMember,
            ReferenceValue salesMember) {
    }

    public record SkuSummary(long totalSkuCount, long activeSkuCount) {
        public static final SkuSummary EMPTY = new SkuSummary(0, 0);
    }
    public record SkuWithMasterIdentity(
            ProductSku sku,
            ProductSpu master,
            ProductSpuImage thumbnail,
            String creatorName) {
        public SkuWithMasterIdentity(
                ProductSku sku,
                ProductSpu master) {
            this(sku, master, null, null);
        }

        public SkuWithMasterIdentity(
                ProductSku sku,
                ProductSpu master,
                ProductSpuImage thumbnail) {
            this(sku, master, thumbnail, null);
        }

        public SkuWithMasterIdentity {
            Objects.requireNonNull(sku);
            Objects.requireNonNull(master);
            if (!sku.getTenantId().equals(master.getTenantId())
                    || !sku.getSpuId().equals(master.getId())) {
                throw new IllegalArgumentException(
                        "Inventory SKU parent identity does not match");
            }
            if (thumbnail != null
                    && (!thumbnail.getTenantId().equals(sku.getTenantId())
                    || !thumbnail.getSpuId().equals(sku.getSpuId()))) {
                throw new IllegalArgumentException(
                        "Inventory SKU thumbnail identity does not match");
            }
        }
    }
    public record ListingWithSku(
            ProductListing listing,
            ProductSku sku) {
        public ListingWithSku {
            Objects.requireNonNull(listing);
            Objects.requireNonNull(sku);
            if (!listing.getTenantId().equals(sku.getTenantId())
                    || !listing.getSkuId().equals(sku.getId())) {
                throw new IllegalArgumentException(
                        "Online product listing SKU identity does not match");
            }
        }
    }
    public enum ListingSearchField {
        ALL,
        PLATFORM_PRODUCT,
        PLATFORM_VARIANT,
        EXTERNAL_STATUS,
        INVENTORY_SKU
    }
    public record SpuWithSummary(
            ProductSpu spu,
            SkuSummary skuSummary,
            List<ProductSensitiveAttributeCode> sensitiveAttributeCodes,
            MasterSpuMetrics masterMetrics) {
        public SpuWithSummary(
                ProductSpu spu,
                SkuSummary skuSummary,
                List<ProductSensitiveAttributeCode> sensitiveAttributeCodes) {
            this(spu, skuSummary, sensitiveAttributeCodes, null);
        }
        public SpuWithSummary(ProductSpu spu, SkuSummary skuSummary) {
            this(spu, skuSummary, List.of(), null);
        }

        public SpuWithSummary {
            sensitiveAttributeCodes = List.copyOf(
                    sensitiveAttributeCodes);
        }
    }
    public record MasterSpuMetrics(
            long totalInventory,
            long sales7,
            long sales28,
            long sales42,
            double forecastDailySales,
            String creatorName) { }
}
