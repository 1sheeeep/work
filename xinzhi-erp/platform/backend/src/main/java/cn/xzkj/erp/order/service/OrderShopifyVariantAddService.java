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
import cn.xzkj.erp.order.repository.OrderListingLookupRepository;
import cn.xzkj.erp.order.repository.OrderSkuLookupRepository;
import cn.xzkj.erp.order.repository.ShopifyOrderVariantAddCommandRepository;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Money;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderAddVariantRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderAddVariantResult;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;
import cn.xzkj.erp.product.domain.ListingStatus;
import cn.xzkj.erp.product.domain.ProductStatus;

@Service
public class OrderShopifyVariantAddService {

    private static final Pattern KEY = Pattern.compile(
            "^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$");
    private static final Pattern ORDER_GID = Pattern.compile(
            "^gid://shopify/Order/[0-9]+$");
    private static final Pattern PRODUCT_GID = Pattern.compile(
            "^gid://shopify/Product/[0-9]+$");
    private static final Pattern VARIANT_GID = Pattern.compile(
            "^gid://shopify/ProductVariant/[0-9]+$");
    private static final Pattern LINE_GID = Pattern.compile(
            "^gid://shopify/LineItem/[0-9]+$");
    private static final List<String> REQUIRED_SCOPES = List.of(
            "read_orders", "read_order_edits", "write_order_edits");

    private final ChannelConnectorGateway connector;
    private final OrderCenterService orders;
    private final OrderListingLookupRepository listings;
    private final OrderSkuLookupRepository skus;
    private final ShopifyOrderVariantAddCommandRepository commands;
    private final OrderShopifyVariantAddFinalizer finalizer;

    public OrderShopifyVariantAddService(
            ChannelConnectorGateway connector,
            OrderCenterService orders,
            OrderListingLookupRepository listings,
            OrderSkuLookupRepository skus,
            ShopifyOrderVariantAddCommandRepository commands,
            OrderShopifyVariantAddFinalizer finalizer) {
        this.connector = connector;
        this.orders = orders;
        this.listings = listings;
        this.skus = skus;
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
                normalized.listingId(), normalized.skuId(),
                normalized.externalOrderRef(),
                normalized.externalListingRef(),
                normalized.externalVariantRef(),
                normalized.idempotencyKey(), fingerprint,
                normalized.quantity(), normalized.notifyCustomer());
        if (reservation.replay()) {
            return new AddResult(
                    orders.getOrder(actor, normalized.orderId()),
                    reservation.orderLineId(),
                    reservation.externalLineRef(), false, true,
                    reservation.unitPriceMinor(), reservation.totalMinor(),
                    reservation.currency(), null);
        }

