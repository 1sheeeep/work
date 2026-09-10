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

import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.repository.ShopifyOrderCustomItemCommandRepository;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Money;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderAddCustomItemRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderAddCustomItemResult;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;

@Service
public class OrderShopifyCustomItemAddService {

    private static final Pattern KEY = Pattern.compile(
            "^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$");
    private static final Pattern ORDER_GID = Pattern.compile(
            "^gid://shopify/Order/[0-9]+$");
    private static final Pattern LINE_GID = Pattern.compile(
            "^gid://shopify/LineItem/[0-9]+$");
    private static final Pattern CURRENCY = Pattern.compile("^[A-Z]{3}$");
    private static final List<String> REQUIRED_SCOPES = List.of(
            "read_orders", "read_order_edits", "write_order_edits");

    private final ChannelConnectorGateway connector;
    private final OrderCenterService orders;
    private final ShopifyOrderCustomItemCommandRepository commands;
    private final OrderShopifyCustomItemAddFinalizer finalizer;

    public OrderShopifyCustomItemAddService(
            ChannelConnectorGateway connector,
            OrderCenterService orders,
            ShopifyOrderCustomItemCommandRepository commands,
            OrderShopifyCustomItemAddFinalizer finalizer) {
        this.connector = connector;
        this.orders = orders;
        this.commands = commands;
        this.finalizer = finalizer;
    }

