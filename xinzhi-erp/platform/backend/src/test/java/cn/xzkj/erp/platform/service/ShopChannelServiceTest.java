package cn.xzkj.erp.platform.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ChannelSnapshot;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Connection;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectorMode;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyAuthorizationStart;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyPermissionScope;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyScopeCoverageStatus;
import cn.xzkj.erp.platform.domain.AuthorizationStatus;
import cn.xzkj.erp.platform.domain.ShopAuthorization;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.domain.TenantShop;
import cn.xzkj.erp.platform.service.ShopCenterService.ShopWithAuthorization;

class ShopChannelServiceTest {

    private static final UUID TENANT = UUID.fromString(
            "11111111-1111-4111-8111-111111111111");
    private static final UUID USER = UUID.fromString(
            "22222222-2222-4222-8222-222222222222");
    private static final UUID SHOP = UUID.fromString(
            "33333333-3333-4333-8333-333333333333");
    private static final Instant CHECKED_AT = Instant.parse(
            "2026-08-02T00:00:00Z");

    private ShopCenterService shopCenterService;
    private ChannelConnectorGateway connector;
    private SecurityAuditRecorder auditRecorder;
    private ShopChannelService service;
    private ShopCenterActor actor;
    private TenantShop shop;
    private ShopAuthorization authorization;

    @BeforeEach
    void setUp() {
        shopCenterService = mock(ShopCenterService.class);
        connector = mock(ChannelConnectorGateway.class);
        auditRecorder = mock(SecurityAuditRecorder.class);
        service = new ShopChannelService(
                shopCenterService, connector, auditRecorder);
        actor = new ShopCenterActor(
                TENANT, USER, null, "request-1", "127.0.0.1");
        shop = mock(TenantShop.class);
        authorization = mock(ShopAuthorization.class);
        when(shop.getId()).thenReturn(SHOP);
        when(shop.getStatus()).thenReturn(ShopStatus.ACTIVE);
        when(shop.getExternalShopRef())
                .thenReturn("demo.myshopify.com");
        when(shopCenterService.getShop(TENANT, SHOP))
                .thenReturn(new ShopWithAuthorization(shop, authorization));
    }

    @Test
    void projectsAuthorizationStartAsPendingWithoutCredentialMaterial() {
        ChannelSnapshot pending = snapshot(
                ConnectionStatus.PENDING,
                List.of(new ShopifyPermissionScope(
                        "read_orders",
                        "orders",
                        ShopifyScopeCoverageStatus.REQUESTED)));
        String authorizationUrl =
                "https://connector.example/shopify/oauth/authorize?grant="
                        + "A".repeat(43);
        when(connector.startShopifyAuthorization(
                TENANT, SHOP, "demo.myshopify.com"))
                .thenReturn(new ShopifyAuthorizationStart(
                        pending, authorizationUrl));

        service.authorizeShopify(actor, SHOP);

        verify(shopCenterService).updateAuthorization(
                actor,
                SHOP,
                AuthorizationStatus.PENDING,
                null,
                "demo.myshopify.com",
                Set.of(),
                null,
                null,
                CHECKED_AT,
                null);
    }

    @Test
    void rejectsShopifyActionsForAuthorizationFreeInternalShops() {
        when(authorization.getStatus())
                .thenReturn(AuthorizationStatus.NOT_REQUIRED);

        assertThatThrownBy(() -> service.authorizeShopify(actor, SHOP))
                .isInstanceOf(ConflictException.class)
                .hasMessage("Shopify channel actions require a Shopify shop");

        verify(connector, never()).startShopifyAuthorization(
                any(), any(), any());
    }

    @Test
    void projectsConnectedConnectorScopesIntoTheShopAuthorization() {
        when(authorization.getStatus())
                .thenReturn(AuthorizationStatus.NOT_AUTHORIZED);
        ChannelSnapshot connected = snapshot(
                ConnectionStatus.CONNECTED,
                List.of(
                        new ShopifyPermissionScope(
                                "read_orders",
                                "orders",
                                ShopifyScopeCoverageStatus.GRANTED),
                        new ShopifyPermissionScope(
                                "write_orders",
                                "orders",
                                ShopifyScopeCoverageStatus.MISSING)));
        when(connector.snapshot(TENANT, SHOP)).thenReturn(connected);

        service.get(actor, SHOP);

        verify(shopCenterService).updateAuthorization(
                actor,
                SHOP,
                AuthorizationStatus.AUTHORIZED,
                "credential://shopify-connector/" + SHOP,
                "demo.myshopify.com",
                Set.of("read_orders"),
                CHECKED_AT,
                null,
                CHECKED_AT,
                null);
    }

