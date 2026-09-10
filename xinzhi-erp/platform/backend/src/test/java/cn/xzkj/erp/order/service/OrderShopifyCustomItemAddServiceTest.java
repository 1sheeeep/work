package cn.xzkj.erp.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
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

import cn.xzkj.erp.order.domain.OrderLine;
import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.domain.TenantOrder;
import cn.xzkj.erp.order.repository.ShopifyOrderCustomItemCommandRepository;
import cn.xzkj.erp.order.repository.ShopifyOrderCustomItemCommandRepository.Reservation;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;
import cn.xzkj.erp.order.service.OrderShopifyCustomItemAddService.AddCommand;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ChannelSnapshot;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Connection;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectorMode;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Money;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderAddCustomItemRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderAddCustomItemResult;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyPermissionScope;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyScopeCoverageStatus;
import cn.xzkj.erp.platform.connector.ConnectorUnavailableException;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;

class OrderShopifyCustomItemAddServiceTest {

    private static final UUID TENANT = UUID.fromString(
            "fb000000-0000-4000-8000-000000000001");
    private static final UUID USER = UUID.fromString(
            "fb000000-0000-4000-8000-000000000002");
    private static final UUID SHOP = UUID.fromString(
            "fb000000-0000-4000-8000-000000000003");
    private static final UUID ORDER = UUID.fromString(
            "fb000000-0000-4000-8000-000000000004");
    private static final UUID LINE = UUID.fromString(
            "fb000000-0000-4000-8000-000000000005");
    private static final String ORDER_REF = "gid://shopify/Order/10";
    private static final String LINE_REF = "gid://shopify/LineItem/40";
    private static final Instant NOW = Instant.parse(
            "2026-08-01T01:00:00Z");

    private ChannelConnectorGateway connector;
    private OrderCenterService orders;
    private ShopifyOrderCustomItemCommandRepository commands;
    private OrderShopifyCustomItemAddFinalizer finalizer;
    private OrderShopifyCustomItemAddService service;
    private OrderActor actor;
    private OrderAggregate aggregate;

    @BeforeEach
    void setUp() {
        connector = mock(ChannelConnectorGateway.class);
        orders = mock(OrderCenterService.class);
        commands = mock(ShopifyOrderCustomItemCommandRepository.class);
        finalizer = mock(OrderShopifyCustomItemAddFinalizer.class);
        service = new OrderShopifyCustomItemAddService(
                connector, orders, commands, finalizer);
        actor = new OrderActor(
                TENANT, USER, null, "request-1", "127.0.0.1");
        TenantOrder order = mock(TenantOrder.class);
        when(order.getShopId()).thenReturn(SHOP);
        when(order.getExternalOrderRef()).thenReturn(ORDER_REF);
        when(order.getStatus()).thenReturn(OrderStatus.RECEIVED);
        when(order.getCurrency()).thenReturn("USD");
        aggregate = new OrderAggregate(order, List.of());
        when(orders.getOrder(actor, ORDER)).thenReturn(aggregate);
        when(connector.snapshot(TENANT, SHOP))
                .thenReturn(connectedSnapshot(true));
        when(commands.reserve(
                eq(TENANT), eq(SHOP), eq(ORDER), eq(ORDER_REF),
                eq("Gift wrapping"), eq(1250L), eq("USD"), eq(2),
                eq(false), eq(true), eq(true),
                eq("web.order-custom-10"), anyString()))
                .thenReturn(new Reservation(
                        false, false, null, null, null, null));
    }

    @Test
    void addsCustomItemAndFinalizesLocalOrderAtomically() {
        when(connector.addShopifyOrderCustomItem(
                eq(TENANT), eq(SHOP), any()))
                .thenReturn(providerResult(false));
        OrderLine line = mock(OrderLine.class);
        when(line.getId()).thenReturn(LINE);
        when(line.getExternalLineRef()).thenReturn(LINE_REF);
        OrderAggregate completed = new OrderAggregate(
                aggregate.order(), List.of(line));
        when(finalizer.finalizeSucceeded(
                eq(actor), eq(SHOP), eq(ORDER), eq(ORDER_REF),
                eq(LINE_REF), eq("Gift wrapping"), eq(2),
                eq(1250L), eq(8495L), eq("USD"), eq(false),
                eq(true), eq(true), eq(false),
                eq("web.order-custom-10"), anyString()))
                .thenReturn(completed);

        var result = service.add(actor, ORDER, command());

        assertThat(result.order()).isSameAs(completed);
        assertThat(result.lineId()).isEqualTo(LINE);
        assertThat(result.totalAmountMinor()).isEqualTo(8495L);
    }

