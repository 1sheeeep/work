package cn.xzkj.erp.order.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;

import cn.xzkj.erp.order.domain.OrderProfile;
import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.repository.ShopifyOrderCommandRepository;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderCenterService.OrderAggregate;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.MailingAddress;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderShippingAddressUpdateRequest;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;

@Service
public class OrderShopifyShippingAddressService {

    private static final Pattern IDEMPOTENCY_KEY =
            Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$");
    private static final Pattern COUNTRY_CODE = Pattern.compile("^[A-Z]{2}$");

    private final OrderCenterService orders;
    private final ShopifyOrderCommandRepository commands;
    private final ChannelConnectorGateway connector;

    public OrderShopifyShippingAddressService(
            OrderCenterService orders,
            ShopifyOrderCommandRepository commands,
            ChannelConnectorGateway connector) {
        this.orders = orders;
        this.commands = commands;
        this.connector = connector;
    }

    public ShippingAddressUpdateResult update(
            OrderActor actor,
            UUID orderId,
            ShippingAddressCommand command) {
        if (actor == null || actor.tenantId() == null || orderId == null) {
            throw new IllegalArgumentException("Actor, tenant, and order are required");
        }
        NormalizedCommand normalized = normalize(command);
        OrderAggregate initial = orders.getOrder(actor, orderId);
        UUID shopId = initial.order().getShopId();
        String fingerprint = fingerprint(orderId, normalized);
        var reservation = commands.reserve(
                actor.tenantId(), orderId, shopId,
                ShopifyOrderCommandRepository.ORDER_SHIPPING_ADDRESS_UPDATE,
                normalized.idempotencyKey(), fingerprint);
        if (reservation.replay()) {
            return new ShippingAddressUpdateResult(
                    orders.getOrder(actor, orderId), null, true);
        }
        try {
            if (!reservation.existing()) {
                requireExpectedVersions(initial, normalized);
            }
            requireMutableState(initial.order().getStatus());
            requireShopifyWriteAccess(actor.tenantId(), shopId);
            String externalOrderRef = required(
                    initial.order().getExternalOrderRef(),
                    "External Shopify order reference is required");
            if (!externalOrderRef.startsWith("gid://shopify/Order/")) {
                throw new ConflictException(
                        "Order is not linked to a Shopify order GID");
            }
            var providerResult = connector.updateShopifyOrderShippingAddress(
                    actor.tenantId(), shopId,
                    new OrderShippingAddressUpdateRequest(
                            externalOrderRef,
                            normalized.idempotencyKey(),
                            normalized.address()));
            MailingAddress providerAddress = validateProviderAddress(
                    providerResult.address());
            OrderAggregate basis = reservation.existing()
                    ? orders.getOrder(actor, orderId)
                    : initial;
            requireMutableState(basis.order().getStatus());
            long expectedVersion = reservation.existing()
                    ? basis.order().getVersion()
                    : normalized.version();
            long expectedProfileVersion = reservation.existing()
                    ? basis.profile().version()
                    : normalized.profileVersion();
            OrderProfile profile = basis.profile().withRecipientAddress(
                    recipientName(providerAddress),
                    nullable(providerAddress.phone()),
                    nullable(providerAddress.company()),
                    providerAddress.address1().strip(),
                    nullable(providerAddress.address2()),
                    providerAddress.city().strip());
            var operational = basis.order().operationalMetadata()
                    .withShippingLocation(
                            providerAddress.countryCode().toUpperCase(Locale.ROOT),
                            firstNonNull(providerAddress.province(),
                                    providerAddress.provinceCode()),
                            nullable(providerAddress.zip()));
            OrderAggregate updated = orders.applyShopifyShippingAddressUpdate(
                    actor, orderId, expectedVersion, expectedProfileVersion,
                    operational, profile, normalized.idempotencyKey());
            commands.markSucceeded(
                    actor.tenantId(), normalized.idempotencyKey(), fingerprint,
                    updated.order().getVersion());
            return new ShippingAddressUpdateResult(
                    updated, providerResult.updatedAt(), false);
        } catch (RuntimeException exception) {
            try {
                commands.markFailed(
                        actor.tenantId(), normalized.idempotencyKey(),
                        fingerprint, safeErrorCode(exception));
            } catch (RuntimeException ignored) {
                exception.addSuppressed(ignored);
            }
            throw exception;
        }
    }

    private void requireShopifyWriteAccess(
            UUID tenantId,
            UUID shopId) {
        var snapshot = connector.snapshot(tenantId, shopId);
        if (snapshot.shopify().status() != ConnectionStatus.CONNECTED) {
            throw ShopifyAuthorizationConflictException.notConnected();
        }
        var scope = snapshot.shopifyScopes().stream()
                .filter(item -> "write_orders".equals(item.scope()))
                .findFirst()
                .orElseThrow(ShopifyAuthorizationConflictException::scopeUnavailable);
        if (scope.status()
                == ChannelConnectorGateway.ShopifyScopeCoverageStatus.MISSING) {
            throw ShopifyAuthorizationConflictException.missingScope("write_orders");
        }
    }

    private static void requireExpectedVersions(
            OrderAggregate aggregate,
            NormalizedCommand command) {
        if (aggregate.order().getVersion() != command.version()) {
            throw new ConflictException("Order version is stale");
        }
        if (aggregate.profile().version() != command.profileVersion()) {
            throw new ConflictException("Order profile version is stale");
        }
    }