    @Test
    void projectsVerifiedConnectorShopNameBeforeAuthorizationMetadata() {
        when(authorization.getStatus())
                .thenReturn(AuthorizationStatus.NOT_AUTHORIZED);
        ChannelSnapshot connected = new ChannelSnapshot(
                ConnectorMode.XZ_ERP_APP,
                new Connection(
                        ConnectionStatus.CONNECTED,
                        null,
                        null,
                        CHECKED_AT,
                        "Example Store",
                        "demo.myshopify.com"),
                List.of(new ShopifyPermissionScope(
                        "read_orders",
                        "orders",
                        ShopifyScopeCoverageStatus.GRANTED)),
                List.of());
        when(connector.snapshot(TENANT, SHOP)).thenReturn(connected);

        service.get(actor, SHOP);

        verify(shopCenterService).applyConnectorShopIdentity(
                actor,
                SHOP,
                "demo.myshopify.com",
                "Example Store");
    }

    @Test
    void doesNotRewriteAnUnchangedConnectedProjection() {
        when(authorization.getStatus())
                .thenReturn(AuthorizationStatus.AUTHORIZED);
        when(authorization.getCredentialReference()).thenReturn(
                "credential://shopify-connector/" + SHOP);
        when(authorization.getProviderAccountRef())
                .thenReturn("demo.myshopify.com");
        when(authorization.getScopeSummary()).thenReturn("read_orders");
        ChannelSnapshot connected = snapshot(
                ConnectionStatus.CONNECTED,
                List.of(new ShopifyPermissionScope(
                        "read_orders",
                        "orders",
                        ShopifyScopeCoverageStatus.GRANTED)));
        when(connector.snapshot(TENANT, SHOP)).thenReturn(connected);

        service.get(actor, SHOP);

        verify(shopCenterService, never()).updateAuthorization(
                any(),
                any(),
                any(),
                any(),
                any(),
                any(),
                any(),
                any(),
                any(),
                any());
    }

    @Test
    void uninstallProjectsRevokedStateWithoutKeepingCredentialReference() {
        when(authorization.getStatus())
                .thenReturn(AuthorizationStatus.AUTHORIZED);
        when(connector.uninstallShopify(TENANT, SHOP))
                .thenReturn(snapshot(ConnectionStatus.REVOKED, List.of()));

        service.uninstallShopify(actor, SHOP);

        verify(connector).uninstallShopify(TENANT, SHOP);
        verify(shopCenterService).updateAuthorization(
                actor,
                SHOP,
                AuthorizationStatus.REVOKED,
                null,
                "demo.myshopify.com",
                Set.of(),
                null,
                null,
                CHECKED_AT,
                null);
    }

    @Test
    void retryResetsAbandonedPendingGrantToNotAuthorized() {
        when(authorization.getStatus())
                .thenReturn(AuthorizationStatus.PENDING);
        when(connector.retryShopify(TENANT, SHOP))
                .thenReturn(snapshot(ConnectionStatus.NOT_CONNECTED, List.of()));

        service.retryShopify(actor, SHOP);

        verify(shopCenterService).updateAuthorization(
                actor,
                SHOP,
                AuthorizationStatus.NOT_AUTHORIZED,
                null,
                "demo.myshopify.com",
                Set.of(),
                null,
                null,
                CHECKED_AT,
                null);
    }

    private static ChannelSnapshot snapshot(
            ConnectionStatus status,
            List<ShopifyPermissionScope> scopes) {
        return new ChannelSnapshot(
                ConnectorMode.XZ_ERP_APP,
                new Connection(status, null, null, CHECKED_AT),
                scopes,
                List.of());
    }
}
