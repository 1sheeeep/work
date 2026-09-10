package cn.xzkj.erp.fulfillment.service;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;

import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PackageStatus;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Plan;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.ShopifyPublicationStatus;
import cn.xzkj.erp.fulfillment.repository.ShopifyFulfillmentPublicationRepository;
import cn.xzkj.erp.fulfillment.repository.ShopifyFulfillmentPublicationRepository.PublicationInput;
import cn.xzkj.erp.fulfillment.service.FulfillmentExceptions.Conflict;
import cn.xzkj.erp.fulfillment.service.FulfillmentExceptions.Invalid;
import cn.xzkj.erp.fulfillment.service.FulfillmentExceptions.NotFound;
import cn.xzkj.erp.fulfillment.service.FulfillmentService.Actor;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.FulfillmentPublishLine;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.FulfillmentPublishRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyScopeCoverageStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.TrackingInfo;
import cn.xzkj.erp.platform.connector.ConnectorUnavailableException;

@Service
public class ShopifyFulfillmentPublicationService {

    private static final Pattern KEY =
            Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$");
    private static final Pattern SHOPIFY_ORDER =
            Pattern.compile("^gid://shopify/Order/[0-9]+$");
    private static final Pattern SHOPIFY_LINE =
            Pattern.compile("^gid://shopify/LineItem/[0-9]+$");
    private static final Pattern SHOPIFY_FULFILLMENT =
            Pattern.compile("^gid://shopify/Fulfillment/[0-9]+$");
    private static final String MERCHANT_FULFILLMENT_READ_SCOPE =
            "read_merchant_managed_fulfillment_orders";
    private static final String MERCHANT_FULFILLMENT_WRITE_SCOPE =
            "write_merchant_managed_fulfillment_orders";

    private final FulfillmentService fulfillments;
    private final ShopifyFulfillmentPublicationRepository publications;
    private final ChannelConnectorGateway connector;
    private final ShopifyFulfillmentPublicationFinalizer finalizer;

    public ShopifyFulfillmentPublicationService(
            FulfillmentService fulfillments,
            ShopifyFulfillmentPublicationRepository publications,
            ChannelConnectorGateway connector,
            ShopifyFulfillmentPublicationFinalizer finalizer) {
        this.fulfillments = fulfillments;
        this.publications = publications;
        this.connector = connector;
        this.finalizer = finalizer;
    }

