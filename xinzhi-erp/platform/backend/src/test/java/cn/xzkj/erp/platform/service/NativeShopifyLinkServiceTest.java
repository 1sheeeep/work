package cn.xzkj.erp.platform.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import cn.xzkj.erp.iam.persistence.IamAssignmentStore;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.NativeShopifyLinkPreview;
import cn.xzkj.erp.platform.connector.ConnectorUnavailableException;
import cn.xzkj.erp.platform.domain.PlatformCatalogEntry;
import cn.xzkj.erp.platform.domain.TenantShop;
import cn.xzkj.erp.platform.repository.PlatformCatalogRepository;
import cn.xzkj.erp.platform.repository.TenantShopRepository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.SimpleTransactionStatus;

class NativeShopifyLinkServiceTest {
    final UUID tenant = UUID.randomUUID(), user = UUID.randomUUID(), platformId = UUID.randomUUID(), shopId = UUID.randomUUID();
    final String proof = "A".repeat(43), domain = "native-link-test.myshopify.com";
    final ShopCenterActor actor = new ShopCenterActor(tenant, user, null, "native-test", "127.0.0.1");
    final ChannelConnectorGateway connector = mock(ChannelConnectorGateway.class);
    final PlatformCatalogRepository platforms = mock(PlatformCatalogRepository.class);
    final TenantShopRepository shops = mock(TenantShopRepository.class);
    final ShopCenterService shopCenter = mock(ShopCenterService.class);
    final ShopChannelService channels = mock(ShopChannelService.class);
    final IamAssignmentStore assignments = mock(IamAssignmentStore.class);
    final PermissionRepository permissions = mock(PermissionRepository.class);
    final PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
    final NativeShopifyLinkService service = new NativeShopifyLinkService(connector, platforms, shops,
            shopCenter, channels, assignments, permissions, transactions);
    final TenantShop shop = new TenantShop(tenant, platformId, domain, "Verified shop");

    @BeforeEach void fixture() {
        var platform = new PlatformCatalogEntry("SHOPIFY", "Shopify", null);
        ReflectionTestUtils.setField(platform, "id", platformId);
        ReflectionTestUtils.setField(shop, "id", shopId);
        when(platforms.findByCode("SHOPIFY")).thenReturn(Optional.of(platform));
        when(platforms.findForUpdateById(platformId)).thenReturn(Optional.of(platform));
        when(assignments.existsUserWithSystemRoleCode(tenant, user, "tenant_admin")).thenReturn(true);
        when(permissions.findCodesByTenantIdAndUserId(tenant, user))
                .thenReturn(List.of("shop:authorization:write", "shop:write"));
        when(connector.previewNativeShopifyLink(proof)).thenReturn(new NativeShopifyLinkPreview(
                domain, "Verified shop", List.of("read_products"), Instant.now().plusSeconds(600)));
        when(shops.findForUpdateByIdAndTenantId(shopId, tenant)).thenReturn(Optional.of(shop));
        when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
    }

    @Test void previewIsReadOnlyAndLimitedToTheNativeTenant() {
        assertThat(service.preview(actor, proof).existingShop()).isNull();
        verify(shops).findByTenantIdAndPlatformIdAndExternalShopRef(tenant, platformId, domain);
        verifyNoInteractions(shopCenter, channels, transactions);
        verify(connector, never()).confirmNativeShopifyLink(any(), any(), any(), any(), any());
    }

