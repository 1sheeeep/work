package cn.xzkj.erp.platform.connector;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.platform.api.StoreAppReadPreparationController;
import cn.xzkj.erp.platform.domain.PlatformCatalogEntry;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.domain.TenantShop;
import cn.xzkj.erp.platform.service.ShopCenterActor;
import cn.xzkj.erp.platform.service.ShopCenterService;

class StoreAppReadPreparationTest {
    static final UUID TENANT = UUID.fromString("11111111-1111-4111-8111-111111111111");
    static final UUID SHOP = UUID.fromString("22222222-2222-4222-8222-222222222222");
    static final String DOMAIN = "synthetic-preparation.myshopify.com";
    static final String TOKEN = "synthetic-service-credential-not-real-0001";
    static final String PREFIX = "erp.store-app-read-preparation.";
    static final String CONNECTION = """
        {"contractVersion":"shopify.connector.connection.v3",
         "tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222",
         "state":"CONNECTED","grantedScopes":["read_orders"],"shopName":"Synthetic shop",
         "shopDomain":"synthetic-preparation.myshopify.com","checkedAt":"2026-09-06T01:02:03Z"}
        """;
    static final String ORDERS = """
        {"contractVersion":"shopify.connector.order_catalog.v1",
         "tenantId":"11111111-1111-4111-8111-111111111111","shopId":"22222222-2222-4222-8222-222222222222",
         "state":"CONNECTED","orders":[],"pageInfo":{"hasNextPage":false,"endCursor":""},"fetchedAt":"2026-09-06T01:02:03Z"}
        """;

    @Test void preparationBeansAreAbsentByDefault() {
        new ApplicationContextRunner().withUserConfiguration(
                StoreAppReadPreparationService.class, StoreAppReadPreparationController.class)
                .run(context -> {
                    assertThat(context).doesNotHaveBean(StoreAppReadPreparationService.class);
                    assertThat(context).doesNotHaveBean(StoreAppReadPreparationController.class);
                });
    }

    @Test void enabledIncompleteConfigurationDoesNotCreateAnActiveFallback() {
        new ApplicationContextRunner().withUserConfiguration(StoreAppReadPreparationService.class)
                .withBean(ShopCenterService.class, () -> mock(ShopCenterService.class))
                .withPropertyValues(PREFIX + "enabled=true")
                .run(context -> assertThat(context).hasFailed());
    }

    @Test void bindingVersionMustBeExactAcrossJavaGoAndBrowserJson() {
        for (long version : new long[]{0, -1, 9_007_199_254_740_992L, Long.MAX_VALUE}) {
            assertThatThrownBy(() -> new XzErpAppChannelConnectorGateway.StoreAppReadBinding(TENANT, SHOP, version))
                    .isInstanceOf(IllegalArgumentException.class);
        }
        assertThat(new XzErpAppChannelConnectorGateway.StoreAppReadBinding(TENANT, SHOP, 9_007_199_254_740_991L).version())
                .isEqualTo(9_007_199_254_740_991L);
    }

    @Test void readsOnlyBoundShopAndNeverAdvertisesProductionReadiness() throws Exception {
        var requests = new AtomicInteger();
        var server = server(CONNECTION, ORDERS, "7", "CUSTOMER_SERVICE_STORE_APP_READ_ONLY", requests);
        try {
            var shops = shops();
            var service = new StoreAppReadPreparationService(environment(server), shops);
            var status = service.status(actor(), SHOP);
            var orders = service.orders(actor(), SHOP, 10, null);
            assertThat(status.readOnly()).isTrue();
            assertThat(status.productionReady()).isFalse();
            assertThat(status.bindingVersion()).isEqualTo(7);
            assertThat(status.snapshot().mode()).isEqualTo(ChannelConnectorGateway.ConnectorMode.CUSTOMER_SERVICE_STORE_APP_READ_ONLY);
            assertThat(orders.page().mode()).isEqualTo(ChannelConnectorGateway.ConnectorMode.CUSTOMER_SERVICE_STORE_APP_READ_ONLY);
            assertThat(orders.page().orders()).isEmpty();
            assertThat(requests.get()).isEqualTo(2);
            verify(shops, times(2)).getShop(TENANT, SHOP);
            verify(shops, times(2)).getPlatform(any());
            verifyNoMoreInteractions(shops);
        } finally { server.stop(0); }
    }

