package cn.xzkj.erp.order.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;

import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.repository.ShopifyOrderCancellationCommandRepository;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderCancellationReason;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderCancellationRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderCancellationResult;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;

@Service
public class OrderShopifyCancellationService {
    private static final Pattern KEY = Pattern.compile(
            "^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$");
    private static final Pattern ORDER_GID = Pattern.compile(
            "^gid://shopify/Order/[0-9]+$");
    private static final List<String> REQUIRED_SCOPES = List.of(
            "read_orders", "write_orders");

    private final ChannelConnectorGateway connector;
    private final OrderCenterService orders;
    private final ShopifyOrderCancellationCommandRepository commands;
    private final OrderShopifyCancellationFinalizer finalizer;

    public OrderShopifyCancellationService(
            ChannelConnectorGateway connector,
            OrderCenterService orders,
            ShopifyOrderCancellationCommandRepository commands,
            OrderShopifyCancellationFinalizer finalizer) {
        this.connector = connector;
        this.orders = orders;
        this.commands = commands;
        this.finalizer = finalizer;
    }

    public CancellationResult cancel(
            OrderActor actor, UUID orderId, CancellationCommand command) {
        NormalizedCommand normalized = normalize(actor, orderId, command);
        requireScopes(actor.tenantId(), normalized.shopId());
        String fingerprint = fingerprint(normalized);
        var reservation = commands.reserve(
                actor.tenantId(), normalized.shopId(), normalized.orderId(),
                normalized.externalOrderRef(), normalized.expectedOrderVersion(),
                normalized.expectedProfileVersion(), normalized.reason().name(),
                normalized.refundOriginalPaymentMethods(), normalized.restock(),
                normalized.notifyCustomer(), normalized.idempotencyKey(), fingerprint);
        if (reservation.replay()) {
            return new CancellationResult(
                    orders.getOrder(actor, orderId), false, true,
                    reservation.cancelledAt(), reservation.jobId(), null);
        }
        try {
            OrderCancellationResult provider = connector.cancelShopifyOrder(
                    actor.tenantId(), normalized.shopId(),
                    new OrderCancellationRequest(
                            normalized.externalOrderRef(), normalized.reason(),
                            normalized.staffNote(),
                            normalized.refundOriginalPaymentMethods(),
                            normalized.restock(), normalized.notifyCustomer(),
                            reservation.existing(), normalized.idempotencyKey()));
            validateProvider(normalized, provider);
            OrderAggregate aggregate = finalizer.finalizeSucceeded(
                    actor, normalized, provider, fingerprint);
            return new CancellationResult(
                    aggregate, provider.recoveredFromShopify(), false,
                    provider.cancelledAt(), provider.jobId(), provider.updatedAt());
        } catch (RuntimeException exception) {
            try {
                commands.markUncertain(actor.tenantId(),
                        normalized.idempotencyKey(), fingerprint);
            } catch (RuntimeException ignored) {
                exception.addSuppressed(ignored);
            }
            throw new ConflictException("shopify_order_cancellation_uncertain");
        }
    }

    private NormalizedCommand normalize(
            OrderActor actor, UUID orderId, CancellationCommand command) {
        if (actor == null || actor.tenantId() == null || orderId == null
                || command == null || command.reason() == null) {
            throw new IllegalArgumentException("Order cancellation is required");
        }
        String key = command.idempotencyKey() == null
                ? "" : command.idempotencyKey().strip();
        String note = command.staffNote() == null
                ? "" : command.staffNote().strip();
        if (!KEY.matcher(key).matches() || note.length() > 180
                || note.chars().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("Order cancellation is invalid");
        }
        OrderAggregate aggregate = orders.getOrder(actor, orderId);
        if (aggregate.order().getStatus() == OrderStatus.FULFILLING
                || aggregate.order().getStatus() == OrderStatus.SHIPPED
                || aggregate.order().getStatus() == OrderStatus.DELIVERED
                || aggregate.order().getStatus() == OrderStatus.CANCELLED) {
            throw new ConflictException(
                    "Order cannot be cancelled in the current status");
        }
        if (!ORDER_GID.matcher(
                aggregate.order().getExternalOrderRef()).matches()) {
            throw new ConflictException("Shopify order mapping is invalid");
        }
        return new NormalizedCommand(
                aggregate.order().getShopId(), orderId,
                aggregate.order().getExternalOrderRef(),
                aggregate.order().getVersion(), aggregate.profile().version(),
                command.reason(), note,
                command.refundOriginalPaymentMethods(), command.restock(),
                command.notifyCustomer(), key);
    }

    private void requireScopes(UUID tenantId, UUID shopId) {
        var snapshot = connector.snapshot(tenantId, shopId);
        if (snapshot.shopify().status() != ConnectionStatus.CONNECTED) {
            throw ShopifyAuthorizationConflictException.notConnected();
        }
        for (String required : REQUIRED_SCOPES) {
            var coverage = ChannelConnectorGateway.shopifyScopeCoverage(
                    snapshot.shopifyScopes(), required);
            if (coverage == null) {
                throw ShopifyAuthorizationConflictException.scopeUnavailable();
            }
            if (coverage
                    == ChannelConnectorGateway.ShopifyScopeCoverageStatus.MISSING) {
                throw ShopifyAuthorizationConflictException.missingScope(required);
            }
        }
    }

    private static void validateProvider(
            NormalizedCommand command, OrderCancellationResult result) {
        if (result == null
                || !command.externalOrderRef().equals(result.externalOrderRef())
                || command.reason() != result.reason()
                || result.cancelledAt() == null
                || result.cancelledAt().isAfter(Instant.now().plusSeconds(60))) {
            throw new ConflictException(
                    "Shopify returned an invalid cancellation result");
        }
    }

    private static String fingerprint(NormalizedCommand command) {
        String value = String.join("\n", "SHOPIFY_ORDER_CANCEL",
                command.shopId().toString(), command.orderId().toString(),
                command.externalOrderRef(),
                Long.toString(command.expectedOrderVersion()),
                Long.toString(command.expectedProfileVersion()),
                command.reason().name(), command.staffNote(),
                Boolean.toString(command.refundOriginalPaymentMethods()),
                Boolean.toString(command.restock()),
                Boolean.toString(command.notifyCustomer()));
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    public record CancellationCommand(
            OrderCancellationReason reason,
            String staffNote,
            boolean refundOriginalPaymentMethods,
            boolean restock,
            boolean notifyCustomer,
            String idempotencyKey) { }

    public record CancellationResult(
            OrderAggregate order,
            boolean recoveredFromShopify,
            boolean replayed,
            Instant cancelledAt,
            String jobId,
            Instant synchronizedAt) { }

    record NormalizedCommand(
            UUID shopId, UUID orderId, String externalOrderRef,
            long expectedOrderVersion, long expectedProfileVersion,
            OrderCancellationReason reason, String staffNote,
            boolean refundOriginalPaymentMethods, boolean restock,
            boolean notifyCustomer, String idempotencyKey) { }
}
