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
import cn.xzkj.erp.order.domain.OrderLineKind;
import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.repository.ShopifyOrderLineDiscountCommandRepository;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Money;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderLineDiscountRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderLineDiscountResult;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderLineDiscountType;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;

@Service
public class OrderShopifyLineDiscountService {

    private static final Pattern KEY = Pattern.compile(
            "^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$");
    private static final Pattern ORDER_GID = Pattern.compile(
            "^gid://shopify/Order/[0-9]+$");
    private static final Pattern LINE_GID = Pattern.compile(
            "^gid://shopify/LineItem/[0-9]+$");
    private static final Pattern VARIANT_GID = Pattern.compile(
            "^gid://shopify/ProductVariant/[0-9]+$");
    private static final Pattern CURRENCY = Pattern.compile("^[A-Z]{3}$");
    private static final List<String> REQUIRED_SCOPES = List.of(
            "read_orders", "read_order_edits", "write_order_edits");

    private final ChannelConnectorGateway connector;
    private final OrderCenterService orders;
    private final ShopifyOrderLineDiscountCommandRepository commands;
    private final OrderShopifyLineDiscountFinalizer finalizer;

    public OrderShopifyLineDiscountService(
            ChannelConnectorGateway connector,
            OrderCenterService orders,
            ShopifyOrderLineDiscountCommandRepository commands,
            OrderShopifyLineDiscountFinalizer finalizer) {
        this.connector = connector;
        this.orders = orders;
        this.commands = commands;
        this.finalizer = finalizer;
    }