    @Test void rejectsEmployeesEvenWithFeaturePermissionAndRejectsSystemImpersonation() {
        when(assignments.existsUserWithSystemRoleCode(tenant, user, "tenant_admin")).thenReturn(false);
        assertThatThrownBy(() -> service.preview(actor, proof)).isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> service.prepare(new ShopCenterActor(tenant, user, UUID.randomUUID(), "test", null), proof))
                .isInstanceOf(AccessDeniedException.class);
        verifyNoInteractions(connector, shops);
    }

    @Test void rechecksRevokedAuthorizationPermissionBeforeConfirm() {
        when(permissions.findCodesByTenantIdAndUserId(tenant, user)).thenReturn(List.of("shop:write"));
        assertThatThrownBy(() -> service.confirm(actor, shopId, proof)).isInstanceOf(AccessDeniedException.class);
        verifyNoInteractions(connector, shops);
    }

    @Test void commitsTheCanonicalShopBeforeAnyRemoteOwnershipChange() {
        when(shopCenter.createShopWithDisplayName(actor, platformId, domain, "Verified shop"))
                .thenReturn(new ShopCenterService.ShopWithAuthorization(shop, null));
        var prepared = service.prepare(actor, proof);
        assertThat(prepared.shopId()).isEqualTo(shopId);
        verify(transactions).getTransaction(argThat(definition ->
                definition.getPropagationBehavior() == TransactionDefinition.PROPAGATION_REQUIRES_NEW));
        var order = inOrder(shopCenter, transactions, connector);
        order.verify(shopCenter).createShopWithDisplayName(actor, platformId, domain, "Verified shop");
        order.verify(transactions).commit(any());
        verify(connector, never()).confirmNativeShopifyLink(any(), any(), any(), any(), any());
    }

    @Test void repeatedPrepareReusesExistingShopWithoutCreationPermission() {
        when(permissions.findCodesByTenantIdAndUserId(tenant, user)).thenReturn(List.of("shop:authorization:write"));
        when(shops.findByTenantIdAndPlatformIdAndExternalShopRef(tenant, platformId, domain)).thenReturn(Optional.of(shop));
        assertThat(service.prepare(actor, proof).shopId()).isEqualTo(shopId);
        assertThat(service.prepare(actor, proof).shopId()).isEqualTo(shopId);
        verifyNoInteractions(shopCenter);
    }

    @Test void noCreationWithoutShopWriteAndNoRevivalOfArchivedShop() {
        when(permissions.findCodesByTenantIdAndUserId(tenant, user)).thenReturn(List.of("shop:authorization:write"));
        assertThatThrownBy(() -> service.prepare(actor, proof)).isInstanceOf(AccessDeniedException.class);
        shop.archive();
        when(shops.findByTenantIdAndPlatformIdAndExternalShopRef(tenant, platformId, domain)).thenReturn(Optional.of(shop));
        assertThatThrownBy(() -> service.prepare(actor, proof)).isInstanceOf(ConflictException.class);
        verifyNoInteractions(shopCenter);
    }

    @Test void confirmUsesLockedServerIdentityAndRetriesWithoutPreview() {
        var snapshot = mock(ChannelConnectorGateway.ChannelSnapshot.class);
        when(connector.confirmNativeShopifyLink(tenant, shopId, user, domain, proof)).thenReturn(snapshot);
        assertThat(service.confirm(actor, shopId, proof).shopId()).isEqualTo(shopId);
        assertThat(service.confirm(actor, shopId, proof).shopId()).isEqualTo(shopId);
        verify(connector, never()).previewNativeShopifyLink(any());
        verify(channels, times(2)).recordNativeShopifyLink(actor, shopId, snapshot);
        verifyNoInteractions(shopCenter);
    }

    @Test void neverConfirmsForeignShopsOrProjectsUnknownRemoteResults() {
        when(shops.findForUpdateByIdAndTenantId(shopId, tenant)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.confirm(actor, shopId, proof)).isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(connector);
        when(shops.findForUpdateByIdAndTenantId(shopId, tenant)).thenReturn(Optional.of(shop));
        when(connector.confirmNativeShopifyLink(tenant, shopId, user, domain, proof)).thenThrow(new ConnectorUnavailableException());
        assertThatThrownBy(() -> service.confirm(actor, shopId, proof)).isInstanceOf(ConnectorUnavailableException.class);
        verifyNoInteractions(channels, shopCenter);
        verify(shops, never()).save(any());
    }
}
