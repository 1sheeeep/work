package cn.xzkj.erp.order.service;

import static cn.xzkj.erp.order.domain.OrderAuditActions.SHOPIFY_LINE_QUANTITY_UPDATED;

import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.order.repository.ShopifyOrderLineEditCommandRepository;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;

@Service
public class OrderShopifyLineQuantityFinalizer {

    private final ShopifyOrderLineEditCommandRepository commands;
    private final OrderCenterService orders;
    private final SecurityAuditRecorder auditRecorder;

    public OrderShopifyLineQuantityFinalizer(
            ShopifyOrderLineEditCommandRepository commands,
            OrderCenterService orders,
            SecurityAuditRecorder auditRecorder) {
        this.commands = commands;
        this.orders = orders;
        this.auditRecorder = auditRecorder;
    }

    @Transactional
    public OrderAggregate finalizeSucceeded(
            OrderActor actor,
            UUID shopId,
            UUID orderId,
            UUID lineId,
            String externalOrderRef,
            String externalLineRef,
            String externalVariantRef,
            int expectedQuantity,
            int quantity,
            long totalMinor,
            String currency,
            boolean restock,
            boolean notifyCustomer,
            boolean recoveredFromShopify,
            String idempotencyKey,
            String fingerprint) {
        OrderAggregate aggregate = orders.applyShopifyLineQuantityUpdate(
                actor, shopId, orderId, lineId,
                externalOrderRef, externalLineRef, externalVariantRef,
                expectedQuantity, quantity, totalMinor, currency);
        commands.markSucceeded(
                actor.tenantId(), idempotencyKey, fingerprint,
                quantity, totalMinor, currency);
        audit(actor, SHOPIFY_LINE_QUANTITY_UPDATED, lineId, Map.of(
                "orderId", orderId.toString(),
                "fromQuantity", Integer.toString(expectedQuantity),
                "toQuantity", Integer.toString(quantity),
                "restock", Boolean.toString(restock),
                "notifyCustomer", Boolean.toString(notifyCustomer),
                "recovered", Boolean.toString(recoveredFromShopify)));
        return aggregate;
    }

    private void audit(
            OrderActor actor,
            String action,
            UUID lineId,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                action, "order_line",
                lineId.toString(), actor.requestId(), actor.sourceIp(),
                details));
    }
}
