package cn.xzkj.erp.product.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.util.ReflectionTestUtils;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.inventory.service.InventoryArchiveGuard;
import cn.xzkj.erp.warehouse.repository.WarehouseRepository;
import cn.xzkj.erp.warehouse.domain.Warehouse;
import cn.xzkj.erp.platform.domain.PlatformCatalogEntry;
import cn.xzkj.erp.platform.domain.TenantShop;
import cn.xzkj.erp.platform.repository.PlatformCatalogRepository;
import cn.xzkj.erp.platform.repository.TenantShopRepository;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.product.domain.ProductListing;
import cn.xzkj.erp.product.domain.ListingStatus;
import cn.xzkj.erp.product.domain.ProductSensitiveAttributeCode;
import cn.xzkj.erp.product.domain.ProductSku;
import cn.xzkj.erp.product.domain.ProductSpu;
import cn.xzkj.erp.product.domain.ProductSpuImage;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.product.repository.ProductCategoryRepository;
import cn.xzkj.erp.product.repository.ProductListingRepository;
import cn.xzkj.erp.product.repository.ProductPackageMaterialRepository;
import cn.xzkj.erp.product.repository.ProductSkuRepository;
import cn.xzkj.erp.product.repository.ProductSpuRepository;
import cn.xzkj.erp.product.repository.ProductSpuImageRepository;
import cn.xzkj.erp.product.repository.ProductSpuSensitiveAttributeRepository;
import cn.xzkj.erp.iam.persistence.UserAccountRepository;

@ExtendWith(MockitoExtension.class)
class ProductCenterServiceTest {
    @Mock private ProductSpuRepository spuRepository;
    @Mock private ProductSpuImageRepository spuImageRepository;
    @Mock private ProductSpuSensitiveAttributeRepository
            spuSensitiveAttributeRepository;
    @Mock private ProductSkuRepository skuRepository;
    @Mock private ProductListingRepository listingRepository;
    @Mock private ProductCategoryRepository categoryRepository;
    @Mock private ProductPackageMaterialRepository packageRepository;
    @Mock private UserAccountRepository userRepository;
    @Mock private TenantShopRepository shopRepository;
    @Mock private PlatformCatalogRepository platformRepository;
    @Mock private SecurityAuditRecorder auditRecorder;
    @Mock private InventoryArchiveGuard inventoryArchiveGuard;
    @Mock private WarehouseRepository warehouseRepository;
    private ProductCenterService service;

    @BeforeEach
    void setUp() {
        service = new ProductCenterService(
                spuRepository, spuImageRepository,
                spuSensitiveAttributeRepository,
                skuRepository, listingRepository,
                categoryRepository, packageRepository, userRepository,
                shopRepository, platformRepository, auditRecorder,
                inventoryArchiveGuard, warehouseRepository);
        lenient().when(spuSensitiveAttributeRepository
                        .findByTenantIdAndSpuId(any(), any()))
                .thenReturn(List.of());
        lenient().when(spuSensitiveAttributeRepository
                        .findByTenantIdAndSpuIdIn(any(), any()))
                .thenReturn(java.util.Map.of());
    }

    @Test
    void treatsCrossTenantProductAsNotFound() {
        UUID tenantId = UUID.randomUUID(); UUID spuId = UUID.randomUUID();
        when(spuRepository.findByIdAndTenantId(spuId, tenantId)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.getSpu(tenantId, spuId)).isInstanceOf(ResourceNotFoundException.class);
        verify(spuRepository).findByIdAndTenantId(spuId, tenantId);
    }

    @Test
    void loadsSkuSummariesInOneTenantScopedBatchForSpuPage() {
        UUID tenantId = UUID.randomUUID();
        ProductSpu first = new ProductSpu(tenantId, "ONE", "One", null, null);
        ProductSpu second = new ProductSpu(tenantId, "TWO", "Two", null, null);
        UUID firstId = UUID.randomUUID(); UUID secondId = UUID.randomUUID();
        ReflectionTestUtils.setField(first, "id", firstId);
        ReflectionTestUtils.setField(second, "id", secondId);
        when(spuRepository.searchMasterByTenantId(
                eq(tenantId), eq(null), eq(ProductStatus.ARCHIVED.name()),
                eq(false), eq(""), eq("ALL"), eq(null), eq(null),
                eq(null), eq(null), eq(null), eq("BUSINESS_CODE"),
                eq(false), any()))
                .thenReturn(new PageImpl<>(List.of(first, second), PageRequest.of(0, 50), 2));
        when(skuRepository.summarizeByTenantIdAndSpuIdIn(eq(tenantId), any(), eq(ProductStatus.ACTIVE)))
                .thenReturn(List.of(summary(firstId, 3, 2), summary(secondId, 1, 1)));

        assertThat(service.listSpus(tenantId, null, null, PageRequest.of(0, 50)).getContent())
                .extracting(value -> value.skuSummary().totalSkuCount()).containsExactly(3L, 1L);
        verify(skuRepository).summarizeByTenantIdAndSpuIdIn(eq(tenantId), eq(List.of(firstId, secondId)), eq(ProductStatus.ACTIVE));
        verify(skuRepository, never()).findByIdAndTenantId(any(), any());
    }

