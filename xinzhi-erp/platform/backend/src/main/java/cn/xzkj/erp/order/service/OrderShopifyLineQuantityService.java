package cn.xzkj.erp.order.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;

import cn.xzkj.erp.order.domain.OrderLine;
import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.repository.ShopifyOrderLineEditCommandRepository;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderEditQuantityRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderEditQuantityResult;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;

@Service
public class OrderShopifyLineQuantityService {

    private static final Pattern KEY = Pattern.compile(
            "^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$");
    private static final Pattern ORDER_GID = Pattern.compile(
            "^gid://shopify/Order/[0-9]+$");
    private static final Pattern LINE_GID = Pattern.compile(
            "^gid://shopify/LineItem/[0-9]+$");
    private static final Pattern VARIANT_GID = Pattern.compile(
            "^gid://shopify/ProductVariant/[0-9]+$");
    private static final List<String> REQUIRED_SCOPES = List.of(
            "read_orders", "read_order_edits", "write_order_edits");

    private final ChannelConnectorGateway connector;
    private final OrderCenterService orders;
    private final ShopifyOrderLineEditCommandRepository commands;
    private final OrderShopifyLineQuantityFinalizer finalizer;

    public OrderShopifyLineQuantityService(
            ChannelConnectorGateway connector,
            OrderCenterService orders,
            ShopifyOrderLineEditCommandRepository commands,
            OrderShopifyLineQuantityFinalizer finalizer) {
        this.connector = connector;
        this.orders = orders;
        this.commands = commands;
        this.finalizer = finalizer;
    }

    public UpdateResult update(
            OrderActor actor,
            UUID orderId,
            UpdateCommand command) {
        NormalizedCommand normalized = normalize(actor, orderId, command);
        requireScopes(actor.tenantId(), normalized.shopId());
        String fingerprint = fingerprint(normalized);
        var reservation = commands.reserve(
                actor.tenantId(), normalized.shopId(), normalized.orderId(),
                normalized.lineId(), normalized.externalOrderRef(),
                normalized.externalLineRef(), normalized.externalVariantRef(),
                normalized.idempotencyKey(), fingerprint,
                normalized.expectedQuantity(), normalized.quantity(),
                normalized.restock(), normalized.notifyCustomer());
        if (reservation.replay()) {
            OrderAggregate current = orders.getOrder(actor, normalized.orderId());
            return new UpdateResult(
                    current, false, true,
                    reservation.totalMinor(), reservation.currency(), null);
        }

        OrderEditQuantityResult provider;
        long totalMinor;
        try {
            provider = connector.updateShopifyOrderLineQuantity(
                    actor.tenantId(), normalized.shopId(),
                    new OrderEditQuantityRequest(
                            normalized.externalOrderRef(),
                            normalized.externalLineRef(),
                            normalized.externalVariantRef(),
                            normalized.expectedQuantity(),
                            normalized.quantity(), normalized.restock(),
                            normalized.notifyCustomer(),
                            normalized.idempotencyKey()));
            totalMinor = validateResult(normalized, provider);
            OrderAggregate aggregate = finalizer.finalizeSucceeded(
                    actor, normalized.shopId(), normalized.orderId(),
                    normalized.lineId(), normalized.externalOrderRef(),
                    normalized.externalLineRef(),
                    normalized.externalVariantRef(),
                    normalized.expectedQuantity(), normalized.quantity(),
                    totalMinor, provider.total().currencyCode(),
                    normalized.restock(), normalized.notifyCustomer(),
                    provider.recoveredFromShopify(),
                    normalized.idempotencyKey(), fingerprint);
            return new UpdateResult(
                    aggregate, provider.recoveredFromShopify(), false,
                    totalMinor, provider.total().currencyCode(),
                    provider.updatedAt());
        } catch (RuntimeException exception) {
            try {
                commands.markUncertain(
                        actor.tenantId(), normalized.idempotencyKey(),
                        fingerprint);
            } catch (RuntimeException ignored) {
                exception.addSuppressed(ignored);
            }
            throw new ConflictException("shopify_order_edit_uncertain");
        }
    }