    public PublicationResult publish(
            Actor actor,
            UUID planId,
            UUID packageId,
            PublishCommand command) {
        if (actor == null || actor.tenantId() == null
                || planId == null || packageId == null) {
            throw new Invalid("actor_or_resource");
        }
        NormalizedCommand normalized = normalize(command);
        Plan visible = fulfillments.get(actor, planId);
        var visiblePackage = visible.packages().stream()
                .filter(item -> item.id().equals(packageId))
                .findFirst()
                .orElseThrow(NotFound::new);
        if (visiblePackage.status() != PackageStatus.HANDED_OVER
                || visiblePackage.shopifyPublicationStatus()
                        == ShopifyPublicationStatus.PUBLISHING
                || visiblePackage.shopifyPublicationStatus()
                        == ShopifyPublicationStatus.PUBLISHED) {
            throw new Conflict("shopify_publication_not_allowed");
        }
        PublicationInput input = publications.findInput(
                        actor.tenantId(), planId, packageId)
                .orElseThrow(() -> new Conflict(
                        "shopify_publication_not_ready"));
        validateInput(input);
        requireShopifyFulfillmentAccess(
                actor.tenantId(), input.shopId());
        String fingerprint = fingerprint(input, normalized);
        var reservation = reserve(
                actor.tenantId(), input, normalized, fingerprint);
        if (reservation.replay()) {
            return new PublicationResult(
                    fulfillments.get(actor, planId),
                    reservation.externalFulfillmentRef(),
                    Boolean.TRUE.equals(reservation.recoveredFromShopify()),
                    reservation.publishedAt(),
                    true);
        }
        ChannelConnectorGateway.FulfillmentPublishResult connectorResult;
        try {
            connectorResult = connector.publishShopifyFulfillment(
                    actor.tenantId(),
                    input.shopId(),
                    new FulfillmentPublishRequest(
                            input.externalOrderRef(),
                            normalized.idempotencyKey(),
                            normalized.notifyCustomer(),
                            new TrackingInfo(
                                    input.carrierCode(),
                                    input.trackingReference(),
                                    normalized.trackingUrl()),
                            input.lines().stream()
                                    .map(line -> new FulfillmentPublishLine(
                                            line.externalOrderLineRef(),
                                            line.quantity()))
                                    .toList()));
        } catch (ConnectorUnavailableException exception) {
            if (isDefinitiveConnectorRejection(exception)
                    && !reservation.existing()) {
                try {
                    publications.discardFailedReservation(
                            actor.tenantId(), reservation.publicationId(),
                            fingerprint);
                } catch (RuntimeException releaseFailure) {
                    exception.addSuppressed(releaseFailure);
                    publications.markUncertain(
                            actor.tenantId(), reservation.publicationId(),
                            fingerprint, "SHOPIFY_FULFILLMENT_UNCERTAIN");
                    throw new Conflict("shopify_fulfillment_uncertain");
                }
                throw new Conflict("FORBIDDEN".equals(exception.code())
                        ? "shopify_fulfillment_scope_missing"
                        : "shopify_fulfillment_rejected");
            }
            publications.markUncertain(
                    actor.tenantId(), reservation.publicationId(),
                    fingerprint, "SHOPIFY_FULFILLMENT_UNCERTAIN");
            throw new Conflict("shopify_fulfillment_uncertain");
        } catch (RuntimeException exception) {
            publications.markUncertain(
                    actor.tenantId(), reservation.publicationId(),
                    fingerprint, "SHOPIFY_FULFILLMENT_UNCERTAIN");
            if (exception instanceof Conflict
                    || exception instanceof Invalid
                    || exception instanceof NotFound) {
                throw exception;
            }
            throw new Conflict("shopify_fulfillment_uncertain");
        }
        if (connectorResult.externalFulfillmentRefs() == null
                || connectorResult.externalFulfillmentRefs().size() != 1
                || !SHOPIFY_FULFILLMENT.matcher(
                        connectorResult.externalFulfillmentRefs()
                                .getFirst()).matches()
                || connectorResult.tracking() == null
                || !input.trackingReference().equals(
                        connectorResult.tracking().number())) {
            publications.markUncertain(
                    actor.tenantId(), reservation.publicationId(),
                    fingerprint, "SHOPIFY_FULFILLMENT_UNCERTAIN");
            throw new Conflict("shopify_fulfillment_uncertain");
        }
        String externalRef = connectorResult
                .externalFulfillmentRefs().getFirst();
        try {
            finalizer.finalizePublished(
                    actor,
                    planId,
                    packageId,
                    reservation.publicationId(),
                    fingerprint,
                    externalRef,
                    normalized.notifyCustomer(),
                    connectorResult.recoveredFromShopify());
        } catch (RuntimeException exception) {
            throw new Conflict("shopify_fulfillment_uncertain");
        }
        return new PublicationResult(
                fulfillments.get(actor, planId),
                externalRef,
                connectorResult.recoveredFromShopify(),
                connectorResult.updatedAt(),
                false);
    }

    private ShopifyFulfillmentPublicationRepository.Reservation reserve(
            UUID tenantId,
            PublicationInput input,
            NormalizedCommand command,
            String fingerprint) {
        try {
            return publications.reserve(
                    tenantId, input.planId(), input.packageId(),
                    command.idempotencyKey(), fingerprint,
                    command.notifyCustomer(), command.trackingUrl());
        } catch (IllegalStateException exception) {
            throw new Conflict(exception.getMessage());
        }
    }

