package cn.xzkj.erp.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
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
import org.springframework.test.util.ReflectionTestUtils;

import cn.xzkj.erp.order.domain.OrderProfile;
import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.domain.TenantOrder;
import cn.xzkj.erp.order.repository.ShopifyOrderCommandRepository;
import cn.xzkj.erp.order.repository.ShopifyOrderCommandRepository.Reservation;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;
import cn.xzkj.erp.order.service.OrderShopifyShippingAddressService.ShippingAddressCommand;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ChannelSnapshot;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Connection;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectorMode;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.MailingAddress;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderShippingAddressUpdateRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderShippingAddressUpdateResult;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyPermissionScope;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyScopeCoverageStatus;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;

class OrderShopifyShippingAddressServiceTest {

    private final OrderCenterService orders = mock(OrderCenterService.class);
    private final ShopifyOrderCommandRepository commands =
            mock(ShopifyOrderCommandRepository.class);
    private final ChannelConnectorGateway connector =
            mock(ChannelConnectorGateway.class);
    private final OrderShopifyShippingAddressService service =
            new OrderShopifyShippingAddressService(orders, commands, connector);
    private UUID tenantId;
    private UUID shopId;
    private UUID orderId;
    private OrderActor actor;
    private OrderAggregate initial;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        shopId = UUID.randomUUID();
        orderId = UUID.randomUUID();
        actor = new OrderActor(
                tenantId, UUID.randomUUID(), null,
                "request-address-1", "127.0.0.1");
        initial = aggregate(3, OrderStatus.RECEIVED);
        when(orders.getOrder(actor, orderId)).thenReturn(initial);
        when(commands.reserve(
                eq(tenantId), eq(orderId), eq(shopId),
                eq(ShopifyOrderCommandRepository.ORDER_SHIPPING_ADDRESS_UPDATE),
                eq("address-command-1"), anyString()))
                .thenReturn(new Reservation(false, false, null));
        when(connector.snapshot(tenantId, shopId)).thenReturn(connectedSnapshot());
    }

    @Test
    void updatesProviderFirstThenPersistsNormalizedAddressAndCompletesCommand() {
        MailingAddress providerAddress = new MailingAddress(
                "Ada Lovelace", "Ada", "Lovelace", "Analytical Engines",
                "1 Main Street", null, "Toronto", "Ontario", "ON",
                "Canada", "CA", "A1A1A1", "+1 555 0100", List.of());
        when(connector.updateShopifyOrderShippingAddress(
                eq(tenantId), eq(shopId), any()))
                .thenReturn(new OrderShippingAddressUpdateResult(
                        providerAddress, Instant.parse("2026-07-31T10:00:00Z")));
        OrderAggregate updated = aggregate(4, OrderStatus.RECEIVED);
        when(orders.applyShopifyShippingAddressUpdate(
                eq(actor), eq(orderId), eq(3L), eq(0L),
                any(), any(), eq("address-command-1")))
                .thenReturn(updated);

        var result = service.update(actor, orderId, command(3));

        assertThat(result.order()).isSameAs(updated);
        assertThat(result.replayed()).isFalse();
        ArgumentCaptor<OrderShippingAddressUpdateRequest> providerCommand =
                ArgumentCaptor.forClass(OrderShippingAddressUpdateRequest.class);
        verify(connector).updateShopifyOrderShippingAddress(
                eq(tenantId), eq(shopId), providerCommand.capture());
        assertThat(providerCommand.getValue().externalOrderRef())
                .isEqualTo("gid://shopify/Order/123");
        assertThat(providerCommand.getValue().address().countryCode())
                .isEqualTo("CA");
        verify(commands).markSucceeded(
                eq(tenantId), eq("address-command-1"),
                anyString(), eq(4L));
    }

    @Test
    void completedIdempotentCommandReplaysWithoutCallingShopify() {
        when(commands.reserve(
                eq(tenantId), eq(orderId), eq(shopId),
                anyString(), eq("address-command-1"), anyString()))
                .thenReturn(new Reservation(true, true, 4L));

        var result = service.update(actor, orderId, command(3));

        assertThat(result.replayed()).isTrue();
        verify(connector, never()).updateShopifyOrderShippingAddress(
                any(), any(), any());
    }

    @Test
    void missingWriteScopeFailsClosedAndRecordsOnlySafeFailureCode() {
        when(connector.snapshot(tenantId, shopId)).thenReturn(new ChannelSnapshot(
                ConnectorMode.XZ_ERP_APP,
                new Connection(ConnectionStatus.CONNECTED, null, null, Instant.now()),
                List.of(new ShopifyPermissionScope(
                        "write_orders", "write", ShopifyScopeCoverageStatus.MISSING)),
                List.of()));

        assertThatThrownBy(() -> service.update(actor, orderId, command(3)))
                .isInstanceOf(ShopifyAuthorizationConflictException.class);

        verify(connector, never()).updateShopifyOrderShippingAddress(
                any(), any(), any());
        verify(commands).markFailed(
                eq(tenantId), eq("address-command-1"), anyString(),
                eq("SHOPIFY_AUTHORIZATION_CONFLICT"));
    }

    @Test
    void staleNewCommandNeverMutatesShopify() {
        assertThatThrownBy(() -> service.update(actor, orderId, command(2)))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("stale");
        verify(connector, never()).snapshot(any(), any());
        verify(connector, never()).updateShopifyOrderShippingAddress(
                any(), any(), any());
        verify(commands).markFailed(
                eq(tenantId), eq("address-command-1"), anyString(),
                eq("ORDER_STATE_CONFLICT"));
    }

    @Test
    void fulfillmentStartedOrderNeverMutatesShopify() {
        when(orders.getOrder(actor, orderId))
                .thenReturn(aggregate(3, OrderStatus.FULFILLING));

        assertThatThrownBy(() -> service.update(actor, orderId, command(3)))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("fulfillment");
        verify(connector, never()).updateShopifyOrderShippingAddress(
                any(), any(), any());
    }

    private OrderAggregate aggregate(long version, OrderStatus status) {
        TenantOrder order = new TenantOrder(
                tenantId, shopId, "gid://shopify/Order/123",
                "import-command", "a".repeat(64), "USD", null, 1,
                Instant.parse("2026-07-30T00:00:00Z"));
        ReflectionTestUtils.setField(order, "id", orderId);
        ReflectionTestUtils.setField(order, "version", version);
        ReflectionTestUtils.setField(order, "status", status);
        return new OrderAggregate(order, OrderProfile.empty(), List.of(), List.of());
    }

    private static ShippingAddressCommand command(long version) {
        return new ShippingAddressCommand(
                version, 0, "address-command-1", "Ada", "Lovelace",
                "Analytical Engines", "1 Main Street", null, "Toronto",
                "ON", "CA", "A1A1A1", "+1 555 0100");
    }

    private static ChannelSnapshot connectedSnapshot() {
        return new ChannelSnapshot(
                ConnectorMode.XZ_ERP_APP,
                new Connection(ConnectionStatus.CONNECTED, null, null, Instant.now()),
                List.of(new ShopifyPermissionScope(
                        "write_orders", "write", ShopifyScopeCoverageStatus.GRANTED)),
                List.of());
    }
}