    private NormalizedCommand normalize(
            OrderActor actor,
            UUID orderId,
            UpdateCommand command) {
        if (actor == null || actor.tenantId() == null || orderId == null
                || command == null || command.lineId() == null) {
            throw new IllegalArgumentException(
                    "Order line quantity command is required");
        }
        String key = command.idempotencyKey() == null
                ? "" : command.idempotencyKey().strip();
        if (!KEY.matcher(key).matches()
                || command.expectedQuantity() < 1
                || command.expectedQuantity() > 100_000
                || command.quantity() < 0
                || command.quantity() > 100_000
                || command.quantity() == command.expectedQuantity()
                || (command.restock()
                        && command.quantity() >= command.expectedQuantity())) {
            throw new IllegalArgumentException(
                    "Order line quantity command is invalid");
        }
        OrderAggregate aggregate = orders.getOrder(actor, orderId);
        if (aggregate.order().getStatus() == OrderStatus.READY_TO_FULFILL
                || aggregate.order().getStatus() == OrderStatus.FULFILLING
                || aggregate.order().getStatus() == OrderStatus.SHIPPED
                || aggregate.order().getStatus() == OrderStatus.DELIVERED
                || aggregate.order().getStatus() == OrderStatus.CANCELLED) {
            throw new ConflictException(
                    "Order lines cannot be changed in the current status");
        }
        OrderLine line = aggregate.lines().stream()
                .filter(item -> item.getId().equals(command.lineId()))
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Order line was not found"));
        String orderRef = aggregate.order().getExternalOrderRef();
        String lineRef = line.getExternalLineRef();
        String variantRef = line.getExternalVariantRef();
        if (!ORDER_GID.matcher(orderRef).matches()
                || !LINE_GID.matcher(lineRef).matches()
                || variantRef == null
                || !VARIANT_GID.matcher(variantRef).matches()
                || (line.getQuantity() != command.expectedQuantity()
                        && line.getQuantity() != command.quantity())) {
            throw new ConflictException(
                    "Shopify order line mapping or quantity changed");
        }
        return new NormalizedCommand(
                aggregate.order().getShopId(), orderId, line.getId(),
                orderRef, lineRef, variantRef, key,
                command.expectedQuantity(), command.quantity(),
                command.restock(), command.notifyCustomer(),
                aggregate.order().getCurrency());
    }

    private void requireScopes(UUID tenantId, UUID shopId) {
        var snapshot = connector.snapshot(tenantId, shopId);
        if (snapshot.shopify().status() != ConnectionStatus.CONNECTED) {
            throw ShopifyAuthorizationConflictException.notConnected();
        }
        for (String requiredScope : REQUIRED_SCOPES) {
            var coverage = ChannelConnectorGateway.shopifyScopeCoverage(
                    snapshot.shopifyScopes(), requiredScope);
            if (coverage == null) {
                throw ShopifyAuthorizationConflictException.scopeUnavailable();
            }
            if (coverage
                    == ChannelConnectorGateway.ShopifyScopeCoverageStatus.MISSING) {
                throw ShopifyAuthorizationConflictException.missingScope(
                        requiredScope);
            }
        }
    }

    private static long validateResult(
            NormalizedCommand command,
            OrderEditQuantityResult result) {
        if (result == null
                || !command.externalOrderRef().equals(
                        result.externalOrderRef())
                || !command.externalLineRef().equals(
                        result.externalOrderLineRef())
                || command.quantity() != result.quantity()
                || result.total() == null
                || !command.currency().equals(
                        result.total().currencyCode())) {
            throw new ConflictException(
                    "Shopify returned an invalid order edit result");
        }
        try {
            BigDecimal amount = new BigDecimal(result.total().amount());
            if (amount.signum() < 0) {
                throw new ArithmeticException("negative total");
            }
            return amount.movePointRight(2)
                    .setScale(0, RoundingMode.HALF_UP)
                    .longValueExact();
        } catch (RuntimeException exception) {
            throw new ConflictException(
                    "Shopify returned an invalid order total");
        }
    }

    private static String fingerprint(NormalizedCommand command) {
        String canonical = String.join("\n",
                "SHOPIFY_ORDER_LINE_QUANTITY_EDIT",
                command.shopId().toString(), command.orderId().toString(),
                command.lineId().toString(), command.externalOrderRef(),
                command.externalLineRef(), command.externalVariantRef(),
                Integer.toString(command.expectedQuantity()),
                Integer.toString(command.quantity()),
                Boolean.toString(command.restock()),
                Boolean.toString(command.notifyCustomer()));
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(
                            canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(
                    "SHA-256 is unavailable", impossible);
        }
    }

    public record UpdateCommand(
            UUID lineId,
            int expectedQuantity,
            int quantity,
            boolean restock,
            boolean notifyCustomer,
            String idempotencyKey) {
    }

    public record UpdateResult(
            OrderAggregate order,
            boolean recoveredFromShopify,
            boolean replayed,
            Long totalAmountMinor,
            String currency,
            Instant synchronizedAt) {
    }

    private record NormalizedCommand(
            UUID shopId,
            UUID orderId,
            UUID lineId,
            String externalOrderRef,
            String externalLineRef,
            String externalVariantRef,
            String idempotencyKey,
            int expectedQuantity,
            int quantity,
            boolean restock,
            boolean notifyCustomer,
            String currency) {
    }
}
