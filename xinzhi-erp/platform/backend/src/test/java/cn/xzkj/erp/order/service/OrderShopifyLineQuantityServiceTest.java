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
import cn.xzkj.erp.order.repository.ShopifyOrderLineEditCommandRepository;
import cn.xzkj.erp.order.repository.ShopifyOrderLineEditCommandRepository.Reservation;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;
import cn.xzkj.erp.order.service.OrderShopifyLineQuantityService.UpdateCommand;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ChannelSnapshot;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Connection;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectorMode;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Money;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderEditQuantityResult;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyPermissionScope;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyScopeCoverageStatus;
import cn.xzkj.erp.platform.connector.ConnectorUnavailableException;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;

class OrderShopifyLineQuantityServiceTest {

    private static final UUID TENANT = UUID.fromString(
            "f8000000-0000-4000-8000-000000000001");
    private static final UUID USER = UUID.fromString(
            "f8000000-0000-4000-8000-000000000002");
    private static final UUID SHOP = UUID.fromString(
            "f8000000-0000-4000-8000-000000000003");
    private static final UUID ORDER = UUID.fromString(
            "f8000000-0000-4000-8000-000000000004");
    private static final UUID LINE = UUID.fromString(
            "f8000000-0000-4000-8000-000000000005");
    private static final String ORDER_REF = "gid://shopify/Order/10";
    private static final String LINE_REF = "gid://shopify/LineItem/20";
    private static final String VARIANT_REF =
            "gid://shopify/ProductVariant/30";
    private static final Instant NOW = Instant.parse(
            "2026-07-31T12:00:00Z");

    private ChannelConnectorGateway connector;
    private OrderCenterService orders;
    private ShopifyOrderLineEditCommandRepository commands;
    private OrderShopifyLineQuantityFinalizer finalizer;
    private OrderShopifyLineQuantityService service;
    private OrderActor actor;
    private OrderAggregate aggregate;

    @BeforeEach
    void setUp() {
        connector = mock(ChannelConnectorGateway.class);
        orders = mock(OrderCenterService.class);
        commands = mock(ShopifyOrderLineEditCommandRepository.class);
        finalizer = mock(OrderShopifyLineQuantityFinalizer.class);
        service = new OrderShopifyLineQuantityService(
                connector, orders, commands, finalizer);
        actor = new OrderActor(
                TENANT, USER, null, "request-1", "127.0.0.1");
        TenantOrder order = mock(TenantOrder.class);
        when(order.getShopId()).thenReturn(SHOP);
        when(order.getExternalOrderRef()).thenReturn(ORDER_REF);
        when(order.getStatus()).thenReturn(OrderStatus.RECEIVED);
        when(order.getCurrency()).thenReturn("USD");
        OrderLine line = mock(OrderLine.class);
        when(line.getId()).thenReturn(LINE);
        when(line.getExternalLineRef()).thenReturn(LINE_REF);
        when(line.getExternalVariantRef()).thenReturn(VARIANT_REF);
        when(line.getQuantity()).thenReturn(2);
        aggregate = new OrderAggregate(order, List.of(line));
        when(orders.getOrder(actor, ORDER)).thenReturn(aggregate);
        when(connector.snapshot(TENANT, SHOP))
                .thenReturn(connectedSnapshot(true));
        when(commands.reserve(
                eq(TENANT), eq(SHOP), eq(ORDER), eq(LINE),
                eq(ORDER_REF), eq(LINE_REF), eq(VARIANT_REF),
                eq("web.order-edit-10"), anyString(),
                eq(2), eq(1), eq(true), eq(true)))
                .thenReturn(new Reservation(
                        false, false, null, null, null));
    }

    @Test
    void updatesQuantityAndFinalizesLocalOrderAtomically() {
        when(connector.updateShopifyOrderLineQuantity(
                eq(TENANT), eq(SHOP), any()))
                .thenReturn(providerResult(false));
        when(finalizer.finalizeSucceeded(
                eq(actor), eq(SHOP), eq(ORDER), eq(LINE),
                eq(ORDER_REF), eq(LINE_REF), eq(VARIANT_REF),
                eq(2), eq(1), eq(4995L), eq("USD"),
                eq(true), eq(true), eq(false),
                eq("web.order-edit-10"), anyString()))
                .thenReturn(aggregate);

        var result = service.update(actor, ORDER, command());

        assertThat(result.order()).isSameAs(aggregate);
        assertThat(result.totalAmountMinor()).isEqualTo(4995L);
        assertThat(result.replayed()).isFalse();
    }

    @Test
    void ambiguousConnectorFailureBecomesRecoverableUncertainState() {
        when(connector.updateShopifyOrderLineQuantity(
                eq(TENANT), eq(SHOP), any()))
                .thenThrow(new ConnectorUnavailableException());

        assertThatThrownBy(() -> service.update(actor, ORDER, command()))
                .isInstanceOf(ConflictException.class)
                .hasMessage("shopify_order_edit_uncertain");
        verify(commands).markUncertain(
                eq(TENANT), eq("web.order-edit-10"), anyString());
        verify(finalizer, never()).finalizeSucceeded(
                any(), any(), any(), any(), anyString(), anyString(),
                anyString(), anyInt(), anyInt(), anyLong(), anyString(),
                anyBoolean(), anyBoolean(), anyBoolean(), anyString(),
                anyString());
    }

    @Test
    void succeededReplayDoesNotCallShopifyAgain() {
        when(commands.reserve(
                eq(TENANT), eq(SHOP), eq(ORDER), eq(LINE),
                eq(ORDER_REF), eq(LINE_REF), eq(VARIANT_REF),
                eq("web.order-edit-10"), anyString(),
                eq(2), eq(1), eq(true), eq(true)))
                .thenReturn(new Reservation(
                        true, true, 1, 4995L, "USD"));

        var result = service.update(actor, ORDER, command());

        assertThat(result.replayed()).isTrue();
        verify(connector, never()).updateShopifyOrderLineQuantity(
                any(), any(), any());
        verify(finalizer, never()).finalizeSucceeded(
                any(), any(), any(), any(), anyString(), anyString(),
                anyString(), anyInt(), anyInt(), anyLong(), anyString(),
                anyBoolean(), anyBoolean(), anyBoolean(), anyString(),
                anyString());
    }

    @Test
    void missingWriteScopeFailsBeforeReservation() {
        when(connector.snapshot(TENANT, SHOP))
                .thenReturn(connectedSnapshot(false));

        assertThatThrownBy(() -> service.update(actor, ORDER, command()))
                .isInstanceOf(
                        ShopifyAuthorizationConflictException.class);
        verify(commands, never()).reserve(
                any(), any(), any(), any(), anyString(), anyString(),
                anyString(), anyString(), anyString(), anyInt(),
                anyInt(), anyBoolean(), anyBoolean());
    }

    private static UpdateCommand command() {
        return new UpdateCommand(
                LINE, 2, 1, true, true, "web.order-edit-10");
    }

    private static OrderEditQuantityResult providerResult(
            boolean recovered) {
        return new OrderEditQuantityResult(
                ORDER_REF, LINE_REF, 1,
                new Money("49.95", "USD"), recovered, NOW);
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
