package cn.xzkj.erp.order.service;

import static cn.xzkj.erp.order.domain.OrderAuditActions.SHOPIFY_LINE_DISCOUNT_ADDED;

import java.util.Map;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.order.repository.ShopifyOrderLineDiscountCommandRepository;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;
import cn.xzkj.erp.order.service.OrderShopifyLineDiscountService.NormalizedCommand;
import cn.xzkj.erp.order.service.OrderShopifyLineDiscountService.ValidatedProviderResult;

@Service
public class OrderShopifyLineDiscountFinalizer {

    private final ShopifyOrderLineDiscountCommandRepository commands;
    private final OrderCenterService orders;
    private final SecurityAuditRecorder auditRecorder;

    public OrderShopifyLineDiscountFinalizer(
            ShopifyOrderLineDiscountCommandRepository commands,
            OrderCenterService orders,
            SecurityAuditRecorder auditRecorder) {
        this.commands = commands;
        this.orders = orders;
        this.auditRecorder = auditRecorder;
    }

    @Transactional
    public OrderAggregate finalizeSucceeded(
            OrderActor actor,
            NormalizedCommand command,
            ValidatedProviderResult result,
            boolean recoveredFromShopify,
            String fingerprint) {
        OrderAggregate aggregate = orders.applyShopifyOrderLineDiscount(
                actor, command.shopId(), command.orderId(),
                command.externalOrderRef(), command.orderLineId(),
                command.externalOrderLineRef(),
                command.expectedDiscountTotalMinor(),
                result.discountTotalMinor(), command.description(),
                result.totalMinor(), result.currency());
        commands.markSucceeded(
                actor.tenantId(), command.idempotencyKey(), fingerprint,
                result.discountTotalMinor(), result.totalMinor(),
                result.currency());
        audit(actor, SHOPIFY_LINE_DISCOUNT_ADDED, command, result,
                recoveredFromShopify);
        return aggregate;
    }

    private void audit(
            OrderActor actor,
            String action,
            NormalizedCommand command,
            ValidatedProviderResult result,
            boolean recoveredFromShopify) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                action, "order_line",
                command.orderLineId().toString(), actor.requestId(),
                actor.sourceIp(), Map.of(
                        "orderId", command.orderId().toString(),
                        "discountType", command.discountType().name(),
                        "discountTotalMinor",
                            Long.toString(result.discountTotalMinor()),
                        "notifyCustomer",
                            Boolean.toString(command.notifyCustomer()),
                        "recovered",
                            Boolean.toString(recoveredFromShopify))));
    }
}
