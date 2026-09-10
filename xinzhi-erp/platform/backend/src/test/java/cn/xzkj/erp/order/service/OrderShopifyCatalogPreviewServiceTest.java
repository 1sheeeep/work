package cn.xzkj.erp.order.service;

import static cn.xzkj.erp.order.domain.OrderAuditActions.PROTECTED_CUSTOMER_DATA_READ;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.order.repository.OrderSkuLookupRepository;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectorMode;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.domain.TenantShop;
import cn.xzkj.erp.platform.repository.TenantShopRepository;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.product.domain.ProductSku;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.settings.general.OrderPullBlackoutException;
import cn.xzkj.erp.settings.general.SystemGeneralSettingService;

@ExtendWith(MockitoExtension.class)
class OrderShopifyCatalogPreviewServiceTest {

    @Mock private TenantShopRepository shopRepository;
    @Mock private OrderSkuLookupRepository skuRepository;
    @Mock private ChannelConnectorGateway connector;
    @Mock private SecurityAuditRecorder auditRecorder;
    @Mock private SystemGeneralSettingService systemGeneralSettingService;

    @Test
    void previewsShopifyOrdersAndMatchesLinesByLocalSkuCode() {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        OrderActor actor = new OrderActor(
                tenantId, userId, null, "request-1", "192.0.2.10");
        var service = new OrderShopifyCatalogPreviewService(
                shopRepository, skuRepository, connector, auditRecorder,
                systemGeneralSettingService);
        when(shopRepository.findByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(new TenantShop(
                        tenantId, UUID.randomUUID(), "shopify-demo", "Shopify Demo")));
        when(connector.snapshot(tenantId, shopId))
                .thenReturn(connectedSnapshot("write_orders"));
        when(connector.fetchShopifyOrderCatalog(
                eq(tenantId),
                eq(shopId),
                eq(new ChannelConnectorGateway.OrderCatalogRequest(
                        25, "opaque==", "created_at:>=2026-07-01"))))
                .thenReturn(new ChannelConnectorGateway.OrderCatalogPage(
                        ConnectorMode.XZ_ERP_APP,
                        ConnectionStatus.CONNECTED,
                        "next==",
                        true,
                        Instant.parse("2026-07-31T01:02:03Z"),
                        List.of(new ChannelConnectorGateway.OrderCatalogOrder(
                                "gid://shopify/Order/100",
                                "100",
                                "#1001",
                                "buyer@example.test",
                                "web",
                                Instant.parse("2026-07-30T01:02:03Z"),
                                Instant.parse("2026-07-31T01:02:03Z"),
                                null,
                                "PAID",
                                "UNFULFILLED",
                                List.of("shopify_payments"),
                                new ChannelConnectorGateway.Money("45.50", "USD"),
                                new ChannelConnectorGateway.Money("39.50", "USD"),
                                new ChannelConnectorGateway.Money("6.00", "USD"),
                                new ChannelConnectorGateway.MailingAddress(
                                        "Demo Buyer",
                                        "Demo",
                                        "Buyer",
                                        null,
                                        "1 Main St",
                                        null,
                                        "New York",
                                        "New York",
                                        "NY",
                                        "United States",
                                        "US",
                                        "10001",
                                        "+10000000000",
                                        List.of("1 Main St", "New York NY 10001")),
                                new ChannelConnectorGateway.Customer(
                                        "gid://shopify/Customer/500",
                                        "Demo Buyer",
                                        "buyer@example.test",
                                        "+10000000000",
                                        Instant.parse("2026-07-01T01:02:03Z"),
                                        new ChannelConnectorGateway.Money("145.00", "USD")),
                                List.of(
                                        new ChannelConnectorGateway.OrderCatalogLine(
                                                "gid://shopify/LineItem/900",
                                                "gid://shopify/Product/800",
                                                "gid://shopify/ProductVariant/801",
                                                "gid://shopify/InventoryItem/802",
                                                "Catalog Hoodie - Blue / M",
                                                "Catalog Hoodie",
                                                2,
                                                "HD-B-M",
                                                "Blue / M",
                                                true,
                                                new ChannelConnectorGateway.Money("39.50", "USD"),
                                                new ChannelConnectorGateway.Money("19.75", "USD")),
                                        new ChannelConnectorGateway.OrderCatalogLine(
                                                "gid://shopify/LineItem/901",
                                                "gid://shopify/Product/801",
                                                "gid://shopify/ProductVariant/802",
                                                null,
                                                "Catalog Bottle",
                                                "Catalog Bottle",
                                                1,
                                                "missing-sku",
                                                "Default",
                                                true,
                                                new ChannelConnectorGateway.Money("6.00", "USD"),
                                                new ChannelConnectorGateway.Money("6.00", "USD")),
                                        new ChannelConnectorGateway.OrderCatalogLine(
                                                "gid://shopify/LineItem/902",
                                                "gid://shopify/Product/802",
                                                "gid://shopify/ProductVariant/803",
                                                null,
                                                "No SKU Item",
                                                "No SKU Item",
                                                1,
                                                "",
                                                "Default",
                                                true,
                                                new ChannelConnectorGateway.Money("0.00", "USD"),
                                                new ChannelConnectorGateway.Money("0.00", "USD"))),
                                List.of()))));
        ProductSku sku = new ProductSku(
                tenantId, UUID.randomUUID(), "HD-B-M", "Hoodie", "Blue / M");
        ReflectionTestUtils.setField(sku, "id", skuId);
        when(skuRepository.findByTenantIdAndBusinessCodeInAndStatusNot(
                eq(tenantId),
                eq(List.of("HD-B-M", "MISSING-SKU")),
                eq(ProductStatus.ARCHIVED)))
                .thenReturn(List.of(sku));

        var preview = service.preview(
                actor, shopId, 25, "opaque==", "created_at:>=2026-07-01");

        assertThat(preview.mode()).isEqualTo(ConnectorMode.XZ_ERP_APP);
        assertThat(preview.connectionStatus()).isEqualTo(ConnectionStatus.CONNECTED);
        assertThat(preview.cursor()).isEqualTo("next==");
        assertThat(preview.orders()).hasSize(1);
        var order = preview.orders().getFirst();
        assertThat(order.name()).isEqualTo("#1001");
        assertThat(order.total().amountMinor()).isEqualTo(4550L);
        assertThat(order.shippingAddress().countryCode()).isEqualTo("US");
        assertThat(order.customer().externalCustomerRef())
                .isEqualTo("gid://shopify/Customer/500");
        assertThat(order.lineItems()).extracting("matchStatus")
                .containsExactly(
                        OrderShopifyCatalogPreviewService
                                .ShopifyOrderLineMatchStatus.EXACT_SKU_MATCH,
                        OrderShopifyCatalogPreviewService
                                .ShopifyOrderLineMatchStatus.MISSING_LOCAL_SKU,
                        OrderShopifyCatalogPreviewService
                                .ShopifyOrderLineMatchStatus.EMPTY_PLATFORM_SKU);
        assertThat(order.lineItems().getFirst().localSku().id()).isEqualTo(skuId);

        ArgumentCaptor<SecurityAuditEvent> audit =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(auditRecorder).record(audit.capture());
        assertThat(audit.getValue().tenantId()).isEqualTo(tenantId);
        assertThat(audit.getValue().actorUserId()).isEqualTo(userId);
        assertThat(audit.getValue().actorSystemAdminId()).isNull();
        assertThat(audit.getValue().action())
                .isEqualTo(PROTECTED_CUSTOMER_DATA_READ);
        assertThat(audit.getValue().resourceType()).isEqualTo("shop");
        assertThat(audit.getValue().resourceId()).isEqualTo(shopId.toString());
        assertThat(audit.getValue().requestId()).isEqualTo("request-1");
        assertThat(audit.getValue().sourceIp()).isEqualTo("192.0.2.10");
        assertThat(audit.getValue().details()).containsExactlyInAnyOrderEntriesOf(
                java.util.Map.of(
                        "surface", "shopifyCatalogPreview",
                        "fieldSet", "name,address,phone,email",
                        "recordCount", "1"));
        assertThat(audit.getValue().toString())
                .doesNotContain("buyer@example.test", "+10000000000", "1 Main St");
    }