    @Test
    void listSearchesUseNonNullLowercaseLiteralKeywords() {
        UUID tenantId = UUID.randomUUID();
        PageRequest pageable = PageRequest.of(0, 50);
        when(spuRepository.searchMasterByTenantId(
                tenantId, null, ProductStatus.ARCHIVED.name(), true, "literal %_",
                "ALL", null, null, null, null, null, "BUSINESS_CODE",
                false, pageable))
                .thenReturn(Page.empty(pageable));
        when(skuRepository.searchByTenantId(
                tenantId, null, null, null, null, null, null,
                null, false, null, false, null,
                null, ProductStatus.ARCHIVED, true, "sku %_",
                "ALL", "CONTAINS", "BUSINESS_CODE_ASC", pageable))
                .thenReturn(Page.empty(pageable));
        when(listingRepository.searchByTenantId(
                tenantId, null, null, null, cn.xzkj.erp.product.domain.ListingStatus.ARCHIVED,
                true, "listing %_", "ALL", pageable))
                .thenReturn(Page.empty(pageable));

        service.listSpus(tenantId, null, "  LiTeRaL %_  ", pageable);
        service.listSkus(tenantId, null, null, "  SKU %_  ", pageable);
        service.listListings(tenantId, null, null, null, "  LISTING %_  ", pageable);

        verify(spuRepository).searchMasterByTenantId(
                tenantId, null, ProductStatus.ARCHIVED.name(), true, "literal %_",
                "ALL", null, null, null, null, null, "BUSINESS_CODE",
                false, pageable);
        verify(skuRepository).searchByTenantId(
                tenantId, null, null, null, null, null, null,
                null, false, null, false, null,
                null, ProductStatus.ARCHIVED, true, "sku %_",
                "ALL", "CONTAINS", "BUSINESS_CODE_ASC", pageable);
        verify(listingRepository).searchByTenantId(
                tenantId, null, null, null, cn.xzkj.erp.product.domain.ListingStatus.ARCHIVED,
                true, "listing %_", "ALL", pageable);
    }

    @Test
    void listingSearchDelegatesOnlyReviewedFieldWithinTenantScope() {
        UUID tenantId = UUID.randomUUID();
        PageRequest pageable = PageRequest.of(0, 50);
        when(listingRepository.searchByTenantId(
                tenantId, null, null, ListingStatus.ACTIVE,
                ListingStatus.ARCHIVED, true, "sku-local",
                "INVENTORY_SKU", pageable))
                .thenReturn(Page.empty(pageable));

        service.listListings(
                tenantId,
                null,
                null,
                ListingStatus.ACTIVE,
                " SKU-LOCAL ",
                ProductCenterService.ListingSearchField.INVENTORY_SKU,
                pageable);

        verify(listingRepository).searchByTenantId(
                tenantId, null, null, ListingStatus.ACTIVE,
                ListingStatus.ARCHIVED, true, "sku-local",
                "INVENTORY_SKU", pageable);
    }

