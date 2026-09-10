package cn.xzkj.erp.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import cn.xzkj.erp.order.domain.OrderProfile;
import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.domain.TenantOrder;
import cn.xzkj.erp.order.repository.ShopifyOrderCancellationCommandRepository;
import cn.xzkj.erp.order.repository.ShopifyOrderCancellationCommandRepository.Reservation;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;
import cn.xzkj.erp.order.service.OrderShopifyCancellationService.CancellationCommand;
import cn.xzkj.erp.order.service.OrderShopifyCancellationService.NormalizedCommand;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ChannelSnapshot;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Connection;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectorMode;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderCancellationReason;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderCancellationRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderCancellationResult;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyPermissionScope;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyScopeCoverageStatus;
import cn.xzkj.erp.platform.connector.ConnectorUnavailableException;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;

class OrderShopifyCancellationServiceTest {
    private static final UUID TENANT = UUID.fromString("fd000000-0000-4000-8000-000000000001");
    private static final UUID USER = UUID.fromString("fd000000-0000-4000-8000-000000000002");
    private static final UUID SHOP = UUID.fromString("fd000000-0000-4000-8000-000000000003");
    private static final UUID ORDER = UUID.fromString("fd000000-0000-4000-8000-000000000004");
    private static final String ORDER_REF = "gid://shopify/Order/10";
    private static final Instant NOW = Instant.parse("2026-07-31T20:00:00Z");

    private ChannelConnectorGateway connector;
    private OrderCenterService orders;
    private ShopifyOrderCancellationCommandRepository commands;
    private OrderShopifyCancellationFinalizer finalizer;
    private OrderShopifyCancellationService service;
    private OrderActor actor;
    private OrderAggregate aggregate;

    @BeforeEach
    void setUp() {
        connector = mock(ChannelConnectorGateway.class);
        orders = mock(OrderCenterService.class);
        commands = mock(ShopifyOrderCancellationCommandRepository.class);
        finalizer = mock(OrderShopifyCancellationFinalizer.class);
        service = new OrderShopifyCancellationService(
                connector, orders, commands, finalizer);
        actor = new OrderActor(TENANT, USER, null, "request-1", "127.0.0.1");
        TenantOrder order = mock(TenantOrder.class);
        when(order.getShopId()).thenReturn(SHOP);
        when(order.getExternalOrderRef()).thenReturn(ORDER_REF);
        when(order.getStatus()).thenReturn(OrderStatus.RECEIVED);
        when(order.getVersion()).thenReturn(4L);
        aggregate = new OrderAggregate(order, OrderProfile.empty(), List.of(), List.of());
        when(orders.getOrder(actor, ORDER)).thenReturn(aggregate);
        when(connector.snapshot(TENANT, SHOP)).thenReturn(snapshot(true));
        when(commands.reserve(eq(TENANT), eq(SHOP), eq(ORDER), eq(ORDER_REF),
                eq(4L), eq(0L), eq("CUSTOMER"), eq(true), eq(true), eq(true),
                eq("web.cancel-10"), any()))
                .thenReturn(new Reservation(false, false, null, null));
    }

    @Test
    void cancelsAndFinalizesLocalState() {
        var provider = new OrderCancellationResult(
                ORDER_REF, OrderCancellationReason.CUSTOMER, NOW,
                "gid://shopify/Job/1", false, NOW);
        when(connector.cancelShopifyOrder(eq(TENANT), eq(SHOP), any()))
                .thenReturn(provider);
        when(finalizer.finalizeSucceeded(
                eq(actor), any(NormalizedCommand.class), eq(provider), any()))
                .thenReturn(aggregate);

        var result = service.cancel(actor, ORDER, command());

        assertThat(result.order()).isSameAs(aggregate);
        assertThat(result.cancelledAt()).isEqualTo(NOW);
        verify(connector).cancelShopifyOrder(TENANT, SHOP,
                new OrderCancellationRequest(
                        ORDER_REF, OrderCancellationReason.CUSTOMER,
                        "Buyer requested", true, true, true,
                        false, "web.cancel-10"));
    }

    @Test
    void uncertainRetryRequestsExactRecovery() {
        when(commands.reserve(eq(TENANT), eq(SHOP), eq(ORDER), eq(ORDER_REF),
                eq(4L), eq(0L), eq("CUSTOMER"), eq(true), eq(true), eq(true),
                eq("web.cancel-10"), any()))
                .thenReturn(new Reservation(true, false, null, null));
        when(connector.cancelShopifyOrder(eq(TENANT), eq(SHOP), any()))
                .thenThrow(new ConnectorUnavailableException());

        assertThatThrownBy(() -> service.cancel(actor, ORDER, command()))
                .isInstanceOf(ConflictException.class)
                .hasMessage("shopify_order_cancellation_uncertain");
        verify(connector).cancelShopifyOrder(TENANT, SHOP,
                new OrderCancellationRequest(
                        ORDER_REF, OrderCancellationReason.CUSTOMER,
                        "Buyer requested", true, true, true,
                        true, "web.cancel-10"));
        verify(commands).markUncertain(eq(TENANT), eq("web.cancel-10"), any());
    }

    @Test
    void missingWriteOrdersFailsBeforeReservation() {
        when(connector.snapshot(TENANT, SHOP)).thenReturn(snapshot(false));
        assertThatThrownBy(() -> service.cancel(actor, ORDER, command()))
                .isInstanceOf(ShopifyAuthorizationConflictException.class);
        verifyNoInteractions(commands);
    }

    private static CancellationCommand command() {
        return new CancellationCommand(
                OrderCancellationReason.CUSTOMER, "Buyer requested",
                true, true, true, "web.cancel-10");
    }

    private static ChannelSnapshot snapshot(boolean write) {
        var scopes = new java.util.ArrayList<>(List.of(scope("read_orders")));
        if (write) scopes.add(scope("write_orders"));
        return new ChannelSnapshot(
                ConnectorMode.XZ_ERP_APP,
                new Connection(ConnectionStatus.CONNECTED, null, null, NOW),
                scopes, List.of());
    }

    private static ShopifyPermissionScope scope(String value) {
        return new ShopifyPermissionScope(
                value, value, ShopifyScopeCoverageStatus.GRANTED);
    }
}
