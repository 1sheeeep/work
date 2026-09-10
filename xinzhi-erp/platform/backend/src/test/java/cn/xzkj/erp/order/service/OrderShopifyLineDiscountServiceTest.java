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

import cn.xzkj.erp.order.domain.OrderLine;
import cn.xzkj.erp.order.domain.OrderLineKind;
import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.domain.TenantOrder;
import cn.xzkj.erp.order.repository.ShopifyOrderLineDiscountCommandRepository;
import cn.xzkj.erp.order.repository.ShopifyOrderLineDiscountCommandRepository.Reservation;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;
import cn.xzkj.erp.order.service.OrderShopifyLineDiscountService.DiscountCommand;
import cn.xzkj.erp.order.service.OrderShopifyLineDiscountService.NormalizedCommand;
import cn.xzkj.erp.order.service.OrderShopifyLineDiscountService.ValidatedProviderResult;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ChannelSnapshot;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Connection;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectorMode;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Money;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderLineDiscountRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderLineDiscountResult;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderLineDiscountType;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyPermissionScope;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyScopeCoverageStatus;
import cn.xzkj.erp.platform.connector.ConnectorUnavailableException;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;

class OrderShopifyLineDiscountServiceTest {

    private static final UUID TENANT = UUID.fromString(
            "fc000000-0000-4000-8000-000000000001");
    private static final UUID USER = UUID.fromString(
            "fc000000-0000-4000-8000-000000000002");
    private static final UUID SHOP = UUID.fromString(
            "fc000000-0000-4000-8000-000000000003");
    private static final UUID ORDER = UUID.fromString(
            "fc000000-0000-4000-8000-000000000004");
    private static final UUID LINE = UUID.fromString(
            "fc000000-0000-4000-8000-000000000005");
    private static final String ORDER_REF = "gid://shopify/Order/10";
    private static final String LINE_REF = "gid://shopify/LineItem/40";
    private static final String VARIANT_REF =
            "gid://shopify/ProductVariant/41";
    private static final Instant NOW = Instant.parse(
            "2026-08-01T02:00:00Z");

    private ChannelConnectorGateway connector;
    private OrderCenterService orders;
    private ShopifyOrderLineDiscountCommandRepository commands;
    private OrderShopifyLineDiscountFinalizer finalizer;
    private OrderShopifyLineDiscountService service;
    private OrderActor actor;
    private OrderAggregate aggregate;

    @BeforeEach
    void setUp() {
        connector = mock(ChannelConnectorGateway.class);
        orders = mock(OrderCenterService.class);
        commands = mock(ShopifyOrderLineDiscountCommandRepository.class);
        finalizer = mock(OrderShopifyLineDiscountFinalizer.class);
        service = new OrderShopifyLineDiscountService(
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
        when(line.getLineKind()).thenReturn(OrderLineKind.PRODUCT);
        when(line.getExternalLineRef()).thenReturn(LINE_REF);
        when(line.getExternalVariantRef()).thenReturn(VARIANT_REF);
        when(line.getQuantity()).thenReturn(2);
        when(line.getDiscountTotalMinor()).thenReturn(0L);
        aggregate = new OrderAggregate(order, List.of(line));
        when(orders.getOrder(actor, ORDER)).thenReturn(aggregate);
        when(connector.snapshot(TENANT, SHOP))
                .thenReturn(connectedSnapshot(true));
        when(commands.reserve(
                eq(TENANT), eq(SHOP), eq(ORDER), eq(LINE),
                eq(ORDER_REF), eq(LINE_REF), eq(VARIANT_REF),
                eq(2), eq(0L), eq("VIP adjustment"),
                eq(OrderLineDiscountType.FIXED), eq(500L), eq(null),
                eq("USD"), eq(true), eq("web.discount-10"), any()))
                .thenReturn(new Reservation(
                        false, false, null, null, null));
    }

    @Test
    void appliesDiscountAndFinalizesLocalState() {
        when(connector.addShopifyOrderLineDiscount(
                eq(TENANT), eq(SHOP), any()))
                .thenReturn(providerResult(false));
        when(finalizer.finalizeSucceeded(
                eq(actor), any(NormalizedCommand.class),
                any(ValidatedProviderResult.class), eq(false), any()))
                .thenReturn(aggregate);

        var result = service.add(actor, ORDER, command());

        assertThat(result.order()).isSameAs(aggregate);
        assertThat(result.discountTotalMinor()).isEqualTo(500L);
        assertThat(result.totalAmountMinor()).isEqualTo(4500L);
        verify(connector).addShopifyOrderLineDiscount(
                TENANT, SHOP, new OrderLineDiscountRequest(
                        ORDER_REF, LINE_REF, VARIANT_REF, 2,
                        new Money("0.00", "USD"), "VIP adjustment",
                        OrderLineDiscountType.FIXED,
                        new Money("5.00", "USD"), null,
                        true, false, "web.discount-10"));
    }

    @Test
    void uncertainRetryEnablesExactProviderRecovery() {
        when(commands.reserve(
                eq(TENANT), eq(SHOP), eq(ORDER), eq(LINE),
                eq(ORDER_REF), eq(LINE_REF), eq(VARIANT_REF),
                eq(2), eq(0L), eq("VIP adjustment"),
                eq(OrderLineDiscountType.FIXED), eq(500L), eq(null),
                eq("USD"), eq(true), eq("web.discount-10"), any()))
                .thenReturn(new Reservation(
                        true, false, null, null, null));
        when(connector.addShopifyOrderLineDiscount(
                eq(TENANT), eq(SHOP), any()))
                .thenThrow(new ConnectorUnavailableException());

        assertThatThrownBy(() -> service.add(actor, ORDER, command()))
                .isInstanceOf(ConflictException.class)
                .hasMessage("shopify_order_edit_uncertain");
        verify(connector).addShopifyOrderLineDiscount(
                TENANT, SHOP, new OrderLineDiscountRequest(
                        ORDER_REF, LINE_REF, VARIANT_REF, 2,
                        new Money("0.00", "USD"), "VIP adjustment",
                        OrderLineDiscountType.FIXED,
                        new Money("5.00", "USD"), null,
                        true, true, "web.discount-10"));
        verify(commands).markUncertain(
                eq(TENANT), eq("web.discount-10"), any());
    }

    @Test
    void missingWriteScopeFailsBeforeReservation() {
        when(connector.snapshot(TENANT, SHOP))
                .thenReturn(connectedSnapshot(false));

        assertThatThrownBy(() -> service.add(actor, ORDER, command()))
                .isInstanceOf(
                        ShopifyAuthorizationConflictException.class);
        verifyNoInteractions(commands);
    }

    private static DiscountCommand command() {
        return new DiscountCommand(
                LINE, "VIP adjustment", OrderLineDiscountType.FIXED,
                500L, null, true, "web.discount-10");
    }

    private static OrderLineDiscountResult providerResult(
            boolean recovered) {
        return new OrderLineDiscountResult(
                ORDER_REF, LINE_REF, "VIP adjustment",
                OrderLineDiscountType.FIXED,
                new Money("5.00", "USD"), null,
                new Money("5.00", "USD"),
                new Money("45.00", "USD"),
                recovered, NOW);
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
