package cn.xzkj.erp.platform.connector;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;

import org.junit.jupiter.api.Test;

import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectorMode;

class UnconfiguredChannelConnectorGatewayTest {

    @Test
    void remainsHonestlyDisconnectedAndFailsClosedForWrites() {
        var gateway = new UnconfiguredChannelConnectorGateway();
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();

        var snapshot = gateway.snapshot(tenantId, shopId);
        assertThat(snapshot.mode()).isEqualTo(ConnectorMode.UNCONFIGURED);
        assertThat(snapshot.shopify().status()).isEqualTo(ConnectionStatus.NOT_CONNECTED);
        assertThatThrownBy(() -> gateway.authorizeShopify(tenantId, shopId))
                .isInstanceOf(ConnectorUnavailableException.class);
        assertThatThrownBy(() -> gateway.fetchShopifyProductCatalog(
                tenantId,
                shopId,
                new ChannelConnectorGateway.ProductCatalogRequest(
                        50, null, null)))
                .isInstanceOf(ConnectorUnavailableException.class);
        assertThatThrownBy(() -> gateway.fetchShopifyOrderCatalog(
                tenantId,
                shopId,
                new ChannelConnectorGateway.OrderCatalogRequest(
                        50, null, null)))
                .isInstanceOf(ConnectorUnavailableException.class);
        assertThatThrownBy(() -> gateway.fetchShopifyLocationCatalog(
                tenantId,
                shopId,
                new ChannelConnectorGateway.LocationCatalogRequest(
                        50, null)))
                .isInstanceOf(ConnectorUnavailableException.class);
    }
}
