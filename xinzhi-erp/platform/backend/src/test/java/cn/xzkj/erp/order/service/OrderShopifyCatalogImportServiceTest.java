package cn.xzkj.erp.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import cn.xzkj.erp.order.domain.OrderLine;
import cn.xzkj.erp.order.domain.SkuMatchSource;
import cn.xzkj.erp.order.domain.TenantOrder;
import cn.xzkj.erp.order.repository.OrderRepository;
import cn.xzkj.erp.order.service.OrderCenterService.CreateOrderCommand;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderShopifyCatalogImportService.ShopifyOrderCatalogImportStatus;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService.AddressPreview;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService.LocalSkuMatch;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService.MoneyPreview;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService.ShopifyCustomerPreview;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService.ShopifyFulfillmentPreview;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService.ShopifyOrderCatalogPreview;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService.ShopifyOrderLineMatchStatus;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService.ShopifyOrderLinePreview;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService.ShopifyOrderPreview;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService.ShopifyTrackingPreview;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectorMode;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.settings.address.AddressMappingService;
import cn.xzkj.erp.settings.address.AddressMappingService.AddressType;

@ExtendWith(MockitoExtension.class)
class OrderShopifyCatalogImportServiceTest {

    @Mock private OrderShopifyCatalogPreviewService previewService;
    @Mock private OrderCenterService orderService;
    @Mock private OrderRepository orderRepository;
    @Mock private AddressMappingService addressMappingService;

    @Test
    void importsSelectedOrderFromServerSidePreview() {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        UUID orderId = UUID.randomUUID();
        OrderActor actor = new OrderActor(tenantId, userId, "request-1");
        ShopifyOrderPreview order = order(skuId);
        when(previewService.previewForImport(
                eq(actor),
                eq(shopId),
                eq(25),
                eq("opaque=="),
                eq("created_at:>=2026-07-01"),
                eq(false)))
                .thenReturn(preview(order));
        when(orderRepository.existsByTenantIdAndShopIdAndExternalOrderRef(
                tenantId, shopId, order.externalOrderRef()))
                .thenReturn(false);
        when(orderService.createOrder(eq(actor),
                org.mockito.ArgumentMatchers.any(CreateOrderCommand.class)))
                .thenReturn(aggregate(tenantId, shopId, orderId));
        when(addressMappingService.resolveFirst(eq(tenantId), any(), eq("US"),
                any(), any(), any())).thenAnswer(invocation ->
                        invocation.getArgument(3) == AddressType.PROVINCE
                                ? "New York State" : "New York City");
        var service = new OrderShopifyCatalogImportService(
                previewService, orderService, orderRepository,
                addressMappingService);

        var result = service.importSelectedOrders(
                actor,
                shopId,
                25,
                "opaque==",
                "created_at:>=2026-07-01",
                List.of(order.externalOrderRef()));

        assertThat(result.importedCount()).isEqualTo(1);
        assertThat(result.skippedCount()).isZero();
        assertThat(result.items().getFirst().status())
                .isEqualTo(ShopifyOrderCatalogImportStatus.IMPORTED);
        assertThat(result.items().getFirst().orderId()).isEqualTo(orderId);

        ArgumentCaptor<CreateOrderCommand> command =
                ArgumentCaptor.forClass(CreateOrderCommand.class);
        verify(orderService).createOrder(eq(actor), command.capture());
        assertThat(command.getValue().shopId()).isEqualTo(shopId);
        assertThat(command.getValue().externalOrderRef())
                .isEqualTo("gid://shopify/Order/100");
        assertThat(command.getValue().currency()).isEqualTo("USD");
        assertThat(command.getValue().buyerReference())
                .isEqualTo("buyer@example.test");
        assertThat(command.getValue().operational().paymentStatus())
                .isEqualTo("PAID");
        assertThat(command.getValue().operational().countryCode())
                .isEqualTo("US");
        assertThat(command.getValue().operational().province())
                .isEqualTo("New York State");
        assertThat(command.getValue().profile().city())
                .isEqualTo("New York City");
        assertThat(command.getValue().profile().trackingReference())
                .isEqualTo("1Z999");
        assertThat(command.getValue().lines()).hasSize(1);
        assertThat(command.getValue().lines().getFirst().skuId())
                .isEqualTo(skuId);
    }

