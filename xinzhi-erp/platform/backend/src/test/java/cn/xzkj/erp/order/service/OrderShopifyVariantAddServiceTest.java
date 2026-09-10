package cn.xzkj.erp.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import cn.xzkj.erp.order.domain.OrderLine;
import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.domain.TenantOrder;
import cn.xzkj.erp.order.repository.OrderListingLookupRepository;
import cn.xzkj.erp.order.repository.OrderSkuLookupRepository;
import cn.xzkj.erp.order.repository.ShopifyOrderVariantAddCommandRepository;
import cn.xzkj.erp.order.repository.ShopifyOrderVariantAddCommandRepository.Reservation;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;
import cn.xzkj.erp.order.service.OrderShopifyVariantAddService.AddCommand;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ChannelSnapshot;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Connection;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectorMode;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Money;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderAddVariantRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderAddVariantResult;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyPermissionScope;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyScopeCoverageStatus;
import cn.xzkj.erp.platform.connector.ConnectorUnavailableException;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;
import cn.xzkj.erp.product.domain.ListingStatus;
import cn.xzkj.erp.product.domain.ProductListing;
import cn.xzkj.erp.product.domain.ProductSku;
import cn.xzkj.erp.product.domain.ProductStatus;

class OrderShopifyVariantAddServiceTest {

    private static final UUID TENANT = UUID.fromString(
            "fa000000-0000-4000-8000-000000000001");
    private static final UUID USER = UUID.fromString(
            "fa000000-0000-4000-8000-000000000002");
    private static final UUID SHOP = UUID.fromString(
            "fa000000-0000-4000-8000-000000000003");
    private static final UUID ORDER = UUID.fromString(
            "fa000000-0000-4000-8000-000000000004");
    private static final UUID LISTING = UUID.fromString(
            "fa000000-0000-4000-8000-000000000005");
    private static final UUID SKU = UUID.fromString(
            "fa000000-0000-4000-8000-000000000006");
    private static final UUID LINE = UUID.fromString(
            "fa000000-0000-4000-8000-000000000007");
    private static final String ORDER_REF = "gid://shopify/Order/10";
    private static final String PRODUCT_REF = "gid://shopify/Product/20";
    private static final String VARIANT_REF =
            "gid://shopify/ProductVariant/30";
    private static final String LINE_REF = "gid://shopify/LineItem/40";
    private static final Instant NOW = Instant.parse(
            "2026-07-31T12:00:00Z");

    private ChannelConnectorGateway connector;
    private OrderCenterService orders;
    private ShopifyOrderVariantAddCommandRepository commands;
    private OrderShopifyVariantAddFinalizer finalizer;
    private OrderShopifyVariantAddService service;
    private OrderActor actor;
    private OrderAggregate aggregate;

    @BeforeEach
    void setUp() {
        connector = mock(ChannelConnectorGateway.class);
        orders = mock(OrderCenterService.class);
        var listings = mock(OrderListingLookupRepository.class);
        var skus = mock(OrderSkuLookupRepository.class);
        commands = mock(ShopifyOrderVariantAddCommandRepository.class);
        finalizer = mock(OrderShopifyVariantAddFinalizer.class);
        service = new OrderShopifyVariantAddService(
                connector, orders, listings, skus, commands, finalizer);
        actor = new OrderActor(
                TENANT, USER, null, "request-1", "127.0.0.1");
        TenantOrder order = mock(TenantOrder.class);
        when(order.getShopId()).thenReturn(SHOP);
        when(order.getExternalOrderRef()).thenReturn(ORDER_REF);
        when(order.getStatus()).thenReturn(OrderStatus.RECEIVED);
        when(order.getCurrency()).thenReturn("USD");
        aggregate = new OrderAggregate(order, List.of());
        when(orders.getOrder(actor, ORDER)).thenReturn(aggregate);
        ProductListing listing = mock(ProductListing.class);
        when(listing.getId()).thenReturn(LISTING);
        when(listing.getSkuId()).thenReturn(SKU);
        when(listing.getExternalListingRef()).thenReturn(PRODUCT_REF);
        when(listing.getExternalVariantRef()).thenReturn(VARIANT_REF);
        when(listings.findByIdAndTenantIdAndShopIdAndStatus(
                LISTING, TENANT, SHOP, ListingStatus.ACTIVE))
                .thenReturn(Optional.of(listing));
        ProductSku sku = mock(ProductSku.class);
        when(sku.getId()).thenReturn(SKU);
        when(sku.getStatus()).thenReturn(ProductStatus.ACTIVE);
        when(sku.getBusinessCode()).thenReturn("ERP-RED");
        when(skus.findByIdAndTenantId(SKU, TENANT))
                .thenReturn(Optional.of(sku));
        when(connector.snapshot(TENANT, SHOP))
                .thenReturn(connectedSnapshot(true));
        when(commands.reserve(
                eq(TENANT), eq(SHOP), eq(ORDER), eq(LISTING), eq(SKU),
                eq(ORDER_REF), eq(PRODUCT_REF), eq(VARIANT_REF),
                eq("web.order-add-10"), anyString(), eq(2), eq(true)))
                .thenReturn(new Reservation(
                        false, false, null, null, null, null, null));
    }