    @Test void bindingDomainAndShopStatusMustMatchBeforeNetworkRead() throws Exception {
        var requests = new AtomicInteger();
        var server = server(CONNECTION, ORDERS, "7", "CUSTOMER_SERVICE_STORE_APP_READ_ONLY", requests);
        try {
            for (String reason : new String[]{"domain", "status", "platform"}) {
                var shops = shops();
                var shop = shops.getShop(TENANT, SHOP).shop();
                switch (reason) {
                    case "domain" -> when(shop.getExternalShopRef()).thenReturn("other.myshopify.com");
                    case "status" -> when(shop.getStatus()).thenReturn(ShopStatus.SUSPENDED);
                    case "platform" -> when(shops.getPlatform(any())).thenReturn(new PlatformCatalogEntry("OTHER", "Other", null));
                    default -> throw new AssertionError();
                }
                var service = new StoreAppReadPreparationService(environment(server), shops);
                assertThatThrownBy(() -> service.status(actor(), SHOP)).isInstanceOf(ConnectorUnavailableException.class);
                assertThatThrownBy(() -> service.orders(actor(), SHOP, 10, null)).isInstanceOf(ConnectorUnavailableException.class);
            }
            assertThat(requests.get()).isZero();
        } finally { server.stop(0); }
    }

    @Test void crossTenantShopAndPlatformIdentityFailWithoutRepositoryOrNetwork() throws Exception {
        var requests = new AtomicInteger();
        var server = server(CONNECTION, ORDERS, "7", "CUSTOMER_SERVICE_STORE_APP_READ_ONLY", requests);
        try {
            var shops = mock(ShopCenterService.class);
            var service = new StoreAppReadPreparationService(environment(server), shops);
            assertThatThrownBy(() -> service.status(actor(), UUID.randomUUID())).isInstanceOf(ConnectorUnavailableException.class);
            assertThatThrownBy(() -> service.status(new ShopCenterActor(UUID.randomUUID(), UUID.randomUUID(), null, null, null), SHOP)).isInstanceOf(ConnectorUnavailableException.class);
            assertThatThrownBy(() -> service.status(new ShopCenterActor(TENANT, null, UUID.randomUUID(), null, null), SHOP)).isInstanceOf(ConnectorUnavailableException.class);
            assertThatThrownBy(() -> service.status(null, SHOP)).isInstanceOf(ConnectorUnavailableException.class);
            verifyNoInteractions(shops); assertThat(requests.get()).isZero();
        } finally { server.stop(0); }
    }

    @Test void responseSourceVersionAndIdentityCannotBeSubstituted() throws Exception {
        for (String reason : new String[]{"version", "provider", "identity", "domain", "unknown field"}) {
            String response = switch (reason) {
                case "identity" -> CONNECTION.replace(TENANT.toString(), UUID.randomUUID().toString());
                case "domain" -> CONNECTION.replace(DOMAIN, "other.myshopify.com");
                case "unknown field" -> CONNECTION.replace("\"state\":", "\"accessToken\":\"do-not-echo\",\"state\":");
                default -> CONNECTION;
            };
            var server = server(response, ORDERS, reason.equals("version") ? "6" : "7",
                    reason.equals("provider") ? "XZ_ERP_APP" : "CUSTOMER_SERVICE_STORE_APP_READ_ONLY", new AtomicInteger());
            try {
                var service = new StoreAppReadPreparationService(environment(server), shops());
                assertThatThrownBy(() -> service.status(actor(), SHOP)).isInstanceOf(ConnectorUnavailableException.class)
                        .hasMessageNotContaining("do-not-echo");
            } finally { server.stop(0); }
        }
    }