    private static void requireMutableState(OrderStatus status) {
        if (status == OrderStatus.FULFILLING
                || status == OrderStatus.SHIPPED
                || status == OrderStatus.DELIVERED
                || status == OrderStatus.CANCELLED) {
            throw new ConflictException(
                    "Shopify shipping address cannot be changed after fulfillment starts");
        }
    }

    private static NormalizedCommand normalize(ShippingAddressCommand command) {
        if (command == null || command.version() < 0
                || command.profileVersion() < 0) {
            throw new IllegalArgumentException(
                    "Order and profile versions are required");
        }
        String key = required(command.idempotencyKey(),
                "Idempotency key is required");
        if (!IDEMPOTENCY_KEY.matcher(key).matches()) {
            throw new IllegalArgumentException("Idempotency key is invalid");
        }
        String address1 = boundedRequired(command.address1(), 300, "address1");
        String city = boundedRequired(command.city(), 120, "city");
        String countryCode = required(command.countryCode(),
                "Country code is required").toUpperCase(Locale.ROOT);
        if (!COUNTRY_CODE.matcher(countryCode).matches()) {
            throw new IllegalArgumentException("Country code is invalid");
        }
        MailingAddress address = new MailingAddress(
                null,
                boundedNullable(command.firstName(), 100, "firstName"),
                boundedNullable(command.lastName(), 100, "lastName"),
                boundedNullable(command.company(), 200, "company"),
                address1,
                boundedNullable(command.address2(), 300, "address2"),
                city,
                null,
                boundedNullable(command.provinceCode(), 32, "provinceCode"),
                null,
                countryCode,
                boundedNullable(command.zip(), 32, "zip"),
                boundedNullable(command.phone(), 40, "phone"),
                List.of());
        return new NormalizedCommand(
                command.version(), command.profileVersion(), key, address);
    }

    private static MailingAddress validateProviderAddress(MailingAddress address) {
        if (address == null) {
            throw new ConflictException(
                    "Shopify did not return the updated shipping address");
        }
        boundedRequired(address.address1(), 300, "address1");
        boundedRequired(address.city(), 120, "city");
        String countryCode = required(address.countryCode(),
                "Shopify country code is required").toUpperCase(Locale.ROOT);
        if (!COUNTRY_CODE.matcher(countryCode).matches()) {
            throw new ConflictException(
                    "Shopify returned an invalid shipping country code");
        }
        return address;
    }

    private static String recipientName(MailingAddress address) {
        String explicit = nullable(address.name());
        if (explicit != null) {
            return explicit;
        }
        return nullable(String.join(" ",
                nullable(address.firstName()) == null ? "" : address.firstName().strip(),
                nullable(address.lastName()) == null ? "" : address.lastName().strip()).strip());
    }

    private static String fingerprint(
            UUID orderId,
            NormalizedCommand command) {
        MailingAddress address = command.address();
        String canonical = String.join("\n",
                "ORDER_SHIPPING_ADDRESS_UPDATE",
                orderId.toString(),
                Long.toString(command.version()),
                Long.toString(command.profileVersion()),
                value(address.firstName()), value(address.lastName()),
                value(address.company()), value(address.address1()),
                value(address.address2()), value(address.city()),
                value(address.provinceCode()), value(address.countryCode()),
                value(address.zip()), value(address.phone()));
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256")
                            .digest(canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    private static String safeErrorCode(RuntimeException exception) {
        if (exception instanceof ShopifyAuthorizationConflictException) {
            return "SHOPIFY_AUTHORIZATION_CONFLICT";
        }
        if (exception instanceof ConflictException) {
            return "ORDER_STATE_CONFLICT";
        }
        if (exception instanceof IllegalArgumentException) {
            return "INVALID_REQUEST";
        }
        return "CONNECTOR_UNAVAILABLE";
    }

    private static String boundedRequired(
            String value,
            int limit,
            String field) {
        String normalized = required(value, field + " is required");
        if (normalized.length() > limit || containsControl(normalized)) {
            throw new IllegalArgumentException(field + " is invalid");
        }
        return normalized;
    }

    private static String boundedNullable(
            String value,
            int limit,
            String field) {
        String normalized = nullable(value);
        if (normalized != null
                && (normalized.length() > limit || containsControl(normalized))) {
            throw new IllegalArgumentException(field + " is invalid");
        }
        return normalized;
    }

    private static boolean containsControl(String value) {
        return value.codePoints().anyMatch(Character::isISOControl);
    }

    private static String required(String value, String message) {
        String normalized = nullable(value);
        if (normalized == null) {
            throw new IllegalArgumentException(message);
        }
        return normalized;
    }

    private static String nullable(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private static String firstNonNull(String first, String second) {
        String value = nullable(first);
        return value == null ? nullable(second) : value;
    }

    private static String value(String value) {
        return Objects.toString(value, "");
    }

    public record ShippingAddressCommand(
            long version,
            long profileVersion,
            String idempotencyKey,
            String firstName,
            String lastName,
            String company,
            String address1,
            String address2,
            String city,
            String provinceCode,
            String countryCode,
            String zip,
            String phone) {
    }

    public record ShippingAddressUpdateResult(
            OrderAggregate order,
            Instant synchronizedAt,
            boolean replayed) {
    }

    private record NormalizedCommand(
            long version,
            long profileVersion,
            String idempotencyKey,
            MailingAddress address) {
    }
}
