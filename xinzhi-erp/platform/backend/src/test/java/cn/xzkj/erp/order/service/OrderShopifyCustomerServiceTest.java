package cn.xzkj.erp.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ChannelSnapshot;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Connection;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectorMode;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.CustomerCatalogPage;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.CustomerProfile;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Money;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyPermissionScope;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyScopeCoverageStatus;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;

class OrderShopifyCustomerServiceTest {

    private static final UUID TENANT =
            UUID.fromString("fa000000-0000-4000-8000-000000000001");
    private static final UUID USER =
            UUID.fromString("fa000000-0000-4000-8000-000000000002");
    private static final UUID SHOP =
            UUID.fromString("fa000000-0000-4000-8000-000000000003");
    private static final Instant NOW = Instant.parse("2026-08-15T08:00:00Z");

    private ChannelConnectorGateway connector;
    private SecurityAuditRecorder audit;
    private OrderShopifyCustomerService service;
    private OrderActor actor;

    @BeforeEach
    void setUp() {
        connector = mock(ChannelConnectorGateway.class);
        audit = mock(SecurityAuditRecorder.class);
        service = new OrderShopifyCustomerService(connector, audit);
        actor = new OrderActor(TENANT, USER, null, "request-1", "127.0.0.1");
    }

    @Test
    void returnsCustomersAndAuditsTheReadWithoutPersonalData() {
        when(connector.snapshot(TENANT, SHOP)).thenReturn(snapshot("read_customers"));
        var customer = new CustomerProfile(
                "gid://shopify/Customer/1", "1", "Mia Customer",
                "mia@example.com", "+15551234567", NOW, NOW, true,
                List.of("VIP"), "3", new Money("120.50", "USD"),
                null, null);
        var provider = new CustomerCatalogPage(
                ConnectorMode.XZ_ERP_APP, ConnectionStatus.CONNECTED,
                null, false, NOW, List.of(customer));
        when(connector.fetchShopifyCustomerCatalog(eq(TENANT), eq(SHOP), any()))
                .thenReturn(provider);

        assertThat(service.customers(
                actor, SHOP, 25, null, "mia@example.com"))
                .isSameAs(provider);

        var event = ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(audit).record(event.capture());
        assertThat(event.getValue().action())
                .isEqualTo("order.protected_customer_data.read");
        assertThat(event.getValue().details())
                .containsEntry("queryProvided", "true")
                .containsEntry("resultCount", "1");
        assertThat(event.getValue().details().toString())
                .doesNotContain("mia@example.com", "+15551234567");
    }

    @Test
    void rejectsCustomerReadWhenReadCustomersWasNotGranted() {
        when(connector.snapshot(TENANT, SHOP)).thenReturn(snapshot("read_orders"));

        assertThatThrownBy(() -> service.customers(
                actor, SHOP, 25, null, null))
                .isInstanceOf(ShopifyAuthorizationConflictException.class);

        verify(connector, never()).fetchShopifyCustomerCatalog(any(), any(), any());
        verify(audit, never()).record(any());
    }

    @Test
    void rejectsAConnectorPageThatExceedsTheRequestedLimit() {
        when(connector.snapshot(TENANT, SHOP)).thenReturn(snapshot("read_customers"));
        var customers = List.of(
                mock(CustomerProfile.class),
                mock(CustomerProfile.class));
        when(connector.fetchShopifyCustomerCatalog(eq(TENANT), eq(SHOP), any()))
                .thenReturn(new CustomerCatalogPage(
                        ConnectorMode.XZ_ERP_APP, ConnectionStatus.CONNECTED,
                        null, false, NOW, customers));

        assertThatThrownBy(() -> service.customers(
                actor, SHOP, 1, null, null))
                .isInstanceOf(ConflictException.class)
                .hasMessage("Shopify customer catalog is unavailable");
        verify(audit, never()).record(any());
    }

    private static ChannelSnapshot snapshot(String... scopes) {
        return new ChannelSnapshot(
                ConnectorMode.XZ_ERP_APP,
                new Connection(ConnectionStatus.CONNECTED, null, null, NOW),
                java.util.Arrays.stream(scopes).map(value ->
                        new ShopifyPermissionScope(
                                value, value, ShopifyScopeCoverageStatus.GRANTED))
                        .toList(),
                List.of());
    }
}