    @Test void adapterDoesNotAllowAnyWriteLifecycleOrOtherRead() throws Exception {
        var requests = new AtomicInteger();
        var server = server(CONNECTION, ORDERS, "7", "CUSTOMER_SERVICE_STORE_APP_READ_ONLY", requests);
        try {
            var reader = XzErpAppChannelConnectorGateway.storeAppReadPreparation(base(server), TOKEN,
                    new XzErpAppChannelConnectorGateway.StoreAppReadBinding(TENANT, SHOP, 7));
            assertThatThrownBy(() -> reader.uninstallShopify(TENANT, SHOP)).isInstanceOf(ConnectorUnavailableException.class);
            assertThatThrownBy(() -> reader.retryShopify(TENANT, SHOP)).isInstanceOf(ConnectorUnavailableException.class);
            assertThatThrownBy(() -> reader.startShopifyAuthorization(TENANT, SHOP, DOMAIN)).isInstanceOf(ConnectorUnavailableException.class);
            assertThatThrownBy(reader::listShopifyComplianceRequests).isInstanceOf(ConnectorUnavailableException.class);
            assertThatThrownBy(() -> reader.fetchShopifyProductCatalog(TENANT, SHOP, new ChannelConnectorGateway.ProductCatalogRequest(10,null,null))).isInstanceOf(ConnectorUnavailableException.class);
            assertThatThrownBy(() -> reader.snapshot(UUID.randomUUID(), SHOP)).isInstanceOf(ConnectorUnavailableException.class);
            assertThatThrownBy(() -> reader.fetchShopifyOrderCatalog(TENANT, SHOP, new ChannelConnectorGateway.OrderCatalogRequest(26,null,null))).isInstanceOf(ConnectorUnavailableException.class);
            assertThat(requests.get()).isZero();
        } finally { server.stop(0); }
    }

    @Test void preparationServiceTransactionsAreReadOnly() throws Exception {
        assertThat(StoreAppReadPreparationService.class.getMethod("status", ShopCenterActor.class, UUID.class)
                .getAnnotation(Transactional.class).readOnly()).isTrue();
        assertThat(StoreAppReadPreparationService.class.getMethod("orders", ShopCenterActor.class, UUID.class, int.class, String.class)
                .getAnnotation(Transactional.class).readOnly()).isTrue();
    }

    private static HttpServer server(String connection, String orders, String version, String provider, AtomicInteger calls) throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            calls.incrementAndGet();
            assertThat(exchange.getRequestMethod()).isEqualTo("POST");
            assertThat(exchange.getRequestHeaders().getFirst("X-XZ-ERP-Connector-Token")).isEqualTo(TOKEN);
            assertThat(exchange.getRequestHeaders().getFirst("X-XZ-Store-App-Binding-Version")).isEqualTo("7");
            assertThat(exchange.getRequestURI().getPath()).startsWith("/internal/v1/erp-store-app/shopify/");
            byte[] body = (exchange.getRequestURI().getPath().endsWith("/orders")
                    || exchange.getRequestURI().getPath().endsWith("/order-catalog") ? orders : connection).getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.getResponseHeaders().set("X-XZ-Shopify-Provider", provider);
            exchange.getResponseHeaders().set("X-XZ-Store-App-Binding-Version", version);
            exchange.sendResponseHeaders(200, body.length); exchange.getResponseBody().write(body); exchange.close();
        });
        server.start(); return server;
    }
    static String base(HttpServer server) { return "http://127.0.0.1:" + server.getAddress().getPort(); }
    static MockEnvironment environment(HttpServer server) {
        return new MockEnvironment().withProperty(PREFIX+"tenant-id",TENANT.toString()).withProperty(PREFIX+"shop-id",SHOP.toString())
                .withProperty(PREFIX+"shop-domain",DOMAIN).withProperty(PREFIX+"binding-version","7")
                .withProperty(PREFIX+"service-token",TOKEN).withProperty(PREFIX+"base-url",base(server));
    }
    static ShopCenterActor actor() { return new ShopCenterActor(TENANT, UUID.randomUUID(), null, null, null); }
    static ShopCenterService shops() {
        var shops = mock(ShopCenterService.class); var shop = mock(TenantShop.class);
        when(shop.getStatus()).thenReturn(ShopStatus.ACTIVE); when(shop.getExternalShopRef()).thenReturn(DOMAIN);
        when(shops.getShop(TENANT,SHOP)).thenReturn(new ShopCenterService.ShopWithAuthorization(shop,null));
        when(shops.getPlatform(any())).thenReturn(new PlatformCatalogEntry("SHOPIFY","Shopify",null));
        return shops;
    }
}
