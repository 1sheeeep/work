package cn.xzkj.erp.order.service;

import static cn.xzkj.erp.order.domain.OrderAuditActions.SHOPIFY_CUSTOM_ITEM_ADDED;

import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.order.domain.OrderLine;
import cn.xzkj.erp.order.repository.ShopifyOrderCustomItemCommandRepository;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;
import cn.xzkj.erp.platform.service.ConflictException;

@Service
public class OrderShopifyCustomItemAddFinalizer {

    private final ShopifyOrderCustomItemCommandRepository commands;
    private final OrderCenterService orders;
    private final SecurityAuditRecorder auditRecorder;

    public OrderShopifyCustomItemAddFinalizer(
            ShopifyOrderCustomItemCommandRepository commands,
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
            String externalOrderRef,
            String externalLineRef,
            String title,
            int quantity,
            long unitPriceMinor,
            long totalMinor,
            String currency,
            boolean requiresShipping,
            boolean taxable,
            boolean notifyCustomer,
            boolean recoveredFromShopify,
            String idempotencyKey,
            String fingerprint) {
        OrderAggregate aggregate = orders.applyShopifyCustomItemAddition(
                actor, shopId, orderId, externalOrderRef,
                externalLineRef, title, quantity, unitPriceMinor,
                totalMinor, currency);
        OrderLine line = aggregate.lines().stream()
                .filter(item -> externalLineRef.equals(
                        item.getExternalLineRef()))
                .findFirst()
                .orElseThrow(() -> new ConflictException(
                        "Added Shopify custom order line was not found"));
        commands.markSucceeded(
                actor.tenantId(), idempotencyKey, fingerprint,
                line.getId(), externalLineRef, totalMinor, currency);
        audit(actor, SHOPIFY_CUSTOM_ITEM_ADDED, line.getId(), Map.of(
                        "orderId", orderId.toString(),
                        "quantity", Integer.toString(quantity),
                        "requiresShipping", Boolean.toString(requiresShipping),
                        "taxable", Boolean.toString(taxable),
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
                action, "order_line", lineId.toString(),
                actor.requestId(), actor.sourceIp(), details));
    }
}