        try {
            OrderAddVariantResult provider = connector.addShopifyOrderVariant(
                    actor.tenantId(), normalized.shopId(),
                    new OrderAddVariantRequest(
                            normalized.externalOrderRef(),
                            normalized.externalVariantRef(),
                            normalized.quantity(),
                            normalized.notifyCustomer(),
                            reservation.existing(),
                            normalized.idempotencyKey()));
            ValidatedProviderResult validated = validateResult(
                    normalized, provider);
            OrderAggregate aggregate = finalizer.finalizeSucceeded(
                    actor, normalized.shopId(), normalized.orderId(),
                    normalized.listingId(), normalized.skuId(),
                    normalized.externalOrderRef(),
                    normalized.externalListingRef(),
                    normalized.externalVariantRef(),
                    provider.externalOrderLineRef(),
                    provider.platformSku(), provider.title(),
                    normalized.quantity(), validated.unitPriceMinor(),
                    validated.totalMinor(), validated.currency(),
                    normalized.notifyCustomer(),
                    provider.recoveredFromShopify(),
                    normalized.idempotencyKey(), fingerprint);
            UUID lineId = aggregate.lines().stream()
                    .filter(line -> provider.externalOrderLineRef().equals(
                            line.getExternalLineRef()))
                    .map(line -> line.getId())
                    .findFirst()
                    .orElseThrow(() -> new ConflictException(
                            "Added Shopify order line was not found"));
            return new AddResult(
                    aggregate, lineId, provider.externalOrderLineRef(),
                    provider.recoveredFromShopify(), false,
                    validated.unitPriceMinor(), validated.totalMinor(),
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
                || command == null || command.listingId() == null) {
            throw new IllegalArgumentException(
                    "Order variant command is required");
        }
        String key = command.idempotencyKey() == null
                ? "" : command.idempotencyKey().strip();
        if (!KEY.matcher(key).matches()
                || command.quantity() < 1
                || command.quantity() > 100_000) {
            throw new IllegalArgumentException(
                    "Order variant command is invalid");
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
        if (!ORDER_GID.matcher(orderRef).matches()) {
            throw new ConflictException(
                    "Shopify order mapping is invalid");
        }
        var listing = listings.findByIdAndTenantIdAndShopIdAndStatus(
                        command.listingId(), actor.tenantId(),
                        aggregate.order().getShopId(), ListingStatus.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product listing was not found"));
        String listingRef = listing.getExternalListingRef();
        String variantRef = listing.getExternalVariantRef();
        if (!PRODUCT_GID.matcher(listingRef).matches()
                || variantRef == null
                || !VARIANT_GID.matcher(variantRef).matches()
                || aggregate.lines().stream().anyMatch(line ->
                        variantRef.equals(line.getExternalVariantRef()))) {
            throw new ConflictException(
                    "Shopify product listing cannot be added to this order");
        }
        var sku = skus.findByIdAndTenantId(
                        listing.getSkuId(), actor.tenantId())
                .filter(item -> item.getStatus() == ProductStatus.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Product SKU was not found"));
        if (sku.getBusinessCode() == null
                || sku.getBusinessCode().isBlank()) {
            throw new ConflictException(
                    "Product SKU mapping is invalid");
        }
        return new NormalizedCommand(
                aggregate.order().getShopId(), orderId,
                listing.getId(), sku.getId(), orderRef, listingRef,
                variantRef, sku.getBusinessCode(), key,
                command.quantity(), command.notifyCustomer(),
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

    private static ValidatedProviderResult validateResult(
            NormalizedCommand command,
            OrderAddVariantResult result) {
        if (result == null
                || !command.externalOrderRef().equals(
                        result.externalOrderRef())
                || !command.externalVariantRef().equals(
                        result.externalVariantRef())
                || !LINE_GID.matcher(
                        result.externalOrderLineRef()).matches()
                || command.quantity() != result.quantity()
                || !command.platformSku().equals(result.platformSku())
                || result.title() == null || result.title().isBlank()
                || result.title().length() > 300
                || result.unitPrice() == null || result.total() == null
                || !command.currency().equals(
                        result.unitPrice().currencyCode())
                || !command.currency().equals(
                        result.total().currencyCode())) {
            throw new ConflictException(
                    "Shopify returned an invalid added order line");
        }
        return new ValidatedProviderResult(
                moneyMinor(result.unitPrice()), moneyMinor(result.total()),
                command.currency());
    }

    private static long moneyMinor(Money money) {
        try {
            BigDecimal amount = new BigDecimal(money.amount());
            if (amount.signum() < 0) {
                throw new ArithmeticException("negative money");
            }
            return amount.movePointRight(2)
                    .setScale(0, RoundingMode.HALF_UP)
                    .longValueExact();
        } catch (RuntimeException exception) {
            throw new ConflictException(
                    "Shopify returned an invalid order amount");
        }
    }

    private static String fingerprint(NormalizedCommand command) {
        String canonical = String.join("\n",
                "SHOPIFY_ORDER_VARIANT_ADD",
                command.shopId().toString(), command.orderId().toString(),
                command.listingId().toString(), command.skuId().toString(),
                command.externalOrderRef(),
                command.externalListingRef(),
                command.externalVariantRef(),
                Integer.toString(command.quantity()),
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
            UUID listingId,
            int quantity,
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
            UUID listingId,
            UUID skuId,
            String externalOrderRef,
            String externalListingRef,
            String externalVariantRef,
            String platformSku,
            String idempotencyKey,
            int quantity,
            boolean notifyCustomer,
            String currency) {
    }

    private record ValidatedProviderResult(
            long unitPriceMinor,
            long totalMinor,
            String currency) {
    }
}