    @Test
    void loadsActiveListingCountsInOneTenantScopedBatch() {
        UUID tenantId = UUID.randomUUID();
        UUID firstSkuId = UUID.randomUUID();
        UUID secondSkuId = UUID.randomUUID();
        when(listingRepository.summarizeByTenantIdAndSkuIdIn(
                eq(tenantId), any(), eq(ListingStatus.ACTIVE)))
                .thenReturn(List.of(
                        new SkuListingSummary(firstSkuId, 3),
                        new SkuListingSummary(secondSkuId, 1)));

        assertThat(service.listSkuListingSummaries(
                tenantId, List.of(firstSkuId, secondSkuId)))
                .extracting(
                        SkuListingSummary::skuId,
                        SkuListingSummary::activeListingCount)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(firstSkuId, 3L),
                        org.assertj.core.groups.Tuple.tuple(secondSkuId, 1L));
        verify(listingRepository).summarizeByTenantIdAndSkuIdIn(
                eq(tenantId),
                argThat(ids -> ids.equals(Set.of(firstSkuId, secondSkuId))),
                eq(ListingStatus.ACTIVE));
    }

    @Test
    void resolvesListingSkuIdentityInOneTenantScopedBatch() {
        UUID tenantId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        PageRequest pageable = PageRequest.of(0, 50);
        ProductListing listing = existingListing(
                tenantId,
                UUID.randomUUID(),
                skuId);
        ProductSku sku = new ProductSku(
                tenantId,
                UUID.randomUUID(),
                "SKU_LOCAL_001",
                "本地库存商品",
                null);
        ReflectionTestUtils.setField(sku, "id", skuId);
        when(listingRepository.searchByTenantId(
                tenantId,
                null,
                null,
                null,
                ListingStatus.ARCHIVED,
                false,
                "",
                "ALL",
                pageable))
                .thenReturn(new PageImpl<>(
                        List.of(listing),
                        pageable,
                        1));
        when(skuRepository.findByTenantIdAndIdIn(
                tenantId,
                Set.of(skuId)))
                .thenReturn(List.of(sku));

        Page<ProductCenterService.ListingWithSku> result =
                service.listListingsWithSku(
                        tenantId,
                        null,
                        null,
                        null,
                        null,
                        pageable);

        assertThat(result.getContent()).singleElement().satisfies(value -> {
            assertThat(value.listing()).isSameAs(listing);
            assertThat(value.sku().getBusinessCode())
                    .isEqualTo("SKU_LOCAL_001");
            assertThat(value.sku().getName())
                    .isEqualTo("本地库存商品");
        });
        verify(skuRepository).findByTenantIdAndIdIn(
                tenantId,
                Set.of(skuId));
    }

    @Test
    void failsClosedWhenListingSkuIdentityIsIncomplete() {
        UUID tenantId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        PageRequest pageable = PageRequest.of(0, 50);
        when(listingRepository.searchByTenantId(
                tenantId,
                null,
                null,
                null,
                ListingStatus.ARCHIVED,
                false,
                "",
                "ALL",
                pageable))
                .thenReturn(new PageImpl<>(
                        List.of(existingListing(
                                tenantId,
                                UUID.randomUUID(),
                                skuId)),
                        pageable,
                        1));
        when(skuRepository.findByTenantIdAndIdIn(
                tenantId,
                Set.of(skuId)))
                .thenReturn(List.of());

        assertThatThrownBy(() -> service.listListingsWithSku(
                tenantId,
                null,
                null,
                null,
                null,
                pageable))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage(
                        "Online product listing SKU identity is incomplete");
    }

    @Test
    void rejectsDuplicateListingSummarySkuIdentitiesBeforeQuerying() {
        UUID skuId = UUID.randomUUID();

        assertThatThrownBy(() -> service.listSkuListingSummaries(
                UUID.randomUUID(), List.of(skuId, skuId)))
                .isInstanceOf(IllegalArgumentException.class);
        verify(listingRepository, never())
                .summarizeByTenantIdAndSkuIdIn(any(), any(), any());
    }

    @Test
    void inventorySkuSearchDelegatesOnlyReviewedFieldsAndMatchModes() {
        UUID tenantId = UUID.randomUUID();
        UUID categoryId = UUID.randomUUID();
        UUID developerMemberId = UUID.randomUUID();
        UUID developerAssistantMemberId = UUID.randomUUID();
        UUID salesMemberId = UUID.randomUUID();
        UUID artMemberId = UUID.randomUUID();
        UUID creatorId = UUID.randomUUID();
        Instant createdFrom = Instant.parse("2026-06-30T16:00:00Z");
        Instant createdTo = Instant.parse("2026-07-31T16:00:00Z");
        PageRequest pageable = PageRequest.of(0, 50);
        when(skuRepository.searchByTenantId(
                tenantId, null, null, null, null, null, null,
                null, false, null, false, null,
                ProductStatus.ACTIVE,
                ProductStatus.ARCHIVED, true, "master-100",
                "MASTER_CODE", "STARTS_WITH", "BUSINESS_CODE_ASC",
                pageable))
                .thenReturn(Page.empty(pageable));
        when(skuRepository.searchByTenantId(
                tenantId, null, null, null, null, null, null,
                null, false, null, false, null,
                null, ProductStatus.ARCHIVED, true, "",
                "NAME_EN", "EMPTY", "BUSINESS_CODE_ASC", pageable))
                .thenReturn(Page.empty(pageable));
        when(skuRepository.searchByTenantId(
                tenantId, null, categoryId, developerMemberId,
                developerAssistantMemberId, salesMemberId, artMemberId,
                creatorId, true, createdFrom, true, createdTo, null,
                ProductStatus.ARCHIVED, false, "",
                "INVENTORY_SKU", "STARTS_WITH", "CREATED_AT_DESC",
                pageable))
                .thenReturn(Page.empty(pageable));
        when(skuRepository.searchByTenantId(
                tenantId, null, null, null, null, null, null,
                null, false, null, false, null,
                null, ProductStatus.ARCHIVED, true, "preferred supplier",
                "DEFAULT_SUPPLIER", "CONTAINS", "BUSINESS_CODE_ASC",
                pageable))
                .thenReturn(Page.empty(pageable));
        when(skuRepository.searchByTenantId(
                tenantId, null, null, null, null, null, null,
                null, false, null, false, null,
                null, ProductStatus.ARCHIVED, true, "factory_blue_m",
                "ORIGINAL_SKU", "EQUALS", "BUSINESS_CODE_ASC",
                pageable))
                .thenReturn(Page.empty(pageable));

        service.listSkus(
                tenantId, null, ProductStatus.ACTIVE, " MASTER-100 ",
                "MASTER_CODE", "STARTS_WITH", pageable);
        service.listSkus(
                tenantId, null, null, null, "NAME_EN", "EMPTY", pageable);
        service.listSkus(
                tenantId, null, null, null, categoryId,
                developerMemberId, developerAssistantMemberId,
                salesMemberId, artMemberId, creatorId,
                createdFrom, createdTo,
                "INVENTORY_SKU", "STARTS_WITH",
                "CREATED_AT", true, pageable);
        service.listSkus(
                tenantId, null, null, " Preferred Supplier ",
                "DEFAULT_SUPPLIER", "CONTAINS", pageable);
        service.listSkus(
                tenantId, null, null, " FACTORY_BLUE_M ",
                "ORIGINAL_SKU", "EQUALS", pageable);

        verify(skuRepository).searchByTenantId(
                tenantId, null, null, null, null, null, null,
                null, false, null, false, null,
                ProductStatus.ACTIVE,
                ProductStatus.ARCHIVED, true, "master-100",
                "MASTER_CODE", "STARTS_WITH", "BUSINESS_CODE_ASC",
                pageable);
        verify(skuRepository).searchByTenantId(
                tenantId, null, null, null, null, null, null,
                null, false, null, false, null,
                null, ProductStatus.ARCHIVED, true, "",
                "NAME_EN", "EMPTY", "BUSINESS_CODE_ASC", pageable);
        verify(skuRepository).searchByTenantId(
                tenantId, null, categoryId, developerMemberId,
                developerAssistantMemberId, salesMemberId, artMemberId,
                creatorId, true, createdFrom, true, createdTo, null,
                ProductStatus.ARCHIVED, false, "",
                "INVENTORY_SKU", "STARTS_WITH", "CREATED_AT_DESC",
                pageable);
        verify(skuRepository).searchByTenantId(
                tenantId, null, null, null, null, null, null,
                null, false, null, false, null,
                null, ProductStatus.ARCHIVED, true, "preferred supplier",
                "DEFAULT_SUPPLIER", "CONTAINS", "BUSINESS_CODE_ASC",
                pageable);
        verify(skuRepository).searchByTenantId(
                tenantId, null, null, null, null, null, null,
                null, false, null, false, null,
                null, ProductStatus.ARCHIVED, true, "factory_blue_m",
                "ORIGINAL_SKU", "EQUALS", "BUSINESS_CODE_ASC",
                pageable);
        assertThatThrownBy(() -> service.listSkus(
                tenantId, null, null, "value", "NAME_EN", "REGEX",
                pageable)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.listSkus(
                tenantId, null, null, "value", "ALL", "STARTS_WITH",
                pageable)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.listSkus(
                tenantId, null, null, null, "INVENTORY_SKU",
                "STARTS_WITH", "SALES_42", false, pageable))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.listSkus(
                tenantId, null, null, null,
                categoryId, developerMemberId, developerAssistantMemberId,
                salesMemberId, artMemberId, creatorId,
                createdTo, createdFrom,
                "INVENTORY_SKU", "STARTS_WITH",
                "BUSINESS_CODE", false, pageable))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void inventorySkuListBatchesTenantScopedMasterIdentity() {
        UUID tenantId = UUID.randomUUID();
        UUID spuId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        PageRequest pageable = PageRequest.of(0, 50);
        ProductSpu parent = new ProductSpu(
                tenantId, "MASTER_BLUE", "Blue shirt", null, null);
        ReflectionTestUtils.setField(parent, "id", spuId);
        ProductSku sku = new ProductSku(
                tenantId, spuId, "SKU_BLUE_M", "Blue shirt M", null);
        ReflectionTestUtils.setField(sku, "id", skuId);
        ProductSpuImage image = productImage(
                tenantId, spuId, UUID.randomUUID());
        ProductSkuRepository.SkuCreatorProjection creator =
                mock(ProductSkuRepository.SkuCreatorProjection.class);
        when(skuRepository.searchByTenantId(
                tenantId, null, null, null, null, null, null,
                null, false, null, false, null,
                null, ProductStatus.ARCHIVED,
                false, "", "INVENTORY_SKU", "STARTS_WITH",
                "BUSINESS_CODE_ASC", pageable))
                .thenReturn(new PageImpl<>(List.of(sku), pageable, 1));
        when(spuRepository.findByTenantIdAndIdIn(
                eq(tenantId),
                argThat(ids -> ids.equals(Set.of(spuId)))))
                .thenReturn(List.of(parent));
        when(spuImageRepository.findAllByTenantIdAndSpuIdIn(
                eq(tenantId),
                argThat(ids -> ids.equals(Set.of(spuId)))))
                .thenReturn(List.of(image));
        when(creator.getSkuId()).thenReturn(skuId);
        when(creator.getCreatorName()).thenReturn("Creator");
        when(skuRepository.creatorsByTenantIdAndSkuIdIn(
                tenantId, Set.of(skuId)))
                .thenReturn(List.of(creator));

        Page<ProductCenterService.SkuWithMasterIdentity> result =
                service.listSkusWithMasterIdentity(
                        tenantId, null, null, null, "INVENTORY_SKU",
                        "STARTS_WITH", pageable);

        assertThat(result.getContent()).singleElement().satisfies(item -> {
            assertThat(item.sku()).isSameAs(sku);
            assertThat(item.master()).isSameAs(parent);
            assertThat(item.thumbnail()).isSameAs(image);
            assertThat(item.creatorName()).isEqualTo("Creator");
        });
        verify(spuRepository).findByTenantIdAndIdIn(
                tenantId, Set.of(spuId));
        verify(spuImageRepository).findAllByTenantIdAndSpuIdIn(
                tenantId, Set.of(spuId));
        verify(skuRepository).creatorsByTenantIdAndSkuIdIn(
                tenantId, Set.of(skuId));
    }

    @Test
    void delegatesOnlyWhitelistedMetricOrderingsToTheTenantScopedQuery() {
        UUID tenantId = UUID.randomUUID();
        PageRequest pageable = PageRequest.of(0, 50);
        when(spuRepository.searchMasterByTenantId(
                tenantId, null, ProductStatus.ARCHIVED.name(), false, "", "ALL",
                null, null, null, null, null, "SALES_42", false, pageable))
                .thenReturn(Page.empty(pageable));

        service.listSpus(tenantId, null, null, "ALL", null, null, null,
                null, null, "SALES_42", false, pageable);

        verify(spuRepository).searchMasterByTenantId(
                tenantId, null, ProductStatus.ARCHIVED.name(), false, "", "ALL",
                null, null, null, null, null, "SALES_42", false, pageable);
        assertThatThrownBy(() -> service.listSpus(tenantId, null, null, "ALL",
                null, null, null, null, null, "inventory desc", false,
                pageable)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void listingCreationIsIdempotentForSameReferenceAndSkuButConflictsForDifferentSku() {
        UUID tenantId = UUID.randomUUID(); UUID shopId = UUID.randomUUID(); UUID skuId = UUID.randomUUID();
        ProductListing existing = existingListing(tenantId, shopId, skuId);
        setUpActiveListingInputs(tenantId, shopId, skuId);
        when(listingRepository.findByTenantIdAndShopIdAndExternalListingRefAndExternalVariantRef(tenantId, shopId, "listing-1", null))
                .thenReturn(Optional.of(existing));
        assertThat(service.createListing(actor(tenantId), shopId, skuId,
                "listing-1", null, null, null)).isSameAs(existing);
        verify(listingRepository, never()).save(any());

        when(listingRepository.findByTenantIdAndShopIdAndExternalListingRefAndExternalVariantRef(tenantId, shopId, "listing-1", null))
                .thenReturn(Optional.of(existingListing(tenantId, shopId, UUID.randomUUID())));
        assertThatThrownBy(() -> service.createListing(actor(tenantId), shopId,
                skuId, "listing-1", null, null, null))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void refusesStaleUpdateAndSpuArchiveWhileActiveSkuExists() {
        UUID tenantId = UUID.randomUUID(); UUID spuId = UUID.randomUUID();
        ProductSpu spu = new ProductSpu(tenantId, "SPU_ONE", "One", null, null);
        ReflectionTestUtils.setField(spu, "version", 2L);
        when(spuRepository.findForUpdateByIdAndTenantId(spuId, tenantId))
                .thenReturn(Optional.of(spu));
        when(spuRepository.findByIdAndTenantId(spuId, tenantId)).thenReturn(Optional.of(spu));
        assertThatThrownBy(() -> service.updateSpu(actor(tenantId), spuId, 1,
                values("Changed", null, null, null), ProductStatus.ACTIVE, null))
                .isInstanceOf(ConflictException.class);
        when(skuRepository.existsByTenantIdAndSpuIdAndStatusNot(tenantId, spuId, ProductStatus.ARCHIVED)).thenReturn(true);
        assertThatThrownBy(() -> service.archiveSpu(
                actor(tenantId), spuId, 2)).isInstanceOf(ConflictException.class);
    }

    @Test
    void redactsSensitiveMetadataBeforeSavingListing() {
        UUID tenantId = UUID.randomUUID(); UUID shopId = UUID.randomUUID(); UUID skuId = UUID.randomUUID();
        setUpActiveListingInputs(tenantId, shopId, skuId);
        when(listingRepository.findByTenantIdAndShopIdAndExternalListingRefAndExternalVariantRef(any(), any(), any(), any())).thenReturn(Optional.empty());
        when(listingRepository.save(any())).thenAnswer(invocation -> {
            ProductListing listing = invocation.getArgument(0);
            ReflectionTestUtils.setField(listing, "id", UUID.randomUUID());
            return listing;
        });
        ProductListing saved = service.createListing(actor(tenantId), shopId,
                skuId, "listing-1", null, null,
                "Authorization: Bearer secret-token");
        assertThat(saved.getMetadataNote()).doesNotContain("secret-token");
    }

    @Test
    void reportsAnExistingMasterCodeWithTheSpecificConflictType() {
        UUID tenantId = UUID.randomUUID();
        when(spuRepository.existsByTenantIdAndBusinessCode(
                tenantId, "SPU_DUPLICATE")).thenReturn(true);

        assertThatThrownBy(() -> service.createSpu(
                actor(tenantId),
                "spu_duplicate",
                values("重复商品", null, null, null),
                List.of()))
                .isInstanceOf(
                        ProductSpuBusinessCodeConflictException.class);
    }

    @Test
    void createsSpuFoundationWithTrimmedIndependentFieldsAndStableCodes() {
        UUID tenantId = UUID.randomUUID();
        when(spuRepository.existsByTenantIdAndBusinessCode(
                tenantId,
                "SPU_FOUNDATION")).thenReturn(false);
        when(spuRepository.save(any())).thenAnswer(invocation -> {
            ProductSpu spu = invocation.getArgument(0);
            ReflectionTestUtils.setField(spu, "id", UUID.randomUUID());
            return spu;
        });

        var result = service.createSpu(
                actor(tenantId),
                "spu_foundation",
                values(
                        "  中文名称  ",
                        "  English name  ",
                        null,
                        "  confidential business note  "),
                List.of(
                        ProductSensitiveAttributeCode.FLAMMABLE,
                        ProductSensitiveAttributeCode.BATTERY,
                        ProductSensitiveAttributeCode.FLAMMABLE));

        assertThat(result.spu().getName()).isEqualTo("中文名称");
        assertThat(result.spu().getNameZh()).isEqualTo("中文名称");
        assertThat(result.spu().getNameEn()).isEqualTo("English name");
        assertThat(result.spu().getProductNote())
                .isEqualTo("confidential business note");
        assertThat(result.sensitiveAttributeCodes()).containsExactly(
                ProductSensitiveAttributeCode.BATTERY,
                ProductSensitiveAttributeCode.FLAMMABLE);
        verify(spuRepository).flush();
        verify(spuSensitiveAttributeRepository)
                .replaceByTenantIdAndSpuId(
                        eq(tenantId),
                        eq(result.spu().getId()),
                        eq(result.sensitiveAttributeCodes()));

        var audit = org.mockito.ArgumentCaptor.forClass(
                cn.xzkj.erp.iam.audit.SecurityAuditEvent.class);
        verify(auditRecorder).recordAtomically(audit.capture());
        assertThat(audit.getValue().details().get("changedFields"))
                .contains("productNote")
                .doesNotContain("confidential business note");
        assertThat(audit.getValue().details().values())
                .noneMatch(value -> value.contains("confidential business note"));
    }

    @Test
    void legacySpuUpdatePreservesV43FieldsAndAttributes() {
        UUID tenantId = UUID.randomUUID();
        UUID spuId = UUID.randomUUID();
        ProductSpu spu = new ProductSpu(
                tenantId,
                "SPU_COMPAT",
                "旧名称",
                "English",
                null,
                "Independent note",
                null, null, null, null, null, 5000,
                null, null, null,
                null, null, null, null,
                null, null, null, null, null);
        ReflectionTestUtils.setField(spu, "id", spuId);
        when(spuRepository.findForUpdateByIdAndTenantId(spuId, tenantId))
                .thenReturn(Optional.of(spu));
        when(spuRepository.save(spu)).thenReturn(spu);
        when(spuSensitiveAttributeRepository.findByTenantIdAndSpuId(
                tenantId,
                spuId)).thenReturn(List.of(
                        ProductSensitiveAttributeCode.MAGNETIC));

        ProductSpu updated = service.updateSpu(
                actor(tenantId),
                spuId,
                0,
                values("新名称", null, null, null),
                ProductStatus.ACTIVE,
                null).spu();

        assertThat(updated.getNameZh()).isEqualTo("新名称");
        assertThat(updated.getNameEn()).isEqualTo("English");
        assertThat(updated.getProductNote()).isEqualTo("Independent note");
        verify(spuSensitiveAttributeRepository, never())
                .replaceByTenantIdAndSpuId(any(), any(), any());
    }

    @Test
    void attributeOnlyUpdateFlushesAggregateVersionBeforeReplacingChildrenAndAuditing() {
        UUID tenantId = UUID.randomUUID();
        UUID spuId = UUID.randomUUID();
        ProductSpu spu = new ProductSpu(
                tenantId,
                "SPU_ATTRIBUTES",
                "中文名称",
                null,
                "Private note");
        ReflectionTestUtils.setField(spu, "id", spuId);
        when(spuRepository.findForUpdateByIdAndTenantId(spuId, tenantId))
                .thenReturn(Optional.of(spu));
        when(spuRepository.save(spu)).thenReturn(spu);
        when(spuSensitiveAttributeRepository.findByTenantIdAndSpuId(
                tenantId,
                spuId)).thenReturn(List.of(
                        ProductSensitiveAttributeCode.BATTERY));
        doAnswer(ignored -> {
            ReflectionTestUtils.setField(spu, "version", 1L);
            return null;
        }).when(spuRepository).flush();

        var result = service.updateSpu(
                actor(tenantId),
                spuId,
                0,
                values("中文名称", null, null, "Private note"),
                ProductStatus.ACTIVE,
                List.of(
                        ProductSensitiveAttributeCode.MAGNETIC,
                        ProductSensitiveAttributeCode.BATTERY));

        assertThat(result.spu().getVersion()).isOne();
        assertThat(result.spu().getSensitiveAttributesRevision()).isOne();
        assertThat(result.sensitiveAttributeCodes()).containsExactly(
                ProductSensitiveAttributeCode.BATTERY,
                ProductSensitiveAttributeCode.MAGNETIC);

        var ordered = inOrder(
                spuRepository,
                spuSensitiveAttributeRepository,
                auditRecorder);
        ordered.verify(spuRepository).findForUpdateByIdAndTenantId(
                spuId,
                tenantId);
        ordered.verify(spuSensitiveAttributeRepository)
                .findByTenantIdAndSpuId(tenantId, spuId);
        ordered.verify(spuRepository).save(spu);
        ordered.verify(spuRepository).flush();
        ordered.verify(spuSensitiveAttributeRepository)
                .replaceByTenantIdAndSpuId(
                        tenantId,
                        spuId,
                        result.sensitiveAttributeCodes());
        var audit = org.mockito.ArgumentCaptor.forClass(
                cn.xzkj.erp.iam.audit.SecurityAuditEvent.class);
        ordered.verify(auditRecorder).recordAtomically(audit.capture());
        assertThat(audit.getValue().details())
                .containsEntry("version", "1")
                .containsEntry("changedFields", "sensitiveAttributeCodes");
    }

    @Test
    void rejectsListingCreationForAnActiveNonShopifyPlatform() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        TenantShop shop = activeShop(tenantId);
        when(shopRepository.findByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(shop));
        when(platformRepository.findById(shop.getPlatformId()))
                .thenReturn(Optional.of(
                        new PlatformCatalogEntry("SHOPEE", "Shopee", null)));

        assertThatThrownBy(() -> service.createListing(
                actor(tenantId), shopId, skuId,
                "listing-1", null, null, null))
                .isInstanceOf(ConflictException.class)
                .hasMessage("Listings can only be created for active Shopify shops");

        verify(skuRepository, never()).findByIdAndTenantId(any(), any());
        verify(listingRepository, never()).save(any());
    }

    @Test
    void rejectsListingCreationWhenTheShopPlatformCatalogIsMissing() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        TenantShop shop = activeShop(tenantId);
        when(shopRepository.findByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(shop));
        when(platformRepository.findById(shop.getPlatformId()))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.createListing(
                actor(tenantId), shopId, skuId,
                "listing-1", null, null, null))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessage("Shop platform was not found");

        verify(skuRepository, never()).findByIdAndTenantId(any(), any());
        verify(listingRepository, never()).save(any());
    }

    @Test
    void rejectsListingCreationWhenTheShopifyCatalogIsArchived() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        TenantShop shop = activeShop(tenantId);
        PlatformCatalogEntry shopify =
                new PlatformCatalogEntry("SHOPIFY", "Shopify", null);
        shopify.archive();
        when(shopRepository.findByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(shop));
        when(platformRepository.findById(shop.getPlatformId()))
                .thenReturn(Optional.of(shopify));

        assertThatThrownBy(() -> service.createListing(
                actor(tenantId), shopId, skuId,
                "listing-1", null, null, null))
                .isInstanceOf(ConflictException.class)
                .hasMessage("Listings can only be created for active Shopify shops");

        verify(skuRepository, never()).findByIdAndTenantId(any(), any());
        verify(listingRepository, never()).save(any());
    }

    @Test
    void treatsACrossTenantListingShopAsNotFoundBeforeReadingItsPlatform() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        when(shopRepository.findByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.createListing(
                actor(tenantId), shopId, skuId,
                "listing-1", null, null, null))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessage("Shop was not found");

        verify(platformRepository, never()).findById(any());
        verify(skuRepository, never()).findByIdAndTenantId(any(), any());
        verify(listingRepository, never()).save(any());
    }

    @Test
    void checksInventoryOwnedGuardBeforeArchivingSku() {
        UUID tenantId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        ProductSku sku = new ProductSku(
                tenantId, UUID.randomUUID(), "SKU_ONE", "One", null);
        ReflectionTestUtils.setField(sku, "id", skuId);
        when(skuRepository.findForUpdateByIdAndTenantId(skuId, tenantId))
                .thenReturn(Optional.of(sku));
        when(listingRepository.existsByTenantIdAndSkuIdAndStatusNot(
                tenantId, skuId, cn.xzkj.erp.product.domain.ListingStatus.ARCHIVED))
                .thenReturn(false);
        when(skuRepository.save(sku)).thenReturn(sku);

        service.archiveSku(actor(tenantId), skuId, 0);

        verify(inventoryArchiveGuard)
                .requireSkuHasZeroBalance(tenantId, skuId);
        verify(skuRepository).save(sku);
    }

    @Test
    void persistsExtendedSkuFieldsOnlyAgainstAnActiveTenantWarehouse() {
        UUID tenantId = UUID.randomUUID();
        UUID spuId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        ProductSpu spu = new ProductSpu(tenantId, "SPU_ONE", "One", null, null);
        ReflectionTestUtils.setField(spu, "id", spuId);
        Warehouse warehouse = new Warehouse(tenantId, "WH_MAIN", "主仓");
        ReflectionTestUtils.setField(warehouse, "id", warehouseId);
        when(spuRepository.findByIdAndTenantId(spuId, tenantId)).thenReturn(Optional.of(spu));
        when(skuRepository.existsByTenantIdAndBusinessCode(tenantId, "SKU_COST")).thenReturn(false);
        when(warehouseRepository.findByIdAndTenantId(warehouseId, tenantId)).thenReturn(Optional.of(warehouse));
        when(skuRepository.save(any())).thenAnswer(invocation -> {
            ProductSku entity = invocation.getArgument(0);
            ReflectionTestUtils.setField(entity, "id", UUID.randomUUID());
            return entity;
        });

        ProductSku saved = service.createSkuWithValues(actor(tenantId), spuId, "SKU_COST",
                new ProductCenterService.SkuValues("成本 SKU", "Cost SKU", "蓝色",
                        "12.3400", "CNY", warehouseId));

        assertThat(saved.getNameEn()).isEqualTo("Cost SKU");
        assertThat(saved.getUnitCost()).hasToString("12.3400");
        assertThat(saved.getCurrencyCode()).isEqualTo("CNY");
        assertThat(saved.getDefaultWarehouseId()).isEqualTo(warehouseId);
        assertThat(saved.getDefaultWarehouseNameSnapshot()).isEqualTo("主仓");
    }

    private void setUpActiveListingInputs(UUID tenantId, UUID shopId, UUID skuId) {
        TenantShop shop = activeShop(tenantId);
        ProductSku sku = new ProductSku(tenantId, UUID.randomUUID(), "SKU_ONE", "One", null);
        when(shopRepository.findByIdAndTenantId(shopId, tenantId)).thenReturn(Optional.of(shop));
        when(platformRepository.findById(shop.getPlatformId())).thenReturn(Optional.of(
                new PlatformCatalogEntry("SHOPIFY", "Shopify", null)));
        when(skuRepository.findByIdAndTenantId(skuId, tenantId)).thenReturn(Optional.of(sku));
        when(spuRepository.findByIdAndTenantId(sku.getSpuId(), tenantId))
                .thenReturn(Optional.of(new ProductSpu(tenantId, "SPU_ONE", "One", null, null)));
    }
    private static TenantShop activeShop(UUID tenantId) {
        return new TenantShop(
                tenantId, UUID.randomUUID(), "shop", "Shop");
    }
    private static ProductListing existingListing(UUID tenantId, UUID shopId, UUID skuId) {
        return new ProductListing(tenantId, shopId, UUID.randomUUID(), skuId, "listing-1", null, null, null);
    }
    private static ProductActor actor(UUID tenantId) {
        return new ProductActor(
                tenantId, UUID.randomUUID(), null, null, "127.0.0.1");
    }

    private static ProductCenterService.SpuValues values(
            String name,
            String nameEn,
            String brandName,
            String productNote) {
        return new ProductCenterService.SpuValues(
                name, name, nameEn, brandName, productNote,
                null, null, null, null, null, null, null, null,
                null, null, null, null);
    }
    private static ProductSkuRepository.SkuCountProjection summary(UUID spuId, long total, long active) {
        return new ProductSkuRepository.SkuCountProjection() {
            public UUID getSpuId() { return spuId; }
            public long getSkuCount() { return total; }
            public long getActiveSkuCount() { return active; }
        };
    }

    private static ProductSpuImage productImage(
            UUID tenantId,
            UUID spuId,
            UUID imageId) {
        ProductSpuImage image = new ProductSpuImage(
                tenantId,
                spuId,
                new ProductSpuImage.StoredImage(
                        "a".repeat(32) + ".png",
                        "image/png",
                        ".png",
                        1,
                        "b".repeat(64),
                        1,
                        1),
                0,
                true,
                "TENANT_USER",
                UUID.randomUUID());
        ReflectionTestUtils.setField(image, "id", imageId);
        return image;
    }
}