    public DiscountResult add(
            OrderActor actor,
            UUID orderId,
            DiscountCommand command) {
        NormalizedCommand normalized = normalize(actor, orderId, command);
        requireScopes(actor.tenantId(), normalized.shopId());
        String fingerprint = fingerprint(normalized);
        var reservation = commands.reserve(
                actor.tenantId(), normalized.shopId(), normalized.orderId(),
                normalized.orderLineId(), normalized.externalOrderRef(),
                normalized.externalOrderLineRef(),
                normalized.externalVariantRef(), normalized.expectedQuantity(),
                normalized.expectedDiscountTotalMinor(),
                normalized.description(), normalized.discountType(),
                normalized.fixedValueMinor(), normalized.percentBasisPoints(),
                normalized.currency(), normalized.notifyCustomer(),
                normalized.idempotencyKey(), fingerprint);
        if (reservation.replay()) {
            return new DiscountResult(
                    orders.getOrder(actor, normalized.orderId()),
                    normalized.orderLineId(), false, true,
                    reservation.discountTotalMinor(), reservation.totalMinor(),
                    reservation.currency(), null);
        }

        try {
            OrderLineDiscountResult provider =
                    connector.addShopifyOrderLineDiscount(
                            actor.tenantId(), normalized.shopId(),
                            new OrderLineDiscountRequest(
                                    normalized.externalOrderRef(),
                                    normalized.externalOrderLineRef(),
                                    normalized.externalVariantRef(),
                                    normalized.expectedQuantity(),
                                    new Money(amount(
                                            normalized.expectedDiscountTotalMinor()),
                                            normalized.currency()),
                                    normalized.description(),
                                    normalized.discountType(),
                                    normalized.fixedValueMinor() == null
                                            ? null : new Money(
                                                    amount(normalized.fixedValueMinor()),
                                                    normalized.currency()),
                                    normalized.percentBasisPoints(),
                                    normalized.notifyCustomer(),
                                    reservation.existing(),
                                    normalized.idempotencyKey()));
            ValidatedProviderResult validated = validateResult(
                    normalized, provider);
            OrderAggregate aggregate = finalizer.finalizeSucceeded(
                    actor, normalized, validated,
                    provider.recoveredFromShopify(), fingerprint);
            return new DiscountResult(
                    aggregate, normalized.orderLineId(),
                    provider.recoveredFromShopify(), false,
                    validated.discountTotalMinor(), validated.totalMinor(),
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
            DiscountCommand command) {
        if (actor == null || actor.tenantId() == null || orderId == null
                || command == null || command.orderLineId() == null
                || command.discountType() == null) {
            throw new IllegalArgumentException(
                    "Order line discount command is required");
        }
        String description = command.description() == null
                ? "" : command.description().strip();
        String key = command.idempotencyKey() == null
                ? "" : command.idempotencyKey().strip();
        boolean valueValid = command.discountType()
                == OrderLineDiscountType.FIXED
                ? command.fixedValueMinor() != null
                    && command.fixedValueMinor() > 0
                    && command.percentBasisPoints() == null
                : command.discountType() == OrderLineDiscountType.PERCENTAGE
                    && command.fixedValueMinor() == null
                    && command.percentBasisPoints() != null
                    && command.percentBasisPoints() >= 1
                    && command.percentBasisPoints() <= 10_000;
        if (description.isEmpty() || description.length() > 255
                || !KEY.matcher(key).matches() || !valueValid) {
            throw new IllegalArgumentException(
                    "Order line discount command is invalid");
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
                .filter(item -> command.orderLineId().equals(item.getId()))
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Order line was not found"));
        String orderRef = aggregate.order().getExternalOrderRef();
        String currency = aggregate.order().getCurrency();
        if (line.getLineKind() != OrderLineKind.PRODUCT
                || !ORDER_GID.matcher(orderRef).matches()
                || !LINE_GID.matcher(line.getExternalLineRef()).matches()
                || !VARIANT_GID.matcher(
                        line.getExternalVariantRef() == null
                                ? "" : line.getExternalVariantRef()).matches()
                || line.getQuantity() < 1
                || currency == null || !CURRENCY.matcher(currency).matches()) {
            throw new ConflictException(
                    "Shopify order line discount mapping is invalid");
        }
        return new NormalizedCommand(
                aggregate.order().getShopId(), orderId, line.getId(), orderRef,
                line.getExternalLineRef(), line.getExternalVariantRef(),
                line.getQuantity(), line.getDiscountTotalMinor(), description,
                command.discountType(), command.fixedValueMinor(),
                command.percentBasisPoints(), currency,
                command.notifyCustomer(), key);
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
            OrderLineDiscountResult result) {
        if (result == null
                || !command.externalOrderRef().equals(
                        result.externalOrderRef())
                || !command.externalOrderLineRef().equals(
                        result.externalOrderLineRef())
                || !command.description().equals(result.description())
                || command.discountType() != result.discountType()
                || result.discountTotal() == null || result.total() == null
                || !command.currency().equals(
                        result.discountTotal().currencyCode())
                || !command.currency().equals(result.total().currencyCode())) {
            throw new ConflictException(
                    "Shopify returned an invalid order line discount");
        }
        long discountTotalMinor = moneyMinor(result.discountTotal());
        long totalMinor = moneyMinor(result.total());
        if (discountTotalMinor <= command.expectedDiscountTotalMinor()) {
            throw new ConflictException(
                    "Shopify returned an invalid order line discount total");
        }
        if (command.discountType() == OrderLineDiscountType.FIXED
                && (result.fixedValue() == null
                    || !command.currency().equals(
                            result.fixedValue().currencyCode())
                    || moneyMinor(result.fixedValue())
                        != command.fixedValueMinor()
                    || result.percentBasisPoints() != null)) {
            throw new ConflictException(
                    "Shopify returned an invalid fixed discount");
        }
        if (command.discountType() == OrderLineDiscountType.PERCENTAGE
                && (result.fixedValue() != null
                    || !command.percentBasisPoints().equals(
                            result.percentBasisPoints()))) {
            throw new ConflictException(
                    "Shopify returned an invalid percentage discount");
        }
        return new ValidatedProviderResult(
                discountTotalMinor, totalMinor, command.currency());
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
                "SHOPIFY_ORDER_LINE_DISCOUNT_ADD",
                command.shopId().toString(), command.orderId().toString(),
                command.orderLineId().toString(), command.externalOrderRef(),
                command.externalOrderLineRef(), command.externalVariantRef(),
                Integer.toString(command.expectedQuantity()),
                Long.toString(command.expectedDiscountTotalMinor()),
                command.description(), command.discountType().name(),
                String.valueOf(command.fixedValueMinor()),
                String.valueOf(command.percentBasisPoints()),
                command.currency(),
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

    public record DiscountCommand(
            UUID orderLineId,
            String description,
            OrderLineDiscountType discountType,
            Long fixedValueMinor,
            Integer percentBasisPoints,
            boolean notifyCustomer,
            String idempotencyKey) {
    }

    public record DiscountResult(
            OrderAggregate order,
            UUID lineId,
            boolean recoveredFromShopify,
            boolean replayed,
            Long discountTotalMinor,
            Long totalAmountMinor,
            String currency,
            Instant synchronizedAt) {
    }

    record NormalizedCommand(
            UUID shopId,
            UUID orderId,
            UUID orderLineId,
            String externalOrderRef,
            String externalOrderLineRef,
            String externalVariantRef,
            int expectedQuantity,
            long expectedDiscountTotalMinor,
            String description,
            OrderLineDiscountType discountType,
            Long fixedValueMinor,
            Integer percentBasisPoints,
            String currency,
            boolean notifyCustomer,
            String idempotencyKey) {
    }

    record ValidatedProviderResult(
            long discountTotalMinor,
            long totalMinor,
            String currency) {
    }
}