    @Test
    void skipsExistingOrderWithoutCreatingDuplicate() {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        OrderActor actor = new OrderActor(tenantId, UUID.randomUUID(), "request-1");
        ShopifyOrderPreview order = order(skuId);
        when(previewService.previewForImport(
                eq(actor), eq(shopId), eq(50), eq(null), eq(null), eq(false)))
                .thenReturn(preview(order));
        when(orderRepository.existsByTenantIdAndShopIdAndExternalOrderRef(
                tenantId, shopId, order.externalOrderRef()))
                .thenReturn(true);
        var service = new OrderShopifyCatalogImportService(
                previewService, orderService, orderRepository,
                addressMappingService);

        var result = service.importSelectedOrders(
                actor,
                shopId,
                50,
                null,
                null,
                List.of(order.externalOrderRef()));

        assertThat(result.importedCount()).isZero();
        assertThat(result.items().getFirst().status())
                .isEqualTo(ShopifyOrderCatalogImportStatus.SKIPPED_DUPLICATE);
        verify(orderService, never()).createOrder(
                eq(actor),
                org.mockito.ArgumentMatchers.any(CreateOrderCommand.class));
    }

    private static ShopifyOrderCatalogPreview preview(
            ShopifyOrderPreview order) {
        return new ShopifyOrderCatalogPreview(
                ConnectorMode.XZ_ERP_APP,
                ConnectionStatus.CONNECTED,
                null,
                false,
                Instant.parse("2026-07-31T01:02:03Z"),
                List.of(order));
    }

    private static ShopifyOrderPreview order(UUID skuId) {
        return new ShopifyOrderPreview(
                "gid://shopify/Order/100",
                "100",
                "#1001",
                "buyer@example.test",
                "web",
                Instant.parse("2026-07-30T01:02:03Z"),
                Instant.parse("2026-07-31T01:02:03Z"),
                null,
                "PAID",
                "FULFILLED",
                List.of("shopify_payments"),
                new MoneyPreview("45.50", 4550L, "USD"),
                new MoneyPreview("39.50", 3950L, "USD"),
                new MoneyPreview("6.00", 600L, "USD"),
                new AddressPreview(
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
                new ShopifyCustomerPreview(
                        "gid://shopify/Customer/500",
                        "Demo Buyer",
                        "buyer@example.test",
                        "+10000000000",
                        Instant.parse("2026-07-01T01:02:03Z"),
                        new MoneyPreview("145.00", 14500L, "USD")),
                List.of(new ShopifyOrderLinePreview(
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
                        new MoneyPreview("39.50", 3950L, "USD"),
                        new MoneyPreview("19.75", 1975L, "USD"),
                        ShopifyOrderLineMatchStatus.EXACT_SKU_MATCH,
                        new LocalSkuMatch(
                                skuId,
                                "HD-B-M",
                                "Hoodie",
                                ProductStatus.ACTIVE))),
                List.of(new ShopifyFulfillmentPreview(
                        "gid://shopify/Fulfillment/700",
                        "SUCCESS",
                        Instant.parse("2026-07-30T02:02:03Z"),
                        Instant.parse("2026-07-30T03:02:03Z"),
                        List.of(new ShopifyTrackingPreview(
                                "UPS",
                                "1Z999",
                                "https://track.example/1Z999")))));
    }

    private static OrderCenterService.OrderAggregate aggregate(
            UUID tenantId,
            UUID shopId,
            UUID orderId) {
        TenantOrder order = new TenantOrder(
                tenantId,
                shopId,
                "gid://shopify/Order/100",
                "shopify.abc",
                "a".repeat(64),
                "USD",
                null,
                1,
                Instant.parse("2026-07-30T01:02:03Z"));
        ReflectionTestUtils.setField(order, "id", orderId);
        OrderLine line = new OrderLine(
                tenantId,
                orderId,
                null,
                "gid://shopify/Product/800",
                "gid://shopify/ProductVariant/801",
                SkuMatchSource.UNMATCHED,
                "gid://shopify/LineItem/900",
                "Catalog Hoodie - Blue / M",
                2,
                1975L,
                "USD");
        return new OrderCenterService.OrderAggregate(order, List.of(line));
    }
}
