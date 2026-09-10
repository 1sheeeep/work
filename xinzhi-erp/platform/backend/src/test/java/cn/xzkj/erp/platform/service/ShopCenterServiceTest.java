package cn.xzkj.erp.platform.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
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
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.PageImpl;
import org.springframework.test.util.ReflectionTestUtils;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.domain.AuthorizationStatus;
import cn.xzkj.erp.platform.domain.PlatformCatalogEntry;
import cn.xzkj.erp.platform.domain.ShopAuthorization;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.domain.ShopSyncJob;
import cn.xzkj.erp.platform.domain.SyncJobStatus;
import cn.xzkj.erp.platform.domain.SyncJobType;
import cn.xzkj.erp.platform.domain.TenantShop;
import cn.xzkj.erp.platform.repository.PlatformCatalogRepository;
import cn.xzkj.erp.platform.repository.ShopAuthorizationRepository;
import cn.xzkj.erp.platform.repository.ShopSyncJobRepository;
import cn.xzkj.erp.platform.repository.TenantShopRepository;

@ExtendWith(MockitoExtension.class)
class ShopCenterServiceTest {

    @Mock
    private PlatformCatalogRepository platformRepository;
    @Mock
    private TenantShopRepository shopRepository;
    @Mock
    private ShopAuthorizationRepository authorizationRepository;
    @Mock
    private ShopSyncJobRepository syncJobRepository;
    @Mock
    private SecurityAuditRecorder auditRecorder;

    private ShopCenterService service;

    @BeforeEach
    void setUp() {
        service = new ShopCenterService(
                platformRepository,
                shopRepository,
                authorizationRepository,
                syncJobRepository,
                auditRecorder
        );
    }

    @Test
    void rejectsShopCreationWhenPlatformIsMissing() {
        UUID tenantId = UUID.randomUUID();
        UUID platformId = UUID.randomUUID();
        when(platformRepository.findForUpdateById(platformId))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.createShopWithDisplayName(
                actor(tenantId),
                platformId,
                "external-shop",
                "Test Shop"
        )).isInstanceOf(ResourceNotFoundException.class)
                .hasMessage("Platform was not found");