    @Test
    void importPreviewUsesOneImportSpecificProtectedDataAuditEvent() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        OrderActor actor = new OrderActor(
                tenantId, UUID.randomUUID(), null, "request-import", "192.0.2.11");
        when(shopRepository.findByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(new TenantShop(
                        tenantId, UUID.randomUUID(), "shopify-demo", "Shopify Demo")));
        when(connector.snapshot(tenantId, shopId))
                .thenReturn(connectedSnapshot("write_orders"));
        when(connector.fetchShopifyOrderCatalog(
                eq(tenantId),
                eq(shopId),
                eq(new ChannelConnectorGateway.OrderCatalogRequest(
                        10, null, null))))
                .thenReturn(new ChannelConnectorGateway.OrderCatalogPage(
                        ConnectorMode.XZ_ERP_APP,
                        ConnectionStatus.CONNECTED,
                        null,
                        false,
                        Instant.parse("2026-07-31T01:02:03Z"),
                        List.of()));
        var service = new OrderShopifyCatalogPreviewService(
                shopRepository, skuRepository, connector, auditRecorder,
                systemGeneralSettingService);

        service.previewForImport(actor, shopId, 10, null, null);

        ArgumentCaptor<SecurityAuditEvent> audit =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(auditRecorder).record(audit.capture());
        assertThat(audit.getAllValues()).hasSize(1);
        assertThat(audit.getValue().details()).containsExactlyInAnyOrderEntriesOf(
                java.util.Map.of(
                        "surface", "shopifyCatalogImport",
                        "fieldSet", "name,address,phone,email",
                        "recordCount", "0"));
    }

    @Test
    void historicalPreviewRequiresAllOrdersAndAddsServerCutoff() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        OrderActor actor = new OrderActor(
                tenantId, UUID.randomUUID(), "request-history");
        when(shopRepository.findByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(new TenantShop(
                        tenantId, UUID.randomUUID(), "shopify-demo", "Shopify Demo")));
        when(connector.snapshot(tenantId, shopId))
                .thenReturn(connectedSnapshot("write_orders", "read_all_orders"));
        when(connector.fetchShopifyOrderCatalog(
                eq(tenantId), eq(shopId),
                org.mockito.ArgumentMatchers.any()))
                .thenReturn(new ChannelConnectorGateway.OrderCatalogPage(
                        ConnectorMode.XZ_ERP_APP,
                        ConnectionStatus.CONNECTED,
                        null,
                        false,
                        Instant.parse("2026-08-15T01:02:03Z"),
                        List.of()));
        var service = new OrderShopifyCatalogPreviewService(
                shopRepository, skuRepository, connector, auditRecorder,
                systemGeneralSettingService);

        service.preview(actor, shopId, 25, null, "name:#1001", true);

        ArgumentCaptor<ChannelConnectorGateway.OrderCatalogRequest> request =
                ArgumentCaptor.forClass(
                        ChannelConnectorGateway.OrderCatalogRequest.class);
        verify(connector).fetchShopifyOrderCatalog(
                eq(tenantId), eq(shopId), request.capture());
        assertThat(request.getValue().query())
                .startsWith("name:#1001 created_at:<")
                .contains(java.time.LocalDate.now(java.time.ZoneOffset.UTC)
                        .minusDays(60).toString());
    }

    @Test
    void historicalPreviewFailsClosedWithoutAllOrdersScope() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        when(shopRepository.findByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(new TenantShop(
                        tenantId, UUID.randomUUID(), "shopify-demo", "Shopify Demo")));
        when(connector.snapshot(tenantId, shopId))
                .thenReturn(connectedSnapshot("write_orders"));
        var service = new OrderShopifyCatalogPreviewService(
                shopRepository, skuRepository, connector, auditRecorder,
                systemGeneralSettingService);

        assertThatThrownBy(() -> service.preview(
                new OrderActor(tenantId, UUID.randomUUID(), "request-history"),
                shopId, 25, null, null, true))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("read_all_orders");

        verify(connector, never()).fetchShopifyOrderCatalog(
                eq(tenantId), eq(shopId),
                org.mockito.ArgumentMatchers.any());
    }

    @Test
    void refusesInactiveShopBeforeCallingConnector() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        TenantShop shop = new TenantShop(
                tenantId, UUID.randomUUID(), "shopify-demo", "Shopify Demo");
        shop.update("shopify-demo", "Shopify Demo", ShopStatus.ARCHIVED);
        when(shopRepository.findByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(shop));
        var service = new OrderShopifyCatalogPreviewService(
                shopRepository, skuRepository, connector, auditRecorder,
                systemGeneralSettingService);
        OrderActor actor = new OrderActor(
                tenantId, UUID.randomUUID(), "request-1");

        assertThatThrownBy(() -> service.preview(
                actor, shopId, 50, null, null))
                .isInstanceOf(ConflictException.class);

        verify(connector, never()).fetchShopifyOrderCatalog(
                eq(tenantId),
                eq(shopId),
                eq(new ChannelConnectorGateway.OrderCatalogRequest(
                        50, null, null)));
        verify(auditRecorder, never()).record(
                org.mockito.ArgumentMatchers.any());
    }

    @Test
    void missingReadOrdersScopeBlocksPreviewBeforeCatalogFetch() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        when(shopRepository.findByIdAndTenantId(shopId, tenantId))
                .thenReturn(Optional.of(new TenantShop(
                        tenantId, UUID.randomUUID(), "shopify-demo", "Shopify Demo")));
        when(connector.snapshot(tenantId, shopId))
                .thenReturn(new ChannelConnectorGateway.ChannelSnapshot(
                        ConnectorMode.XZ_ERP_APP,
                        new ChannelConnectorGateway.Connection(
                                ConnectionStatus.CONNECTED,
                                null,
                                null,
                                Instant.parse("2026-07-31T01:02:03Z")),
                        ChannelConnectorGateway.plannedShopifyScopes(
                                List.of("read_products"),
                                true),
                        List.of()));
        var service = new OrderShopifyCatalogPreviewService(
                shopRepository, skuRepository, connector, auditRecorder,
                systemGeneralSettingService);
        OrderActor actor = new OrderActor(
                tenantId, UUID.randomUUID(), "request-1");

        assertThatThrownBy(() -> service.preview(
                actor,
                shopId,
                50,
                null,
                null))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("read_orders");

        verify(connector, never()).fetchShopifyOrderCatalog(
                eq(tenantId),
                eq(shopId),
                org.mockito.ArgumentMatchers.any());
        verify(auditRecorder, never()).record(
                org.mockito.ArgumentMatchers.any());
    }

    @Test
    void quietPeriodBlocksPullBeforeShopOrConnectorAccess() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        OrderActor actor = new OrderActor(
                tenantId, UUID.randomUUID(), "request-blackout");
        var service = new OrderShopifyCatalogPreviewService(
                shopRepository, skuRepository, connector, auditRecorder,
                systemGeneralSettingService);
        org.mockito.Mockito.doThrow(new OrderPullBlackoutException(
                java.time.LocalTime.of(6, 0)))
                .when(systemGeneralSettingService)
                .requireOrderPullAllowed(eq(tenantId),
                        org.mockito.ArgumentMatchers.any(Instant.class));

        assertThatThrownBy(() -> service.preview(
                actor, shopId, 50, null, null))
                .isInstanceOf(OrderPullBlackoutException.class);

        verify(shopRepository, never()).findByIdAndTenantId(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());
        verify(connector, never()).fetchShopifyOrderCatalog(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());
    }

    private static ChannelConnectorGateway.ChannelSnapshot connectedSnapshot(
            String... scopes) {
        return new ChannelConnectorGateway.ChannelSnapshot(
                ConnectorMode.XZ_ERP_APP,
                new ChannelConnectorGateway.Connection(
                        ConnectionStatus.CONNECTED,
                        null,
                        null,
                        Instant.parse("2026-07-31T01:02:03Z")),
                ChannelConnectorGateway.plannedShopifyScopes(
                        List.of(scopes),
                        true),
                List.of());
    }
}