    private void requireShopifyFulfillmentAccess(
            UUID tenantId,
            UUID shopId) {
        var snapshot = connector.snapshot(tenantId, shopId);
        if (snapshot.shopify().status() != ConnectionStatus.CONNECTED) {
            throw new Conflict("shopify_connection_not_connected");
        }
        if (!granted(snapshot, MERCHANT_FULFILLMENT_READ_SCOPE)
                || !granted(snapshot, MERCHANT_FULFILLMENT_WRITE_SCOPE)) {
            throw new Conflict("shopify_fulfillment_scope_missing");
        }
    }

    private static boolean granted(
            ChannelConnectorGateway.ChannelSnapshot snapshot,
            String requiredScope) {
        return ChannelConnectorGateway.shopifyScopeCoverage(
                snapshot.shopifyScopes(), requiredScope)
                == ShopifyScopeCoverageStatus.GRANTED;
    }

    private static boolean isDefinitiveConnectorRejection(
            ConnectorUnavailableException exception) {
        return !exception.retryable()
                && ("INVALID_REQUEST".equals(exception.code())
                        || "FORBIDDEN".equals(exception.code()));
    }

    private static NormalizedCommand normalize(PublishCommand command) {
        if (command == null || command.idempotencyKey() == null) {
            throw new Invalid("command");
        }
        String key = command.idempotencyKey().strip();
        if (!KEY.matcher(key).matches()) {
            throw new Invalid("idempotencyKey");
        }
        String url = command.trackingUrl() == null
                || command.trackingUrl().isBlank()
                        ? null : command.trackingUrl().strip();
        if (url != null) {
            if (url.length() > 2048
                    || url.chars().anyMatch(Character::isISOControl)) {
                throw new Invalid("trackingUrl");
            }
            URI parsed;
            try {
                parsed = URI.create(url);
            } catch (IllegalArgumentException exception) {
                throw new Invalid("trackingUrl");
            }
            if (parsed.getHost() == null || parsed.getUserInfo() != null
                    || !("http".equalsIgnoreCase(parsed.getScheme())
                    || "https".equalsIgnoreCase(parsed.getScheme()))) {
                throw new Invalid("trackingUrl");
            }
        }
        return new NormalizedCommand(
                key, command.notifyCustomer(), url);
    }

    private static void validateInput(PublicationInput input) {
        if (!SHOPIFY_ORDER.matcher(input.externalOrderRef()).matches()
                || input.trackingReference() == null
                || input.trackingReference().isBlank()
                || input.trackingReference().length() > 160
                || input.carrierCode() == null
                || input.carrierCode().isBlank()
                || input.lines().isEmpty()
                || input.lines().size() > 200
                || input.lines().stream().anyMatch(line ->
                        line.quantity() < 1
                                || line.externalOrderLineRef() == null
                                || !SHOPIFY_LINE.matcher(
                                        line.externalOrderLineRef()).matches())) {
            throw new Conflict("shopify_publication_not_ready");
        }
    }

    private static String fingerprint(
            PublicationInput input,
            NormalizedCommand command) {
        String canonical = String.join("\n",
                "SHOPIFY_FULFILLMENT_PUBLISH",
                input.planId().toString(),
                input.packageId().toString(),
                input.externalOrderRef(),
                input.packageNumber(),
                input.carrierCode(),
                input.serviceCode() == null ? "" : input.serviceCode(),
                input.trackingReference(),
                input.occurredAt().toString(),
                Boolean.toString(command.notifyCustomer()),
                command.trackingUrl() == null ? "" : command.trackingUrl(),
                input.lines().toString());
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256")
                            .digest(canonical.getBytes(
                                    StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(
                    "SHA-256 is unavailable", impossible);
        }
    }

    public record PublishCommand(
            String idempotencyKey,
            boolean notifyCustomer,
            String trackingUrl) {
    }

    private record NormalizedCommand(
            String idempotencyKey,
            boolean notifyCustomer,
            String trackingUrl) {
    }

    public record PublicationResult(
            Plan plan,
            String externalFulfillmentRef,
            boolean recoveredFromShopify,
            Instant publishedAt,
            boolean replayed) {
    }
}
