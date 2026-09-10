package cn.xzkj.erp.order.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.order.repository.ShopifyOrderLineEditCommandRepository;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;

class OrderShopifyLineQuantityFinalizerTest {

    @Test
    void commitsLocalOrderAndCommandBeforeAtomicAudit() {
        var commands = mock(
                ShopifyOrderLineEditCommandRepository.class);
        var orders = mock(OrderCenterService.class);
        var audits = mock(SecurityAuditRecorder.class);
        var aggregate = mock(OrderAggregate.class);
        var finalizer = new OrderShopifyLineQuantityFinalizer(
                commands, orders, audits);
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        UUID orderId = UUID.randomUUID();
        UUID lineId = UUID.randomUUID();
        var actor = new OrderActor(
                tenantId, UUID.randomUUID(), null,
                "request-1", "127.0.0.1");
        when(orders.applyShopifyLineQuantityUpdate(
                actor, shopId, orderId, lineId,
                "gid://shopify/Order/10",
                "gid://shopify/LineItem/20",
                "gid://shopify/ProductVariant/30",
                2, 1, 4995L, "USD"))
                .thenReturn(aggregate);

        finalizer.finalizeSucceeded(
                actor, shopId, orderId, lineId,
                "gid://shopify/Order/10",
                "gid://shopify/LineItem/20",
                "gid://shopify/ProductVariant/30",
                2, 1, 4995L, "USD",
                true, true, false,
                "web.order-edit-10", "fingerprint");

        InOrder order = inOrder(orders, commands, audits);
        order.verify(orders).applyShopifyLineQuantityUpdate(
                actor, shopId, orderId, lineId,
                "gid://shopify/Order/10",
                "gid://shopify/LineItem/20",
                "gid://shopify/ProductVariant/30",
                2, 1, 4995L, "USD");
        order.verify(commands).markSucceeded(
                tenantId, "web.order-edit-10", "fingerprint",
                1, 4995L, "USD");
        order.verify(audits).recordAtomically(any());
    }
}
