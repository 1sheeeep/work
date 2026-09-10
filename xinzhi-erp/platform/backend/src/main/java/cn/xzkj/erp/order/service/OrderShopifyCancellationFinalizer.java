package cn.xzkj.erp.order.service;

import static cn.xzkj.erp.order.domain.OrderAuditActions.SHOPIFY_ORDER_CANCELLED;

import java.util.Map;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.order.repository.ShopifyOrderCancellationCommandRepository;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;
import cn.xzkj.erp.order.service.OrderShopifyCancellationService.NormalizedCommand;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderCancellationResult;

@Service
public class OrderShopifyCancellationFinalizer {
    private final ShopifyOrderCancellationCommandRepository commands;
    private final OrderCenterService orders;
    private final SecurityAuditRecorder auditRecorder;

    public OrderShopifyCancellationFinalizer(
            ShopifyOrderCancellationCommandRepository commands,
            OrderCenterService orders,
            SecurityAuditRecorder auditRecorder) {
        this.commands = commands;
        this.orders = orders;
        this.auditRecorder = auditRecorder;
    }

    @Transactional
    public OrderAggregate finalizeSucceeded(
            OrderActor actor, NormalizedCommand command,
            OrderCancellationResult provider, String fingerprint) {
        OrderAggregate aggregate = orders.applyShopifyCancellation(
                actor, command.shopId(), command.orderId(),
                command.externalOrderRef(), command.expectedOrderVersion(),
                command.expectedProfileVersion(), provider.cancelledAt());
        commands.markSucceeded(
                actor.tenantId(), command.idempotencyKey(), fingerprint,
                provider.cancelledAt(), provider.jobId());
        audit(actor, SHOPIFY_ORDER_CANCELLED, command, provider);
        return aggregate;
    }

    private void audit(
            OrderActor actor, String action, NormalizedCommand command,
            OrderCancellationResult provider) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                action, "order", command.orderId().toString(),
                actor.requestId(), actor.sourceIp(), Map.of(
                        "reason", command.reason().name(),
                        "refundOriginalPaymentMethods",
                            Boolean.toString(command.refundOriginalPaymentMethods()),
                        "restock", Boolean.toString(command.restock()),
                        "notifyCustomer", Boolean.toString(command.notifyCustomer()),
                        "recovered", Boolean.toString(
                                provider.recoveredFromShopify()))));
    }
}