        verify(platformRepository).findForUpdateById(platformId);
        verify(platformRepository, never()).findById(platformId);
        verify(shopRepository, never()).save(any());
        verify(authorizationRepository, never()).save(any());
    }

    @Test
    void createsShopForActiveShopifyUnderTheAuthenticatedTenant() {
        UUID tenantId = UUID.randomUUID();
        UUID platformId = UUID.randomUUID();
        PlatformCatalogEntry platform = new PlatformCatalogEntry(
                "SHOPIFY",
                "Shopify",
                null
        );
        when(platformRepository.findForUpdateById(platformId))
                .thenReturn(Optional.of(platform));
        when(shopRepository.save(any())).thenAnswer(invocation -> {
            TenantShop shop = invocation.getArgument(0);
            ReflectionTestUtils.setField(shop, "id", UUID.randomUUID());
            return shop;
        });
        when(authorizationRepository.save(any()))
                .thenAnswer(invocation -> invocation.getArgument(0));

        var created = service.createShopWithDisplayName(
                actor(tenantId),
                platformId,
                "external-shop",
                "Test Shop"
        );

        assertThat(created.shop().getTenantId()).isEqualTo(tenantId);
        assertThat(created.shop().getPlatformId()).isEqualTo(platformId);
        assertThat(created.authorization().getTenantId()).isEqualTo(tenantId);
        verify(platformRepository).findForUpdateById(platformId);
        verify(platformRepository, never()).findById(platformId);
    }

    @Test
    void createsPendingShopNameWithoutAUserSuppliedDisplayName() {
        UUID tenantId = UUID.randomUUID();
        UUID platformId = UUID.randomUUID();
        PlatformCatalogEntry platform = new PlatformCatalogEntry(
                "SHOPIFY", "Shopify", null);
        when(platformRepository.findForUpdateById(platformId))
                .thenReturn(Optional.of(platform));
        when(shopRepository.save(any())).thenAnswer(invocation -> {
            TenantShop saved = invocation.getArgument(0);
            ReflectionTestUtils.setField(saved, "id", UUID.randomUUID());
            return saved;
        });
        when(authorizationRepository.save(any()))
                .thenAnswer(invocation -> invocation.getArgument(0));

        var created = service.createShop(
                actor(tenantId), platformId, " Example-Store ");

        assertThat(created.shop().getExternalShopRef())
                .isEqualTo("example-store.myshopify.com");
        assertThat(created.shop().getDisplayName())
                .isEqualTo("待授权 · example-store");
    }

    @Test
    void createsMultipleNamedInternalShopsWithoutAuthorization() {
        UUID tenantId = UUID.randomUUID();
        UUID platformId = UUID.randomUUID();
        PlatformCatalogEntry platform = new PlatformCatalogEntry(
                "OTHER", "其他平台", null);
        when(platformRepository.findForUpdateById(platformId))
                .thenReturn(Optional.of(platform));
        when(shopRepository.save(any())).thenAnswer(invocation -> {
            TenantShop saved = invocation.getArgument(0);
            ReflectionTestUtils.setField(saved, "id", UUID.randomUUID());
            return saved;
        });
        when(authorizationRepository.save(any()))
                .thenAnswer(invocation -> invocation.getArgument(0));

        var first = service.createShop(
                actor(tenantId), platformId, null, " 线下订单一店 ");
        var second = service.createShop(
                actor(tenantId), platformId, null, "线下订单二店");

        assertThat(first.shop().getDisplayName()).isEqualTo("线下订单一店");
        assertThat(second.shop().getDisplayName()).isEqualTo("线下订单二店");
        assertThat(first.shop().getExternalShopRef()).startsWith("internal-");
        assertThat(second.shop().getExternalShopRef())
                .isNotEqualTo(first.shop().getExternalShopRef());
        assertThat(first.authorization().getStatus())
                .isEqualTo(AuthorizationStatus.NOT_REQUIRED);
        assertThat(first.authorization().getCredentialReference()).isNull();
    }

    @Test
    void appliesOnlyMatchingConnectorShopIdentity() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        TenantShop shop = new TenantShop(
                tenantId,
                UUID.randomUUID(),
                "example-store.myshopify.com",
                "待授权 · example-store");
        ReflectionTestUtils.setField(shop, "id", shopId);
        ReflectionTestUtils.setField(shop, "version", 3L);
        when(shopRepository.findForUpdateByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(shop));
        when(shopRepository.save(shop)).thenReturn(shop);

        TenantShop renamed = service.applyConnectorShopIdentity(
                actor(tenantId),
                shopId,
                "example-store.myshopify.com",
                " Example Store ");

        assertThat(renamed.getDisplayName()).isEqualTo("Example Store");
        assertThatThrownBy(() -> service.applyConnectorShopIdentity(
                actor(tenantId),
                shopId,
                "other.myshopify.com",
                "Other Store"))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void updatesShopBindingAndLifecycleWithAnExactVersion() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        UUID platformId = UUID.randomUUID();
        TenantShop shop = new TenantShop(tenantId, platformId, "old-ref", "Old name");
        ShopAuthorization authorization = new ShopAuthorization(tenantId, shopId);
        ReflectionTestUtils.setField(shop, "id", shopId);
        ReflectionTestUtils.setField(shop, "version", 4L);
        when(shopRepository.findForUpdateByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(shop));
        when(shopRepository.existsByTenantIdAndPlatformIdAndExternalShopRef(
                tenantId, platformId, "new-ref"
        )).thenReturn(false);
        when(shopRepository.save(shop)).thenReturn(shop);
        when(authorizationRepository.findByTenantIdAndShopId(tenantId, shopId))
                .thenReturn(Optional.of(authorization));

        var updated = service.updateShop(
                actor(tenantId),
                shopId,
                4,
                " new-ref ",
                " New name ",
                ShopStatus.SUSPENDED
        );

        assertThat(updated.shop().getExternalShopRef()).isEqualTo("new-ref");
        assertThat(updated.shop().getDisplayName()).isEqualTo("New name");
        assertThat(updated.shop().getStatus()).isEqualTo(ShopStatus.SUSPENDED);
        assertThat(updated.authorization()).isSameAs(authorization);
        verify(shopRepository).save(shop);
    }

    @Test
    void rejectsStaleOrArchivedShopUpdatesBeforeChangingTheResource() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        TenantShop shop = new TenantShop(
                tenantId,
                UUID.randomUUID(),
                "shop-ref",
                "Shop"
        );
        ReflectionTestUtils.setField(shop, "id", shopId);
        ReflectionTestUtils.setField(shop, "version", 2L);
        when(shopRepository.findForUpdateByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(shop));

        assertThatThrownBy(() -> service.updateShop(
                actor(tenantId),
                shopId,
                1,
                "shop-ref",
                "Changed",
                ShopStatus.ACTIVE
        )).isInstanceOf(ConflictException.class);

        assertThatThrownBy(() -> service.updateShop(
                actor(tenantId),
                shopId,
                2,
                "shop-ref",
                "Changed",
                ShopStatus.ARCHIVED
        )).isInstanceOf(IllegalArgumentException.class);

        verify(shopRepository, never()).save(any());
    }

    @Test
    void rejectsActiveNonShopifyWithoutPersistingAChildFact() {
        UUID platformId = UUID.randomUUID();
        PlatformCatalogEntry platform = new PlatformCatalogEntry(
                "WOOCOMMERCE",
                "WooCommerce",
                null
        );
        when(platformRepository.findForUpdateById(platformId))
                .thenReturn(Optional.of(platform));

        assertThatThrownBy(() -> service.createShopWithDisplayName(
                actor(UUID.randomUUID()),
                platformId,
                "external-shop",
                "Test Shop"
        )).isInstanceOf(ConflictException.class)
                .hasMessage("Shops can only be created under an active Shopify platform");

        verify(shopRepository, never()).save(any());
        verify(authorizationRepository, never()).save(any());
    }

    @Test
    void rejectsArchivedShopifyWithoutPersistingAChildFact() {
        UUID platformId = UUID.randomUUID();
        PlatformCatalogEntry platform = new PlatformCatalogEntry(
                "SHOPIFY",
                "Shopify",
                null
        );
        platform.archive();
        when(platformRepository.findForUpdateById(platformId))
                .thenReturn(Optional.of(platform));

        assertThatThrownBy(() -> service.createShopWithDisplayName(
                actor(UUID.randomUUID()),
                platformId,
                "external-shop",
                "Test Shop"
        )).isInstanceOf(ConflictException.class)
                .hasMessage("Shops can only be created under an active Shopify platform");

        verify(shopRepository, never()).save(any());
        verify(authorizationRepository, never()).save(any());
    }

    @Test
    void storesOnlyValidatedCredentialReferenceAndRedactedError() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        TenantShop shop = new TenantShop(tenantId, UUID.randomUUID(), "external", "Shop");
        ShopAuthorization authorization = new ShopAuthorization(tenantId, shopId);
        ReflectionTestUtils.setField(authorization, "id", UUID.randomUUID());
        when(shopRepository.findForUpdateByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(shop));
        when(authorizationRepository.findByTenantIdAndShopId(tenantId, shopId))
                .thenReturn(Optional.of(authorization));
        when(authorizationRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        ShopAuthorization result = service.updateAuthorization(
                actor(tenantId),
                shopId,
                AuthorizationStatus.AUTHORIZED,
                "vault://erp/tenant/shop#token",
                "provider-account",
                Set.of("orders.read"),
                Instant.parse("2026-07-28T00:00:00Z"),
                Instant.parse("2026-08-28T00:00:00Z"),
                null,
                "Authorization: Bearer plaintext-token"
        );

        assertThat(result.getCredentialReference()).startsWith("vault://");
        assertThat(result.getErrorSummary()).doesNotContain("plaintext-token");
        var callOrder = inOrder(shopRepository, authorizationRepository);
        callOrder.verify(shopRepository)
                .findForUpdateByIdAndTenantId(shopId, tenantId);
        callOrder.verify(authorizationRepository)
                .findByTenantIdAndShopId(tenantId, shopId);
        verify(shopRepository).findForUpdateByIdAndTenantId(shopId, tenantId);
        verify(shopRepository, never()).findByIdAndTenantId(shopId, tenantId);
    }

    @Test
    void refusesToArchivePlatformWhileItHasNonArchivedShops() {
        UUID platformId = UUID.randomUUID();
        PlatformCatalogEntry platform = new PlatformCatalogEntry(
                "SANDBOX",
                "Sandbox",
                null
        );
        when(platformRepository.findForUpdateById(platformId))
                .thenReturn(Optional.of(platform));
        when(shopRepository.existsByPlatformIdAndStatusNot(
                platformId,
                cn.xzkj.erp.platform.domain.ShopStatus.ARCHIVED
        )).thenReturn(true);

        assertThatThrownBy(() -> service.archivePlatform(
                actor(UUID.randomUUID()), platformId))
                .isInstanceOf(ConflictException.class);

        var callOrder = inOrder(platformRepository, shopRepository);
        callOrder.verify(platformRepository).findForUpdateById(platformId);
        callOrder.verify(shopRepository).existsByPlatformIdAndStatusNot(
                platformId, ShopStatus.ARCHIVED);
        verify(platformRepository).findForUpdateById(platformId);
        verify(platformRepository, never()).findById(platformId);
    }

    @Test
    void loadsAuthorizationMetadataInOneTenantScopedBatchPerShopPage() {
        UUID tenantId = UUID.randomUUID();
        TenantShop firstShop = new TenantShop(tenantId, UUID.randomUUID(), "first", "First");
        TenantShop secondShop = new TenantShop(tenantId, UUID.randomUUID(), "second", "Second");
        UUID firstShopId = UUID.randomUUID();
        UUID secondShopId = UUID.randomUUID();
        ReflectionTestUtils.setField(firstShop, "id", firstShopId);
        ReflectionTestUtils.setField(secondShop, "id", secondShopId);
        ShopAuthorization firstAuthorization = new ShopAuthorization(tenantId, firstShopId);
        ShopAuthorization secondAuthorization = new ShopAuthorization(tenantId, secondShopId);

        when(shopRepository.findAllByTenantIdAndStatusNotOrderByDisplayNameAscIdAsc(
                eq(tenantId),
                eq(cn.xzkj.erp.platform.domain.ShopStatus.ARCHIVED),
                any()
        )).thenReturn(new PageImpl<>(List.of(firstShop, secondShop), PageRequest.of(0, 50), 2));
        when(authorizationRepository.findAllByTenantIdAndShopIdIn(eq(tenantId), any()))
                .thenReturn(List.of(firstAuthorization, secondAuthorization));

        assertThat(service.listShops(tenantId, false, PageRequest.of(0, 50)).getContent()).hasSize(2);

        verify(authorizationRepository).findAllByTenantIdAndShopIdIn(
                eq(tenantId),
                eq(List.of(firstShopId, secondShopId))
        );
        verify(authorizationRepository, never()).findByTenantIdAndShopId(any(), any());
    }

    @Test
    void appliesEveryReadOnlyFilterInsideTheAuthenticatedTenantScope() {
        UUID tenantId = UUID.randomUUID();
        UUID platformId = UUID.randomUUID();
        PageRequest page = PageRequest.of(1, 25);
        when(shopRepository.findAllForTenantShopList(
                eq(tenantId),
                eq(false),
                eq(ShopStatus.ARCHIVED),
                eq("mixed case"),
                eq(platformId),
                eq(ShopStatus.ACTIVE),
                eq(AuthorizationStatus.AUTHORIZED),
                eq(page)
        )).thenReturn(new PageImpl<>(List.of(), page, 0));

        assertThat(service.listShops(
                tenantId,
                false,
                "mixed case",
                platformId,
                ShopStatus.ACTIVE,
                AuthorizationStatus.AUTHORIZED,
                page
        ).getTotalElements()).isZero();

        verify(shopRepository).findAllForTenantShopList(
                tenantId,
                false,
                ShopStatus.ARCHIVED,
                "mixed case",
                platformId,
                ShopStatus.ACTIVE,
                AuthorizationStatus.AUTHORIZED,
                page
        );
    }

    @Test
    void preventsDuplicateOpenSyncJobsForSameShopAndType() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        TenantShop shop = new TenantShop(tenantId, UUID.randomUUID(), "external", "Shop");
        when(shopRepository.findForUpdateByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(shop));
        when(syncJobRepository.existsByTenantIdAndShopIdAndJobTypeAndStatusIn(
                eq(tenantId),
                eq(shopId),
                eq(cn.xzkj.erp.platform.domain.SyncJobType.ORDERS),
                any()
        )).thenReturn(true);

        assertThatThrownBy(() -> service.createSyncJob(
                actor(tenantId),
                shopId,
                cn.xzkj.erp.platform.domain.SyncJobType.ORDERS
        )).isInstanceOf(ConflictException.class);

        var callOrder = inOrder(shopRepository, syncJobRepository);
        callOrder.verify(shopRepository)
                .findForUpdateByIdAndTenantId(shopId, tenantId);
        callOrder.verify(syncJobRepository)
                .existsByTenantIdAndShopIdAndJobTypeAndStatusIn(
                        eq(tenantId), eq(shopId), eq(SyncJobType.ORDERS), any());
        verify(shopRepository).findForUpdateByIdAndTenantId(shopId, tenantId);
        verify(shopRepository, never()).findByIdAndTenantId(shopId, tenantId);
        verify(syncJobRepository, never()).save(any());
    }

    @Test
    void archivesShopOnlyAfterLockingItsTenantScopedParent() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        TenantShop shop = new TenantShop(
                tenantId, UUID.randomUUID(), "external", "Shop");
        ReflectionTestUtils.setField(shop, "id", shopId);
        ShopAuthorization authorization = new ShopAuthorization(tenantId, shopId);
        when(shopRepository.findForUpdateByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(shop));
        when(authorizationRepository.findByTenantIdAndShopId(tenantId, shopId))
                .thenReturn(Optional.of(authorization));
        when(syncJobRepository.findAllByTenantIdAndShopIdAndStatusIn(
                eq(tenantId), eq(shopId), any())).thenReturn(List.of());
        when(shopRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(authorizationRepository.save(any()))
                .thenAnswer(invocation -> invocation.getArgument(0));

        assertThat(service.archiveShop(actor(tenantId), shopId).shop().getStatus())
                .isEqualTo(ShopStatus.ARCHIVED);

        var callOrder = inOrder(
                shopRepository, authorizationRepository, syncJobRepository);
        callOrder.verify(shopRepository)
                .findForUpdateByIdAndTenantId(shopId, tenantId);
        callOrder.verify(authorizationRepository)
                .findByTenantIdAndShopId(tenantId, shopId);
        callOrder.verify(syncJobRepository)
                .findAllByTenantIdAndShopIdAndStatusIn(
                        eq(tenantId), eq(shopId), any());
        verify(shopRepository).findForUpdateByIdAndTenantId(shopId, tenantId);
        verify(shopRepository, never()).findByIdAndTenantId(shopId, tenantId);
    }

    @Test
    void rejectsShopDeletionUntilShopifyAuthorizationIsRevoked() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        TenantShop shop = new TenantShop(
                tenantId, UUID.randomUUID(), "external", "Shop");
        ShopAuthorization authorization = new ShopAuthorization(tenantId, shopId);
        authorization.update(
                AuthorizationStatus.AUTHORIZED,
                "credential://connector/token",
                "external",
                "read_orders",
                Instant.parse("2026-08-22T00:00:00Z"),
                null,
                null,
                null);
        when(shopRepository.findForUpdateByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(shop));
        when(authorizationRepository.findByTenantIdAndShopId(tenantId, shopId))
                .thenReturn(Optional.of(authorization));

        assertThatThrownBy(() -> service.archiveShop(actor(tenantId), shopId))
                .isInstanceOf(ConflictException.class);

        verify(shopRepository, never()).save(any());
        verify(authorizationRepository, never()).save(any());
        verify(syncJobRepository, never())
                .findAllByTenantIdAndShopIdAndStatusIn(any(), any(), any());
    }

    @Test
    void updatesSyncJobOnlyAfterLockingItsTenantScopedShopParent() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        UUID syncJobId = UUID.randomUUID();
        TenantShop shop = new TenantShop(
                tenantId, UUID.randomUUID(), "external", "Shop");
        ShopSyncJob job = new ShopSyncJob(tenantId, shopId, SyncJobType.ORDERS);
        ReflectionTestUtils.setField(job, "id", syncJobId);
        when(shopRepository.findForUpdateByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(shop));
        when(syncJobRepository.findByIdAndTenantIdAndShopId(
                syncJobId, tenantId, shopId)).thenReturn(Optional.of(job));
        when(syncJobRepository.save(any()))
                .thenAnswer(invocation -> invocation.getArgument(0));

        ShopSyncJob result = service.updateSyncJob(
                actor(tenantId),
                shopId,
                syncJobId,
                SyncJobStatus.CANCELLED,
                0,
                null,
                null,
                null
        );

        assertThat(result.getStatus()).isEqualTo(SyncJobStatus.CANCELLED);
        var callOrder = inOrder(shopRepository, syncJobRepository);
        callOrder.verify(shopRepository)
                .findForUpdateByIdAndTenantId(shopId, tenantId);
        callOrder.verify(syncJobRepository)
                .findByIdAndTenantIdAndShopId(syncJobId, tenantId, shopId);
        verify(shopRepository).findForUpdateByIdAndTenantId(shopId, tenantId);
        verify(shopRepository, never()).findByIdAndTenantId(shopId, tenantId);
    }

    @Test
    void tenantScopedWriteLockTreatsAnotherTenantsShopAsNotFound() {
        UUID authenticatedTenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        when(shopRepository.findForUpdateByIdAndTenantId(
                shopId, authenticatedTenantId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.createSyncJob(
                actor(authenticatedTenantId), shopId, SyncJobType.ORDERS))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessage("Shop was not found");

        verify(shopRepository).findForUpdateByIdAndTenantId(
                shopId, authenticatedTenantId);
        verify(shopRepository, never()).findByIdAndTenantId(
                shopId, authenticatedTenantId);
        verify(syncJobRepository, never())
                .existsByTenantIdAndShopIdAndJobTypeAndStatusIn(
                        any(), any(), any(), any());
    }

    @Test
    void tenantScopedShopLookupTreatsAnotherTenantAsNotFound() {
        UUID authenticatedTenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        when(shopRepository.findByIdAndTenantId(shopId, authenticatedTenantId))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getShop(authenticatedTenantId, shopId))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessage("Shop was not found");

        verify(shopRepository).findByIdAndTenantId(shopId, authenticatedTenantId);
        verify(authorizationRepository, never()).findByTenantIdAndShopId(any(), any());
    }

    private static ShopCenterActor actor(UUID tenantId) {
        return new ShopCenterActor(
                tenantId, UUID.randomUUID(), null, null, "127.0.0.1");
    }
}