    @Test
    void addsVariantAndFinalizesLocalOrderAtomically() {
        when(connector.addShopifyOrderVariant(
                eq(TENANT), eq(SHOP), any()))
                .thenReturn(providerResult(false));
        OrderLine line = mock(OrderLine.class);
        when(line.getId()).thenReturn(LINE);
        when(line.getExternalLineRef()).thenReturn(LINE_REF);
        OrderAggregate completed = new OrderAggregate(
                aggregate.order(), List.of(line));
        when(finalizer.finalizeSucceeded(
                eq(actor), eq(SHOP), eq(ORDER), eq(LISTING), eq(SKU),
                eq(ORDER_REF), eq(PRODUCT_REF), eq(VARIANT_REF),
                eq(LINE_REF), eq("ERP-RED"), eq("Travel Bag - Red"),
                eq(2), eq(1250L), eq(8495L), eq("USD"),
                eq(true), eq(false), eq("web.order-add-10"),
                anyString())).thenReturn(completed);

        var result = service.add(actor, ORDER, command());

        assertThat(result.order()).isSameAs(completed);
        assertThat(result.lineId()).isEqualTo(LINE);
        assertThat(result.totalAmountMinor()).isEqualTo(8495L);
    }

    @Test
    void retryOfUncertainCommandEnablesExactProviderRecovery() {
        when(commands.reserve(
                eq(TENANT), eq(SHOP), eq(ORDER), eq(LISTING), eq(SKU),
                eq(ORDER_REF), eq(PRODUCT_REF), eq(VARIANT_REF),
                eq("web.order-add-10"), anyString(), eq(2), eq(true)))
                .thenReturn(new Reservation(
                        true, false, null, null, null, null, null));
        when(connector.addShopifyOrderVariant(
                eq(TENANT), eq(SHOP), any()))
                .thenThrow(new ConnectorUnavailableException());

        assertThatThrownBy(() -> service.add(actor, ORDER, command()))
                .isInstanceOf(ConflictException.class)
                .hasMessage("shopify_order_edit_uncertain");
        verify(connector).addShopifyOrderVariant(
                eq(TENANT), eq(SHOP),
                eq(new OrderAddVariantRequest(
                        ORDER_REF, VARIANT_REF, 2,
                        true, true, "web.order-add-10")));
        verify(commands).markUncertain(
                eq(TENANT), eq("web.order-add-10"), anyString());
    }

    @Test
    void succeededReplayDoesNotCallShopifyAgain() {
        when(commands.reserve(
                eq(TENANT), eq(SHOP), eq(ORDER), eq(LISTING), eq(SKU),
                eq(ORDER_REF), eq(PRODUCT_REF), eq(VARIANT_REF),
                eq("web.order-add-10"), anyString(), eq(2), eq(true)))
                .thenReturn(new Reservation(
                        true, true, LINE, LINE_REF, 1250L, 8495L, "USD"));

        var result = service.add(actor, ORDER, command());

        assertThat(result.replayed()).isTrue();
        assertThat(result.lineId()).isEqualTo(LINE);
        verify(connector, never()).addShopifyOrderVariant(
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
                any(), any(), any(), any(), any(), anyString(),
                anyString(), anyString(), anyString(), anyString(),
                anyInt(), anyBoolean());
    }

    private static AddCommand command() {
        return new AddCommand(LISTING, 2, true, "web.order-add-10");
    }

    private static OrderAddVariantResult providerResult(
            boolean recovered) {
        return new OrderAddVariantResult(
                ORDER_REF, LINE_REF, VARIANT_REF, 2,
                "ERP-RED", "Travel Bag - Red", "Red",
                new Money("12.50", "USD"),
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