    public AddResult add(
            OrderActor actor,
            UUID orderId,
            AddCommand command) {
        NormalizedCommand normalized = normalize(actor, orderId, command);
        requireScopes(actor.tenantId(), normalized.shopId());
        String fingerprint = fingerprint(normalized);
        var reservation = commands.reserve(
                actor.tenantId(), normalized.shopId(), normalized.orderId(),
                normalized.externalOrderRef(), normalized.title(),
                normalized.unitPriceMinor(), normalized.currency(),
                normalized.quantity(), normalized.requiresShipping(),
                normalized.taxable(), normalized.notifyCustomer(),
                normalized.idempotencyKey(), fingerprint);
        if (reservation.replay()) {
            return new AddResult(
                    orders.getOrder(actor, normalized.orderId()),
                    reservation.orderLineId(),
                    reservation.externalLineRef(), false, true,
                    normalized.unitPriceMinor(), reservation.totalMinor(),
                    reservation.currency(), null);
        }

        try {
            OrderAddCustomItemResult provider =
                    connector.addShopifyOrderCustomItem(
                            actor.tenantId(), normalized.shopId(),
                            new OrderAddCustomItemRequest(
                                    normalized.externalOrderRef(),
                                    normalized.title(),
                                    new Money(
                                            amount(normalized.unitPriceMinor()),
                                            normalized.currency()),
                                    normalized.quantity(),
                                    normalized.requiresShipping(),
                                    normalized.taxable(),
                                    normalized.notifyCustomer(),
                                    reservation.existing(),
                                    normalized.idempotencyKey()));
            ValidatedProviderResult validated = validateResult(
                    normalized, provider);
            OrderAggregate aggregate = finalizer.finalizeSucceeded(
                    actor, normalized.shopId(), normalized.orderId(),
                    normalized.externalOrderRef(),
                    provider.externalOrderLineRef(), normalized.title(),
                    normalized.quantity(), normalized.unitPriceMinor(),
                    validated.totalMinor(), validated.currency(),
                    normalized.requiresShipping(), normalized.taxable(),
                    normalized.notifyCustomer(),
                    provider.recoveredFromShopify(),
                    normalized.idempotencyKey(), fingerprint);
            UUID lineId = aggregate.lines().stream()
                    .filter(line -> provider.externalOrderLineRef().equals(
                            line.getExternalLineRef()))
                    .map(line -> line.getId())
                    .findFirst()
                    .orElseThrow(() -> new ConflictException(
                            "Added Shopify custom order line was not found"));
            return new AddResult(
                    aggregate, lineId, provider.externalOrderLineRef(),
                    provider.recoveredFromShopify(), false,
                    normalized.unitPriceMinor(), validated.totalMinor(),
                    validated.currency(), provider.updatedAt());
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
            AddCommand command) {
        if (actor == null || actor.tenantId() == null || orderId == null
                || command == null) {
            throw new IllegalArgumentException(
                    "Custom order item command is required");
        }
        String title = command.title() == null
                ? "" : command.title().strip();
        String key = command.idempotencyKey() == null
                ? "" : command.idempotencyKey().strip();
        if (title.isEmpty() || title.length() > 255
                || !KEY.matcher(key).matches()
                || command.unitPriceMinor() < 0
                || command.quantity() < 1
                || command.quantity() > 100_000) {
            throw new IllegalArgumentException(
                    "Custom order item command is invalid");
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
        String orderRef = aggregate.order().getExternalOrderRef();
        String currency = aggregate.order().getCurrency();
        if (!ORDER_GID.matcher(orderRef).matches()
                || currency == null
                || !CURRENCY.matcher(currency).matches()) {
            throw new ConflictException("Shopify order mapping is invalid");
        }
        return new NormalizedCommand(
                aggregate.order().getShopId(), orderId, orderRef,
                title, command.unitPriceMinor(), currency,
                command.quantity(), command.requiresShipping(),
                command.taxable(), command.notifyCustomer(), key);
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

    private static ValidatedProviderResult validateResult(
            NormalizedCommand command,
            OrderAddCustomItemResult result) {
        if (result == null
                || !command.externalOrderRef().equals(
                        result.externalOrderRef())
                || !LINE_GID.matcher(
                        result.externalOrderLineRef()).matches()
                || !command.title().equals(result.title())
                || command.quantity() != result.quantity()
                || result.unitPrice() == null || result.total() == null
                || !command.currency().equals(
                        result.unitPrice().currencyCode())
                || !command.currency().equals(
                        result.total().currencyCode())
                || moneyMinor(result.unitPrice())
                        != command.unitPriceMinor()) {
            throw new ConflictException(
                    "Shopify returned an invalid custom order item");
        }
        return new ValidatedProviderResult(
                moneyMinor(result.total()), command.currency());
    }

    private static long moneyMinor(Money money) {
        try {
            BigDecimal value = new BigDecimal(money.amount());
            if (value.signum() < 0) {
                throw new ArithmeticException("negative money");
            }
            return value.movePointRight(2)
                    .setScale(0, RoundingMode.HALF_UP)
                    .longValueExact();
        } catch (RuntimeException exception) {
            throw new ConflictException(
                    "Shopify returned an invalid order amount");
        }
    }

    private static String amount(long minor) {
        return BigDecimal.valueOf(minor, 2).toPlainString();
    }

    private static String fingerprint(NormalizedCommand command) {
        String canonical = String.join("\n",
                "SHOPIFY_ORDER_CUSTOM_ITEM_ADD",
                command.shopId().toString(), command.orderId().toString(),
                command.externalOrderRef(), command.title(),
                Long.toString(command.unitPriceMinor()), command.currency(),
                Integer.toString(command.quantity()),
                Boolean.toString(command.requiresShipping()),
                Boolean.toString(command.taxable()),
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

    public record AddCommand(
            String title,
            long unitPriceMinor,
            int quantity,
            boolean requiresShipping,
            boolean taxable,
            boolean notifyCustomer,
            String idempotencyKey) {
    }

    public record AddResult(
            OrderAggregate order,
            UUID lineId,
            String externalLineRef,
            boolean recoveredFromShopify,
            boolean replayed,
            Long unitPriceMinor,
            Long totalAmountMinor,
            String currency,
            Instant synchronizedAt) {
    }

    private record NormalizedCommand(
            UUID shopId,
            UUID orderId,
            String externalOrderRef,
            String title,
            long unitPriceMinor,
            String currency,
            int quantity,
            boolean requiresShipping,
            boolean taxable,
            boolean notifyCustomer,
            String idempotencyKey) {
    }

    private record ValidatedProviderResult(
            long totalMinor,
            String currency) {
    }
}
