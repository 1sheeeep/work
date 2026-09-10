package cn.xzkj.erp.order.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.order.domain.OrderLine;
import cn.xzkj.erp.order.repository.ShopifyOrderVariantAddCommandRepository;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;

class OrderShopifyVariantAddFinalizerTest {

    @Test
    void commitsLocalOrderAndCommandBeforeAtomicAudit() {
        var commands = mock(
                ShopifyOrderVariantAddCommandRepository.class);
        var orders = mock(OrderCenterService.class);
        var audits = mock(SecurityAuditRecorder.class);
        var line = mock(OrderLine.class);
        UUID lineId = UUID.randomUUID();
        when(line.getId()).thenReturn(lineId);
        when(line.getExternalLineRef())
                .thenReturn("gid://shopify/LineItem/40");
        var aggregate = new OrderAggregate(null, List.of(line));
        var finalizer = new OrderShopifyVariantAddFinalizer(
                commands, orders, audits);
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        UUID orderId = UUID.randomUUID();
        UUID listingId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        var actor = new OrderActor(
                tenantId, UUID.randomUUID(), null,
                "request-1", "127.0.0.1");
        when(orders.applyShopifyVariantAddition(
                actor, shopId, orderId, listingId, skuId,
                "gid://shopify/Order/10",
                "gid://shopify/Product/20",
                "gid://shopify/ProductVariant/30",
                "gid://shopify/LineItem/40", "ERP-RED",
                "Travel Bag - Red", 2, 1250L, 8495L, "USD"))
                .thenReturn(aggregate);

        finalizer.finalizeSucceeded(
                actor, shopId, orderId, listingId, skuId,
                "gid://shopify/Order/10",
                "gid://shopify/Product/20",
                "gid://shopify/ProductVariant/30",
                "gid://shopify/LineItem/40", "ERP-RED",
                "Travel Bag - Red", 2, 1250L, 8495L, "USD",
                true, false, "web.order-add-10", "fingerprint");

        InOrder order = inOrder(orders, commands, audits);
        order.verify(orders).applyShopifyVariantAddition(
                actor, shopId, orderId, listingId, skuId,
                "gid://shopify/Order/10",
                "gid://shopify/Product/20",
                "gid://shopify/ProductVariant/30",
                "gid://shopify/LineItem/40", "ERP-RED",
                "Travel Bag - Red", 2, 1250L, 8495L, "USD");
        order.verify(commands).markSucceeded(
                tenantId, "web.order-add-10", "fingerprint",
                lineId, "gid://shopify/LineItem/40",
                1250L, 8495L, "USD");
        order.verify(audits).recordAtomically(any());
    }
}
