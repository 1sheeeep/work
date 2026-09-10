package cn.xzkj.erp.platform.connector;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;

class DeterministicFakeChannelConnectorGatewayTest {

    private static final UUID TENANT =
            UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID SHOP =
            UUID.fromString("22222222-2222-4222-8222-222222222222");
    private static final Instant NOW = Instant.parse("2026-07-30T12:00:00Z");

    private final DeterministicFakeChannelConnectorGateway gateway =
            new DeterministicFakeChannelConnectorGateway(
                    Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    void exposesAnHonestFailureRetryAndRevokeFlowWithoutCredentials() {
        assertThat(gateway.snapshot(TENANT, SHOP).shopify().status())
                .isEqualTo(ConnectionStatus.NOT_CONNECTED);
        assertThat(gateway.snapshot(TENANT, SHOP).shopifyScopes())
                .isNotEmpty()
                .allMatch(scope -> scope.status()
                        == ChannelConnectorGateway.ShopifyScopeCoverageStatus.REQUESTED);

        var failed = gateway.authorizeShopify(TENANT, SHOP);
        assertThat(failed.mode()).isEqualTo(
                ChannelConnectorGateway.ConnectorMode.DETERMINISTIC_FAKE);
        assertThat(failed.shopify().status()).isEqualTo(ConnectionStatus.FAILED);
        assertThat(failed.shopify().safeErrorCode())
                .isEqualTo("CONNECTION_TIMEOUT");

        var connected = gateway.retryShopify(TENANT, SHOP);
        assertThat(connected.shopify().status()).isEqualTo(ConnectionStatus.CONNECTED);
        assertThat(connected.activity()).extracting(
                ChannelConnectorGateway.ChannelActivity::action)
                .containsExactly("shopify.retry", "shopify.authorize");

        var revoked = gateway.uninstallShopify(TENANT, SHOP);
        assertThat(revoked.shopify().status()).isEqualTo(ConnectionStatus.REVOKED);
    }

    @Test
    void returnsShopifyProductCatalogOnlyAfterConnectionIsRecovered() {
        var disconnected = gateway.fetchShopifyProductCatalog(
                TENANT,
                SHOP,
                new ChannelConnectorGateway.ProductCatalogRequest(
                        50, null, null));
        assertThat(disconnected.connectionStatus())
                .isEqualTo(ConnectionStatus.NOT_CONNECTED);
        assertThat(disconnected.products()).isEmpty();

        gateway.retryShopify(TENANT, SHOP);
        var page = gateway.fetchShopifyProductCatalog(
                TENANT,
                SHOP,
                new ChannelConnectorGateway.ProductCatalogRequest(
                        1, null, "SKU-001"));

        assertThat(page.mode()).isEqualTo(
                ChannelConnectorGateway.ConnectorMode.DETERMINISTIC_FAKE);
        assertThat(page.connectionStatus()).isEqualTo(ConnectionStatus.CONNECTED);
        assertThat(page.products()).hasSize(1);
        assertThat(page.products().getFirst().externalListingRef())
                .isEqualTo("gid://shopify/Product/1001");
        assertThat(page.products().getFirst().variants().getFirst().sku())
                .isEqualTo("SKU-001");
        assertThat(page.products().getFirst().variants().getFirst()
                .inventoryItemRef()).isEqualTo("gid://shopify/InventoryItem/3001");
    }

    @Test
    void returnsShopifyOrderCatalogOnlyAfterConnectionIsRecovered() {
        var disconnected = gateway.fetchShopifyOrderCatalog(
                TENANT,
                SHOP,
                new ChannelConnectorGateway.OrderCatalogRequest(
                        50, null, null));
        assertThat(disconnected.connectionStatus())
                .isEqualTo(ConnectionStatus.NOT_CONNECTED);
        assertThat(disconnected.orders()).isEmpty();

        gateway.retryShopify(TENANT, SHOP);
        var page = gateway.fetchShopifyOrderCatalog(
                TENANT,
                SHOP,
                new ChannelConnectorGateway.OrderCatalogRequest(
                        1, null, "SKU-001"));

        assertThat(page.mode()).isEqualTo(
                ChannelConnectorGateway.ConnectorMode.DETERMINISTIC_FAKE);
        assertThat(page.connectionStatus()).isEqualTo(ConnectionStatus.CONNECTED);
        assertThat(page.orders()).hasSize(1);
        assertThat(page.orders().getFirst().externalOrderRef())
                .isEqualTo("gid://shopify/Order/5001");
        assertThat(page.orders().getFirst().lineItems().getFirst().sku())
                .isEqualTo("SKU-001");
        assertThat(page.orders().getFirst().lineItems().getFirst()
                .inventoryItemRef()).isEqualTo("gid://shopify/InventoryItem/3001");
    }
}