    @Test
    void retryOfUncertainCommandEnablesExactProviderRecovery() {
        when(commands.reserve(
                eq(TENANT), eq(SHOP), eq(ORDER), eq(ORDER_REF),
                eq("Gift wrapping"), eq(1250L), eq("USD"), eq(2),
                eq(false), eq(true), eq(true),
                eq("web.order-custom-10"), anyString()))
                .thenReturn(new Reservation(
                        true, false, null, null, null, null));
        when(connector.addShopifyOrderCustomItem(
                eq(TENANT), eq(SHOP), any()))
                .thenThrow(new ConnectorUnavailableException());

        assertThatThrownBy(() -> service.add(actor, ORDER, command()))
                .isInstanceOf(ConflictException.class)
                .hasMessage("shopify_order_edit_uncertain");
        verify(connector).addShopifyOrderCustomItem(
                eq(TENANT), eq(SHOP),
                eq(new OrderAddCustomItemRequest(
                        ORDER_REF, "Gift wrapping",
                        new Money("12.50", "USD"), 2,
                        false, true, true, true,
                        "web.order-custom-10")));
        verify(commands).markUncertain(
                eq(TENANT), eq("web.order-custom-10"), anyString());
    }

    @Test
    void succeededReplayDoesNotCallShopifyAgain() {
        when(commands.reserve(
                eq(TENANT), eq(SHOP), eq(ORDER), eq(ORDER_REF),
                eq("Gift wrapping"), eq(1250L), eq("USD"), eq(2),
                eq(false), eq(true), eq(true),
                eq("web.order-custom-10"), anyString()))
                .thenReturn(new Reservation(
                        true, true, LINE, LINE_REF, 8495L, "USD"));

        var result = service.add(actor, ORDER, command());

        assertThat(result.replayed()).isTrue();
        assertThat(result.lineId()).isEqualTo(LINE);
        verify(connector, never()).addShopifyOrderCustomItem(
                any(), any(), any());
    }

    @Test
    void missingWriteScopeFailsBeforeReservation() {
        when(connector.snapshot(TENANT, SHOP))
                .thenReturn(connectedSnapshot(false));

        assertThatThrownBy(() -> service.add(actor, ORDER, command()))
                .isInstanceOf(
                        ShopifyAuthorizationConflictException.class);
        verify(commands, never()).reserve(
                any(), any(), any(), anyString(), anyString(),
                anyLong(), anyString(), anyInt(), anyBoolean(),
                anyBoolean(), anyBoolean(), anyString(), anyString());
    }

    private static AddCommand command() {
        return new AddCommand(
                "Gift wrapping", 1250L, 2,
                false, true, true, "web.order-custom-10");
    }

    private static OrderAddCustomItemResult providerResult(
            boolean recovered) {
        return new OrderAddCustomItemResult(
                ORDER_REF, LINE_REF, "Gift wrapping",
                new Money("12.50", "USD"), 2,
                new Money("84.95", "USD"), recovered, NOW);
    }

    private static ChannelSnapshot connectedSnapshot(
            boolean includeWrite) {
        var scopes = new java.util.ArrayList<>(List.of(
                scope("read_orders"), scope("read_order_edits")));
        if (includeWrite) scopes.add(scope("write_order_edits"));
        return new ChannelSnapshot(
                ConnectorMode.XZ_ERP_APP,
                new Connection(
                        ConnectionStatus.CONNECTED, null, null, NOW),
                scopes, List.of());
    }

    private static ShopifyPermissionScope scope(String value) {
        return new ShopifyPermissionScope(
                value, value, ShopifyScopeCoverageStatus.GRANTED);
    }
}
