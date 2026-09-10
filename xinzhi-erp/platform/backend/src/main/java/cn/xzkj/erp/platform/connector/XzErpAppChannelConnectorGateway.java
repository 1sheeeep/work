package cn.xzkj.erp.platform.connector;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.ObjectMapper;

@Component
@ConditionalOnProperty(name = "erp.channel-connector.mode", havingValue = "xz-erp-app")
public class XzErpAppChannelConnectorGateway implements ChannelConnectorGateway {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final ObjectMapper STRICT_CONTRACT_JSON = new ObjectMapper()
            .rebuild()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .build();
    private static final int MAX_BODY_BYTES = 2 * 1024 * 1024;
    private static final String CONNECTION_CONTRACT_VERSION =
            "shopify.connector.connection.v3";
    private static final String INSTALLATION_CONTRACT_VERSION =
            "shopify.connector.installation.v1";
    private static final Pattern OAUTH_GRANT_QUERY =
            Pattern.compile("grant=[A-Za-z0-9_-]{43}");
    private static final String FULFILLMENT_PUBLISH_CONTRACT_VERSION =
            "shopify.connector.fulfillment_publish.v1";
    private static final String ORDER_SHIPPING_ADDRESS_CONTRACT_VERSION =
            "shopify.connector.order_shipping_address.v1";

    private final URI baseUrl;
    private final String connectorToken;
    private final HttpClient client;
    private final Duration timeout;
    private final StoreAppReadBinding readBinding;

    record StoreAppReadBinding(UUID tenantId, UUID shopId, long version) {
        StoreAppReadBinding {
            if (tenantId == null || shopId == null || version < 1 || version > 9_007_199_254_740_991L) {
                throw new IllegalArgumentException("Store app read binding is invalid");
            }
        }
    }

    // Package-private preparation adapter, not a Spring/active-route replacement.
    // Reuses strict existing DTO validation; its transport can only send two reads.
    static XzErpAppChannelConnectorGateway storeAppReadPreparation(
            String baseUrl, String serviceToken, StoreAppReadBinding binding) {
        return new XzErpAppChannelConnectorGateway(baseUrl, serviceToken,
                Duration.ofSeconds(10), false, connectorHttpClient(),
                Objects.requireNonNull(binding));
    }

    @Autowired
    public XzErpAppChannelConnectorGateway(Environment environment) {
        this(
                required(environment.getProperty(
                        "erp.channel-connector.xz-erp-app.base-url"),
                        "XZ ERP App connector base URL is required"),
                required(environment.getProperty(
                        "erp.channel-connector.xz-erp-app.token"),
                        "XZ ERP App connector token is required"),
                Duration.parse(environment.getProperty(
                        "erp.channel-connector.xz-erp-app.timeout",
                        "PT10S")),
                Boolean.parseBoolean(environment.getProperty(
                        "erp.channel-connector.xz-erp-app.allow-private-http",
                        "false")),
                connectorHttpClient());
    }

    static HttpClient connectorHttpClient() {
        return HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    XzErpAppChannelConnectorGateway(
            String rawBaseUrl,
            String connectorToken,
            Duration timeout,
            HttpClient client) {
        this(rawBaseUrl, connectorToken, timeout, false, client);
    }

    XzErpAppChannelConnectorGateway(
            String rawBaseUrl,
            String connectorToken,
            Duration timeout,
            boolean allowPrivateHttp,
            HttpClient client) {
        this(rawBaseUrl, connectorToken, timeout, allowPrivateHttp, client, null);
    }

    private XzErpAppChannelConnectorGateway(
            String rawBaseUrl, String connectorToken, Duration timeout,
            boolean allowPrivateHttp, HttpClient client, StoreAppReadBinding readBinding) {
        this.baseUrl = validateBaseUrl(rawBaseUrl, allowPrivateHttp);
        this.connectorToken = required(connectorToken,
                "XZ ERP App connector token is required");
        this.timeout = timeout == null ? Duration.ofSeconds(10) : timeout;
        if (this.timeout.isNegative() || this.timeout.isZero()
                || this.timeout.compareTo(Duration.ofSeconds(60)) > 0) {
            throw new IllegalArgumentException(
                    "XZ ERP App connector timeout must be 1-60 seconds");
        }
        this.client = Objects.requireNonNull(client);
        this.readBinding = readBinding;
    }

    @Override
    public ChannelSnapshot snapshot(UUID tenantId, UUID shopId) {
        requireReadBinding(tenantId, shopId);
        ConnectorRequest base = connectorRequest(
                tenantId, shopId, 50, null, null);
        ConnectorConnectionResponse response = post(
                "/api/v1/erp-connector/shopify/connection",
                new ConnectorConnectionRequest(base.identity(), base.context()),
                ConnectorConnectionResponse.class,
                STRICT_CONTRACT_JSON);
        validateConnectionResponse(response, tenantId, shopId);
        return new ChannelSnapshot(
                readBinding == null ? ConnectorMode.XZ_ERP_APP
                        : ConnectorMode.CUSTOMER_SERVICE_STORE_APP_READ_ONLY,
                new Connection(
                        switch (response.state()) {
                            case "CONNECTED" -> ConnectionStatus.CONNECTED;
                            case "DISCONNECTED" -> ConnectionStatus.REVOKED;
                            case "NOT_CONFIGURED" -> ConnectionStatus.NOT_CONNECTED;
                            default -> throw new ConnectorUnavailableException();
                        },
                        null,
                        null,
                        response.checkedAt(),
                        response.shopName(),
                        response.shopDomain()),
                ChannelConnectorGateway.plannedShopifyScopes(
                        response.grantedScopes(),
                        "CONNECTED".equals(response.state())),
                List.of());
    }

    @Override
    public ChannelSnapshot authorizeShopify(UUID tenantId, UUID shopId) {
        throw new ConnectorUnavailableException();
    }

    @Override
    public NativeShopifyLinkPreview previewNativeShopifyLink(String proof) {
        validateNativeLinkProof(proof);
        var response = post(
                "/api/v1/shopify-connector/installations/native-link/preview",
                new NativeLinkProofRequest(proof), NativeLinkPreviewResponse.class, STRICT_CONTRACT_JSON);
        if (response == null || !"shopify.connector.native_link.v1".equals(response.contractVersion())
                || response.pending() == null) throw new ConnectorUnavailableException();
        var pending = response.pending();
        validateNativeShop(pending.shopDomain(), pending.shopName(), pending.grantedScopes());
        if (pending.expiresAt() == null || !pending.expiresAt().isAfter(Instant.now())
                || pending.expiresAt().isAfter(Instant.now().plusSeconds(905))) {
            throw new ConnectorUnavailableException();
        }
        return pending;
    }

    @Override
    public ChannelSnapshot confirmNativeShopifyLink(
            UUID tenantId, UUID shopId, UUID actorId, String shopDomain, String proof) {
        validateNativeLinkProof(proof);
        if (actorId == null) throw new IllegalArgumentException("Native user required");
        var base = connectorRequest(tenantId, shopId, 1, null, null);
        var response = post(
                "/api/v1/shopify-connector/installations/native-link/confirm",
                new NativeLinkConfirmRequest(base.identity(), base.context(), shopId.toString(),
                        shopDomain, actorId.toString(), proof),
                NativeLinkConfirmResponse.class, STRICT_CONTRACT_JSON);
        if (response == null || !"shopify.connector.native_link.v1".equals(response.contractVersion())
                || response.installation() == null) throw new ConnectorUnavailableException();
        var installation = response.installation();
        if (!INSTALLATION_CONTRACT_VERSION.equals(installation.contractVersion())
                || !tenantId.toString().equals(installation.tenantId())
                || !shopId.toString().equals(installation.shopId())
                || !Objects.equals(shopDomain, installation.shopDomain())
                || !"INSTALLED".equals(installation.state())
                || installation.installedAt() == null || installation.updatedAt() == null
                || installation.updatedAt().isBefore(installation.installedAt())
                || installation.updatedAt().isAfter(Instant.now().plusSeconds(5))) {
            throw new ConnectorUnavailableException();
        }
        validateNativeShop(installation.shopDomain(), installation.shopName(), installation.grantedScopes());
        return new ChannelSnapshot(ConnectorMode.XZ_ERP_APP,
                new Connection(ConnectionStatus.CONNECTED, null, null, installation.updatedAt(),
                        installation.shopName(), installation.shopDomain()),
                ChannelConnectorGateway.plannedShopifyScopes(installation.grantedScopes(), true), List.of());
    }

    private static void validateNativeLinkProof(String proof) {
        try {
            byte[] bytes = java.util.Base64.getUrlDecoder().decode(proof);
            if (bytes.length == 32 && java.util.Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(bytes).equals(proof)) return;
        } catch (RuntimeException ignored) { }
        throw new IllegalArgumentException("Invalid Shopify linking proof");
    }

    private static void validateNativeShop(String domain, String name, List<String> scopes) {
        if (domain == null || !domain.matches("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.myshopify\\.com$")
                || name == null || name.isBlank() || name.length() > 160
                || name.chars().anyMatch(Character::isISOControl)
                || scopes == null || scopes.isEmpty() || scopes.size() > 100
                || scopes.stream().anyMatch(scope -> scope == null || !scope.matches("[a-z][a-z0-9_]{0,99}"))
                || new HashSet<>(scopes).size() != scopes.size()
                || ChannelConnectorGateway.plannedShopifyScopes(scopes, true).stream()
                        .anyMatch(scope -> scope.status() != ShopifyScopeCoverageStatus.GRANTED)) {
            throw new ConnectorUnavailableException();
        }
    }

    @Override
    public ShopifyAuthorizationStart startShopifyAuthorization(
            UUID tenantId,
            UUID shopId,
            String shopDomain) {
        ConnectorRequest base = connectorRequest(
                tenantId, shopId, 50, null, null);
        ConnectorOAuthStartResponse response = post(
                "/api/v1/shopify-connector/installations/oauth/start",
                new ConnectorOAuthStartRequest(
                        base.identity(),
                        base.context(),
                        shopId.toString(),
                        required(shopDomain,
                                "Shopify shop domain is required")),
                ConnectorOAuthStartResponse.class,
                STRICT_CONTRACT_JSON);
        String authorizationUrl = validateAuthorizationStartResponse(response);
        return new ShopifyAuthorizationStart(
                new ChannelSnapshot(
                        ConnectorMode.XZ_ERP_APP,
                        new Connection(
                                ConnectionStatus.PENDING,
                                null,
                                null,
                                Instant.now()),
                        ChannelConnectorGateway.plannedShopifyScopes(List.of()),
                        List.of()),
                authorizationUrl);
    }

    @Override
    public ChannelSnapshot retryShopify(UUID tenantId, UUID shopId) {
        if (readBinding != null) throw new ConnectorUnavailableException();
        return snapshot(tenantId, shopId);
    }

    @Override
    public ChannelSnapshot uninstallShopify(UUID tenantId, UUID shopId) {
        ConnectorRequest base = connectorRequest(
                tenantId, shopId, 1, null, null);
        ConnectorUninstallResponse response = post(
                "/api/v1/shopify-connector/installations/uninstall",
                new ConnectorConnectionRequest(base.identity(), base.context()),
                ConnectorUninstallResponse.class,
                STRICT_CONTRACT_JSON,
                base.context().correlationId());
        validateUninstallResponse(response, tenantId, shopId);
        return snapshot(tenantId, shopId);
    }

    @Override
    public ProductCatalogPage fetchShopifyProductCatalog(
            UUID tenantId,
            UUID shopId,
            ProductCatalogRequest request) {
        ConnectorProductCatalogResponse response = post(
                "/api/v1/erp-connector/shopify/product-catalog",
                connectorRequest(tenantId, shopId, request),
                ConnectorProductCatalogResponse.class,
                STRICT_CONTRACT_JSON);
        validateProductCatalogResponse(
                response,
                tenantId,
                shopId,
                request == null ? 50 : request.limit());
        ConnectionStatus status = switch (response.state()) {
            case "CONNECTED" -> ConnectionStatus.CONNECTED;
            default -> ConnectionStatus.NOT_CONNECTED;
        };
        return new ProductCatalogPage(
                ConnectorMode.XZ_ERP_APP,
                status,
                response.pageInfo() == null ? null : response.pageInfo().endCursor(),
                response.pageInfo() != null && response.pageInfo().hasNextPage(),
                response.fetchedAt(),
                response.products().stream()
                        .map(product -> new ProductCatalogProduct(
                                product.id(),
                                product.title(),
                                product.handle(),
                                product.status(),
                                parseInstant(product.updatedAt()),
                                product.variants().stream()
                                        .map(variant -> new ProductCatalogVariant(
                                                variant.id(),
                                                variant.inventoryItemId(),
                                                variant.sku(),
                                                variant.title(),
                                                variant.price(),
                                                variant.currencyCode(),
                                                variant.availableForSale(),
                                                variant.inventoryTracked()))
                                        .toList()))
                        .toList());
    }

    @Override
    public LocationCatalogPage fetchShopifyLocationCatalog(
            UUID tenantId,
            UUID shopId,
            LocationCatalogRequest request) {
        ConnectorLocationCatalogResponse response = post(
                "/api/v1/erp-connector/shopify/location-catalog",
                connectorRequest(
                        tenantId,
                        shopId,
                        request == null ? 50 : request.limit(),
                        request == null ? null : request.cursor(),
                        null),
                ConnectorLocationCatalogResponse.class,
                STRICT_CONTRACT_JSON);
        validateLocationCatalogResponse(response, tenantId, shopId,
                request == null ? 50 : request.limit());
        ConnectionStatus status = switch (response.state()) {
            case "CONNECTED" -> ConnectionStatus.CONNECTED;
            default -> ConnectionStatus.NOT_CONNECTED;
        };
        return new LocationCatalogPage(
                ConnectorMode.XZ_ERP_APP,
                status,
                response.pageInfo() == null ? null : response.pageInfo().endCursor(),
                response.pageInfo() != null && response.pageInfo().hasNextPage(),
                response.fetchedAt(),
                response.locations().stream()
                        .map(location -> new LocationCatalogLocation(
                                location.id(),
                                location.name(),
                                location.isActive(),
                                location.fulfillsOnlineOrders(),
                                location.hasActiveInventory(),
                                location.isFulfillmentService(),
                                location.address1(),
                                location.address2(),
                                location.city(),
                                location.province(),
                                location.provinceCode(),
                                location.country(),
                                location.countryCode(),
                                location.zip()))
                        .toList());
    }

    @Override
    public InventoryLevelSnapshot fetchShopifyInventoryLevel(
            UUID tenantId,
            UUID shopId,
            InventoryLevelRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Inventory level request is required");
        }
        ConnectorRequest base = connectorRequest(
                tenantId, shopId, 1, null, null);
        ConnectorInventoryLevelResponse response = post(
                "/api/v1/erp-connector/shopify/inventory-level",
                new ConnectorInventoryLevelRequest(
                        base.identity(), base.context(),
                        required(request.externalInventoryItemRef(),
                                "Shopify inventory item reference is required"),
                        required(request.externalLocationRef(),
                                "Shopify location reference is required")),
                ConnectorInventoryLevelResponse.class,
                STRICT_CONTRACT_JSON);
        validateInventoryLevelResponse(response, tenantId, shopId,
                request.externalInventoryItemRef(), request.externalLocationRef());
        return new InventoryLevelSnapshot(
                ConnectorMode.XZ_ERP_APP,
                "CONNECTED".equals(response.state())
                        ? ConnectionStatus.CONNECTED
                        : ConnectionStatus.NOT_CONNECTED,
                response.inventoryItemId(), response.locationId(),
                response.tracked(), response.active(),
                response.availableQuantity(), response.onHandQuantity(),
                response.fetchedAt());
    }

    @Override
    public InventorySetResult setShopifyInventoryAvailable(
            UUID tenantId,
            UUID shopId,
            InventorySetRequest request) {
        if (request == null || request.publicationId() == null) {
            throw new IllegalArgumentException(
                    "Inventory publication request is required");
        }
        ConnectorRequest base = connectorRequest(
                tenantId, shopId, 1, null, null);
        ConnectorInventorySetResponse response = post(
                "/api/v1/erp-connector/shopify/inventory-set",
                new ConnectorInventorySetRequest(
                        base.identity(), base.context(),
                        required(request.externalInventoryItemRef(),
                                "Shopify inventory item reference is required"),
                        required(request.externalLocationRef(),
                                "Shopify location reference is required"),
                        request.expectedAvailable(),
                        request.targetAvailable(),
                        required(request.idempotencyKey(),
                                "Inventory publication idempotency key is required"),
                        "xz-erp://inventory-publications/"
                                + request.publicationId()),
                ConnectorInventorySetResponse.class,
                STRICT_CONTRACT_JSON,
                base.context().correlationId());
        validateInventorySetResponse(response, tenantId, shopId,
                request.externalInventoryItemRef(), request.externalLocationRef(),
                request.expectedAvailable(), request.targetAvailable());
        return new InventorySetResult(
                InventorySetOutcome.valueOf(response.outcome()),
                response.inventoryItemId(), response.locationId(),
                response.expectedAvailable(), response.targetAvailable(),
                response.safeErrorCode(), response.updatedAt());
    }

    @Override
    public OrderCatalogPage fetchShopifyOrderCatalog(
            UUID tenantId,
            UUID shopId,
            OrderCatalogRequest request) {
        requireReadBinding(tenantId, shopId);
        if (readBinding != null && (request == null || request.limit() < 1 || request.limit() > 25)) {
            throw new ConnectorUnavailableException();
        }
        ConnectorRequest connectorRequest = connectorRequest(
                tenantId, shopId, request);
        ConnectorOrderCatalogResponse response;
        try {
            response = post(
                    "/api/v1/erp-connector/shopify/order-catalog",
                    connectorRequest,
                    ConnectorOrderCatalogResponse.class,
                    STRICT_CONTRACT_JSON,
                    connectorRequest.context().correlationId());
        } catch (ConnectorUnavailableException exception) {
            if ("PROTECTED_CUSTOMER_DATA_REQUIRED".equals(exception.code())) {
                throw ShopifyAuthorizationConflictException
                        .protectedCustomerDataRequired();
            }
            throw exception;
        }
        validateOrderCatalogResponse(
                response,
                tenantId,
                shopId,
                request == null ? 50 : request.limit());
        ConnectionStatus status = switch (response.state()) {
            case "CONNECTED" -> ConnectionStatus.CONNECTED;
            default -> ConnectionStatus.NOT_CONNECTED;
        };
        return new OrderCatalogPage(
                readBinding == null ? ConnectorMode.XZ_ERP_APP
                        : ConnectorMode.CUSTOMER_SERVICE_STORE_APP_READ_ONLY,
                status,
                response.pageInfo() == null ? null : response.pageInfo().endCursor(),
                response.pageInfo() != null && response.pageInfo().hasNextPage(),
                response.fetchedAt(),
                response.orders().stream()
                        .map(order -> new OrderCatalogOrder(
                                order.id(),
                                order.legacyResourceId(),
                                order.name(),
                                order.email(),
                                order.sourceName(),
                                parseInstant(order.createdAt()),
                                parseInstant(order.updatedAt()),
                                parseInstant(order.cancelledAt()),
                                order.displayFinancialStatus(),
                                order.displayFulfillmentStatus(),
                                order.paymentGatewayNames(),
                                money(order.total()),
                                money(order.subtotal()),
                                money(order.shipping()),
                                address(order.shippingAddress()),
                                customer(order.customer()),
                                order.lineItems().stream()
                                        .map(line -> new OrderCatalogLine(
                                                line.id(),
                                                line.productId(),
                                                line.variantId(),
                                                line.inventoryItemId(),
                                                line.name(),
                                                line.title(),
                                                line.quantity(),
                                                line.sku(),
                                                line.variantTitle(),
                                                line.requiresShipping(),
                                                money(line.discountedTotal()),
                                                money(line.originalUnitPrice())))
                                        .toList(),
                                order.fulfillments().stream()
                                        .map(fulfillment -> new Fulfillment(
                                                fulfillment.id(),
                                                fulfillment.status(),
                                                parseInstant(fulfillment.createdAt()),
                                                parseInstant(fulfillment.updatedAt()),
                                                fulfillment.trackingInfo().stream()
                                                        .map(tracking -> new TrackingInfo(
                                                                tracking.company(),
                                                                tracking.number(),
                                                                tracking.url()))
                                                        .toList()))
                                        .toList()))
                        .toList());
    }

    @Override
    public CustomerCatalogPage fetchShopifyCustomerCatalog(
            UUID tenantId,
            UUID shopId,
            CustomerCatalogRequest request) {
        ConnectorRequest connectorRequest = connectorRequest(
                tenantId, shopId, request);
        ConnectorCustomerCatalogResponse response;
        try {
            response = post(
                    "/api/v1/erp-connector/shopify/customer-catalog",
                    connectorRequest,
                    ConnectorCustomerCatalogResponse.class,
                    STRICT_CONTRACT_JSON,
                    connectorRequest.context().correlationId());
        } catch (ConnectorUnavailableException exception) {
            if ("PROTECTED_CUSTOMER_DATA_REQUIRED".equals(exception.code())) {
                throw ShopifyAuthorizationConflictException
                        .protectedCustomerDataRequired();
            }
            throw exception;
        }
        int requestedLimit = request == null ? 50 : request.limit();
        validateCustomerCatalogResponse(
                response, tenantId, shopId, requestedLimit);
        ConnectionStatus status = "CONNECTED".equals(response.state())
                ? ConnectionStatus.CONNECTED : ConnectionStatus.NOT_CONNECTED;
        return new CustomerCatalogPage(
                ConnectorMode.XZ_ERP_APP,
                status,
                response.pageInfo() == null ? null : response.pageInfo().endCursor(),
                response.pageInfo() != null && response.pageInfo().hasNextPage(),
                response.fetchedAt(),
                response.customers().stream().map(value -> new CustomerProfile(
                        value.id(), value.legacyResourceId(), value.displayName(),
                        value.email(), value.phone(), parseInstant(value.createdAt()),
                        parseInstant(value.updatedAt()), value.verifiedEmail(), value.tags(),
                        value.numberOfOrders(), money(value.totalSpent()),
                        value.defaultLocation() == null ? null : new CustomerLocation(
                                value.defaultLocation().city(), value.defaultLocation().province(),
                                value.defaultLocation().country(), value.defaultLocation().countryCode()),
                        value.lastOrder() == null ? null : new CustomerOrderSummary(
                                value.lastOrder().id(), value.lastOrder().name(),
                                parseInstant(value.lastOrder().createdAt()),
                                value.lastOrder().displayFinancialStatus(),
                                value.lastOrder().displayFulfillmentStatus(),
                                money(value.lastOrder().total())))).toList());
    }

    @Override
    public ReturnCatalogPage fetchShopifyReturnCatalog(
            UUID tenantId,
            UUID shopId,
            ReturnCatalogRequest request) {
        int requestedLimit = request == null ? 50 : request.limit();
        ConnectorReturnCatalogResponse response = post(
                "/api/v1/erp-connector/shopify/return-catalog",
                connectorRequest(
                        tenantId, shopId, requestedLimit,
                        request == null ? null : request.cursor(),
                        request == null ? null : request.query()),
                ConnectorReturnCatalogResponse.class,
                STRICT_CONTRACT_JSON);
        validateReturnCatalogResponse(
                response, tenantId, shopId, requestedLimit);
        ConnectionStatus status = "CONNECTED".equals(response.state())
                ? ConnectionStatus.CONNECTED
                : ConnectionStatus.NOT_CONNECTED;
        return new ReturnCatalogPage(
                ConnectorMode.XZ_ERP_APP,
                status,
                response.pageInfo() == null
                        ? null : response.pageInfo().endCursor(),
                response.pageInfo() != null
                        && response.pageInfo().hasNextPage(),
                response.fetchedAt(),
                response.returns().stream()
                        .map(item -> new ShopifyReturn(
                                item.id(), item.name(),
                                item.orderId(), item.orderName(),
                                item.status(), parseInstant(item.createdAt()),
                                parseInstant(item.closedAt()),
                                parseInstant(item.requestApprovedAt()),
                                item.totalQuantity(),
                                item.lineItems().stream()
                                        .map(line -> new ShopifyReturnLine(
                                                line.id(),
                                                line.fulfillmentLineId(),
                                                line.orderLineId(),
                                                line.name(), line.sku(),
                                                line.quantity(),
                                                line.processableQuantity(),
                                                line.processedQuantity(),
                                                line.refundableQuantity(),
                                                line.refundedQuantity(),
                                                line.reasonHandle(),
                                                line.reasonName()))
                                        .toList()))
                        .toList());
    }

    @Override
    public ReturnDecisionResult decideShopifyReturn(
            UUID tenantId,
            UUID shopId,
            ReturnDecisionRequest request) {
        if (tenantId == null || shopId == null || request == null
                || request.decision() == null) {
            throw new IllegalArgumentException(
                    "Tenant, shop, and return decision are required");
        }
        ConnectorContext context = connectorContext(shopId);
        ConnectorReturnDecisionResponse response = post(
                "/api/v1/erp-connector/shopify/return-decision",
                new ConnectorReturnDecisionRequest(
                        new ConnectorIdentity(tenantId.toString(), shopId.toString()),
                        context,
                        required(request.externalReturnRef(), "Return reference is required"),
                        request.decision().name(),
                        request.declineReason() == null ? null : request.declineReason().name(),
                        request.declineNote(), request.notifyCustomer(),
                        required(request.idempotencyKey(), "Idempotency key is required")),
                ConnectorReturnDecisionResponse.class,
                STRICT_CONTRACT_JSON,
                context.correlationId());
        if (response == null
                || !"shopify.connector.return_decision.v1".equals(response.contractVersion())
                || !tenantId.toString().equals(response.tenantId())
                || !shopId.toString().equals(response.shopId())
                || !Objects.equals(request.externalReturnRef(), response.returnId())
                || response.status() == null || response.status().isBlank()
                || response.recoveredFromShopify() == null
                || response.updatedAt() == null) {
            throw new ConnectorUnavailableException();
        }
        return new ReturnDecisionResult(
                response.returnId(), response.status(),
                response.recoveredFromShopify(), response.updatedAt());
    }

    @Override
    public ReturnRefundPreview previewShopifyReturnRefund(
            UUID tenantId,
            UUID shopId,
            ReturnRefundPreviewRequest request) {
        if (tenantId == null || shopId == null || request == null) {
            throw new IllegalArgumentException(
                    "Tenant, shop, and refund preview are required");
        }
        ConnectorContext context = connectorContext(shopId);
        ConnectorReturnRefundPreviewResponse response = post(
                "/api/v1/erp-connector/shopify/return-refund-preview",
                new ConnectorReturnRefundPreviewRequest(
                        new ConnectorIdentity(tenantId.toString(), shopId.toString()),
                        context,
                        required(request.externalReturnRef(), "Return reference is required"),
                        request.lineItems().stream()
                                .map(item -> new ConnectorReturnRefundLineSelection(
                                        item.externalReturnLineRef(), item.quantity()))
                                .toList(),
                        request.refundShipping(),
                        request.refundDuties().stream()
                                .map(item -> new ConnectorReturnRefundDutySelection(
                                        item.externalDutyRef(), item.refundType().name()))
                                .toList()),
                ConnectorReturnRefundPreviewResponse.class,
                STRICT_CONTRACT_JSON,
                context.correlationId());
        validateReturnRefundPreview(response, tenantId, shopId, request);
        return returnRefundPreview(response);
    }

    @Override
    public ReturnRefundProcessResult processShopifyReturnRefund(
            UUID tenantId,
            UUID shopId,
            ReturnRefundProcessRequest request) {
        if (tenantId == null || shopId == null || request == null) {
            throw new IllegalArgumentException(
                    "Tenant, shop, and refund command are required");
        }
        ConnectorContext context = connectorContext(shopId);
        ConnectorReturnRefundProcessResponse response = post(
                "/api/v1/erp-connector/shopify/return-refund-process",
                new ConnectorReturnRefundProcessRequest(
                        new ConnectorIdentity(tenantId.toString(), shopId.toString()),
                        context,
                        required(request.externalReturnRef(), "Return reference is required"),
                        request.lineItems().stream()
                                .map(item -> new ConnectorReturnRefundLineSelection(
                                        item.externalReturnLineRef(), item.quantity()))
                                .toList(),
                        request.refundShipping(),
                        request.refundDuties().stream()
                                .map(item -> new ConnectorReturnRefundDutySelection(
                                        item.externalDutyRef(), item.refundType().name()))
                                .toList(),
                        required(request.previewToken(), "Preview token is required"),
                        request.notifyCustomer(),
                        required(request.idempotencyKey(), "Idempotency key is required")),
                ConnectorReturnRefundProcessResponse.class,
                STRICT_CONTRACT_JSON,
                context.correlationId());
        if (response == null
                || !"shopify.connector.return_refund_process.v1".equals(response.contractVersion())
                || !tenantId.toString().equals(response.tenantId())
                || !shopId.toString().equals(response.shopId())
                || !Objects.equals(request.externalReturnRef(), response.returnId())
                || response.returnStatus() == null || response.outcome() == null
                || response.refundAmount() == null || response.transactions() == null
                || response.recoveredFromShopify() == null || response.updatedAt() == null) {
            throw new ConnectorUnavailableException();
        }
        try {
            return new ReturnRefundProcessResult(
                    response.returnId(), response.returnStatus(),
                    ReturnRefundProcessOutcome.valueOf(response.outcome()),
                    moneyBag(response.refundAmount()),
                    response.transactions().stream()
                            .map(item -> new ReturnRefundProcessedTransaction(
                                    item.id(), item.parentTransactionId(), item.status(),
                                    moneyBag(item.amount())))
                            .toList(),
                    response.recoveredFromShopify(), response.updatedAt());
        } catch (RuntimeException exception) {
            throw new ConnectorUnavailableException();
        }
    }

    @Override
    public OrderShippingAddressUpdateResult updateShopifyOrderShippingAddress(
            UUID tenantId,
            UUID shopId,
            OrderShippingAddressUpdateRequest request) {
        if (tenantId == null || shopId == null || request == null
                || request.address() == null) {
            throw new IllegalArgumentException(
                    "Tenant, shop, and address command are required");
        }
        ConnectorContext connectorContext = new ConnectorContext(
                "erp-" + shopId,
                "erp-" + UUID.randomUUID());
        ConnectorOrderAddressResponse response = post(
                "/api/v1/erp-connector/shopify/order-shipping-address",
                new ConnectorOrderAddressRequest(
                        new ConnectorIdentity(tenantId.toString(), shopId.toString()),
                        connectorContext,
                        required(request.externalOrderRef(),
                                "External Shopify order reference is required"),
                        required(request.idempotencyKey(),
                                "Idempotency key is required"),
                        connectorAddress(request.address())),
                ConnectorOrderAddressResponse.class,
                STRICT_CONTRACT_JSON,
                connectorContext.correlationId());
        validateOrderAddressResponse(response, tenantId, shopId, request);
        return new OrderShippingAddressUpdateResult(
                address(response.address()), response.updatedAt());
    }

    @Override
    public OrderEditQuantityResult updateShopifyOrderLineQuantity(
            UUID tenantId,
            UUID shopId,
            OrderEditQuantityRequest request) {
        if (tenantId == null || shopId == null || request == null) {
            throw new IllegalArgumentException(
                    "Tenant, shop, and order line command are required");
        }
        ConnectorOrderEditQuantityResponse response = post(
                "/api/v1/erp-connector/shopify/order-edit-quantity",
                new ConnectorOrderEditQuantityRequest(
                        new ConnectorIdentity(tenantId.toString(), shopId.toString()),
                        new ConnectorContext(
                                "erp-" + shopId,
                                "erp-" + UUID.randomUUID()),
                        required(request.externalOrderRef(),
                                "External Shopify order reference is required"),
                        required(request.externalOrderLineRef(),
                                "External Shopify order line reference is required"),
                        required(request.externalVariantRef(),
                                "External Shopify variant reference is required"),
                        request.expectedQuantity(), request.quantity(),
                        request.restock(), request.notifyCustomer(),
                        required(request.idempotencyKey(),
                                "Idempotency key is required")),
                ConnectorOrderEditQuantityResponse.class);
        return new OrderEditQuantityResult(
                response.orderId(), response.orderLineId(),
                response.quantity(), money(response.total()),
                response.recoveredFromShopify(), response.updatedAt());
    }

    @Override
    public OrderAddVariantResult addShopifyOrderVariant(
            UUID tenantId,
            UUID shopId,
            OrderAddVariantRequest request) {
        if (tenantId == null || shopId == null || request == null) {
            throw new IllegalArgumentException(
                    "Tenant, shop, and order variant command are required");
        }
        ConnectorOrderAddVariantResponse response = post(
                "/api/v1/erp-connector/shopify/order-add-variant",
                new ConnectorOrderAddVariantRequest(
                        new ConnectorIdentity(
                                tenantId.toString(), shopId.toString()),
                        new ConnectorContext(
                                "erp-" + shopId,
                                "erp-" + UUID.randomUUID()),
                        required(request.externalOrderRef(),
                                "External Shopify order reference is required"),
                        required(request.externalVariantRef(),
                                "External Shopify variant reference is required"),
                        request.quantity(), request.notifyCustomer(),
                        request.recoverExisting(),
                        required(request.idempotencyKey(),
                                "Idempotency key is required")),
                ConnectorOrderAddVariantResponse.class);
        return new OrderAddVariantResult(
                response.orderId(), response.orderLineId(),
                response.variantId(), response.quantity(), response.sku(),
                response.title(), response.variantTitle(),
                money(response.unitPrice()), money(response.total()),
                response.recoveredFromShopify(), response.updatedAt());
    }

    @Override
    public OrderAddCustomItemResult addShopifyOrderCustomItem(
            UUID tenantId,
            UUID shopId,
            OrderAddCustomItemRequest request) {
        if (tenantId == null || shopId == null || request == null
                || request.unitPrice() == null) {
            throw new IllegalArgumentException(
                    "Tenant, shop, and custom order item command are required");
        }
        ConnectorOrderAddCustomItemResponse response = post(
                "/api/v1/erp-connector/shopify/order-add-custom-item",
                new ConnectorOrderAddCustomItemRequest(
                        new ConnectorIdentity(
                                tenantId.toString(), shopId.toString()),
                        new ConnectorContext(
                                "erp-" + shopId,
                                "erp-" + UUID.randomUUID()),
                        required(request.externalOrderRef(),
                                "External Shopify order reference is required"),
                        required(request.title(),
                                "Custom order item title is required"),
                        new ConnectorMoney(
                                required(request.unitPrice().amount(),
                                        "Custom order item amount is required"),
                                required(request.unitPrice().currencyCode(),
                                        "Custom order item currency is required")),
                        request.quantity(), request.requiresShipping(),
                        request.taxable(), request.notifyCustomer(),
                        request.recoverExisting(),
                        required(request.idempotencyKey(),
                                "Idempotency key is required")),
                ConnectorOrderAddCustomItemResponse.class);
        return new OrderAddCustomItemResult(
                response.orderId(), response.orderLineId(),
                response.title(), money(response.unitPrice()),
                response.quantity(), money(response.total()),
                response.recoveredFromShopify(), response.updatedAt());
    }

    @Override
    public OrderLineDiscountResult addShopifyOrderLineDiscount(
            UUID tenantId,
            UUID shopId,
            OrderLineDiscountRequest request) {
        if (tenantId == null || shopId == null || request == null
                || request.expectedDiscountTotal() == null
                || request.discountType() == null) {
            throw new IllegalArgumentException(
                    "Tenant, shop, and line discount command are required");
        }
        ConnectorMoney fixedValue = request.fixedValue() == null
                ? null : new ConnectorMoney(
                        required(request.fixedValue().amount(),
                                "Fixed discount amount is required"),
                        required(request.fixedValue().currencyCode(),
                                "Fixed discount currency is required"));
        ConnectorOrderLineDiscountResponse response = post(
                "/api/v1/erp-connector/shopify/order-line-discount",
                new ConnectorOrderLineDiscountRequest(
                        new ConnectorIdentity(
                                tenantId.toString(), shopId.toString()),
                        new ConnectorContext(
                                "erp-" + shopId,
                                "erp-" + UUID.randomUUID()),
                        required(request.externalOrderRef(),
                                "External Shopify order reference is required"),
                        required(request.externalOrderLineRef(),
                                "External Shopify order line reference is required"),
                        required(request.externalVariantRef(),
                                "External Shopify variant reference is required"),
                        request.expectedQuantity(),
                        new ConnectorMoney(
                                required(request.expectedDiscountTotal().amount(),
                                        "Expected discount total is required"),
                                required(request.expectedDiscountTotal().currencyCode(),
                                        "Expected discount currency is required")),
                        required(request.description(),
                                "Discount description is required"),
                        request.discountType(), fixedValue,
                        request.percentBasisPoints(),
                        request.notifyCustomer(), request.recoverExisting(),
                        required(request.idempotencyKey(),
                                "Idempotency key is required")),
                ConnectorOrderLineDiscountResponse.class);
        return new OrderLineDiscountResult(
                response.orderId(), response.orderLineId(),
                response.description(), response.discountType(),
                response.fixedValue() == null
                        ? null : money(response.fixedValue()),
                response.percentBasisPoints(), money(response.discountTotal()),
                money(response.total()), response.recoveredFromShopify(),
                response.updatedAt());
    }

    @Override
    public OrderCancellationResult cancelShopifyOrder(
            UUID tenantId, UUID shopId, OrderCancellationRequest request) {
        if (tenantId == null || shopId == null || request == null
                || request.reason() == null) {
            throw new IllegalArgumentException(
                    "Tenant, shop, and order cancellation are required");
        }
        ConnectorOrderCancellationResponse response = post(
                "/api/v1/erp-connector/shopify/order-cancel",
                new ConnectorOrderCancellationRequest(
                        new ConnectorIdentity(
                                tenantId.toString(), shopId.toString()),
                        new ConnectorContext("erp-" + shopId,
                                "erp-" + UUID.randomUUID()),
                        required(request.externalOrderRef(),
                                "External Shopify order reference is required"),
                        request.reason(), request.staffNote(),
                        request.refundOriginalPaymentMethods(),
                        request.restock(), request.notifyCustomer(),
                        request.recoverExisting(),
                        required(request.idempotencyKey(),
                                "Idempotency key is required")),
                ConnectorOrderCancellationResponse.class);
        return new OrderCancellationResult(
                response.orderId(), response.reason(),
                response.cancelledAt(), response.jobId(),
                response.recoveredFromShopify(), response.updatedAt());
    }

    @Override
    public FulfillmentPublishResult publishShopifyFulfillment(
            UUID tenantId,
            UUID shopId,
            FulfillmentPublishRequest request) {
        if (tenantId == null || shopId == null || request == null
                || request.tracking() == null || request.lines() == null) {
            throw new IllegalArgumentException(
                    "Tenant, shop, and fulfillment command are required");
        }
        ConnectorContext connectorContext = new ConnectorContext(
                "erp-" + shopId, "erp-" + UUID.randomUUID());
        ConnectorFulfillmentPublishResponse response = post(
                "/api/v1/erp-connector/shopify/fulfillment-publish",
                new ConnectorFulfillmentPublishRequest(
                        new ConnectorIdentity(
                                tenantId.toString(), shopId.toString()),
                        connectorContext,
                        required(request.externalOrderRef(),
                                "External Shopify order reference is required"),
                        required(request.idempotencyKey(),
                                "Idempotency key is required"),
                        request.notifyCustomer(),
                        new ConnectorTrackingInfo(
                                request.tracking().company(),
                                required(request.tracking().number(),
                                        "Tracking number is required"),
                                request.tracking().url()),
                        request.lines().stream()
                                .map(line -> new ConnectorFulfillmentLine(
                                        line.externalOrderLineRef(),
                                        line.quantity()))
                                .toList()),
                ConnectorFulfillmentPublishResponse.class,
                STRICT_CONTRACT_JSON,
                connectorContext.correlationId());
        validateFulfillmentPublishResponse(
                response, tenantId, shopId, request);
        return new FulfillmentPublishResult(
                response.fulfillmentIds(),
                new TrackingInfo(
                        response.tracking().company(),
                        response.tracking().number(),
                        response.tracking().url()),
                response.recoveredFromShopify(),
                response.updatedAt());
    }

    @Override
    public DisputeCatalogPage fetchShopifyDisputes(
            UUID tenantId,
            UUID shopId,
            DisputeCatalogRequest request) {
        ConnectorRequest base = connectorRequest(
                tenantId, shopId,
                request == null ? 50 : request.limit(),
                request == null ? null : request.cursor(),
                null);
        ConnectorDisputeCatalogResponse response = post(
                "/api/v1/erp-connector/shopify/dispute-catalog",
                new ConnectorDisputeCatalogRequest(
                        base.identity(), base.context(),
                        base.limit(), base.cursor()),
                ConnectorDisputeCatalogResponse.class,
                STRICT_CONTRACT_JSON,
                base.context().correlationId());
        validateDisputeCatalogResponse(response, tenantId, shopId,
                request == null ? 50 : request.limit());
        ConnectionStatus status = "CONNECTED".equals(response.state())
                ? ConnectionStatus.CONNECTED
                : ConnectionStatus.NOT_CONNECTED;
        return new DisputeCatalogPage(
                ConnectorMode.XZ_ERP_APP,
                status,
                response.pageInfo() == null
                        ? null : response.pageInfo().endCursor(),
                response.pageInfo() != null
                        && response.pageInfo().hasNextPage(),
                response.fetchedAt(),
                response.disputes().stream()
                        .map(item -> new Dispute(
                                item.id(), item.orderId(), item.orderName(),
                                item.status(), item.type(), item.reason(),
                                item.networkReasonCode(), money(item.amount()),
                                parseInstant(item.initiatedAt()),
                                parseInstant(item.evidenceDueBy()),
                                parseInstant(item.evidenceSentOn()),
                                parseInstant(item.finalizedOn())))
                        .toList());
    }

    @Override
    public List<ShopifyComplianceRequest> listShopifyComplianceRequests() {
        ConnectorComplianceRequestListResponse response = get(
                "/internal/v1/shopify/compliance-requests",
                ConnectorComplianceRequestListResponse.class,
                STRICT_CONTRACT_JSON);
        validateComplianceRequestList(response);
        return response.requests().stream()
                .map(item -> new ShopifyComplianceRequest(
                        item.id(),
                        UUID.fromString(item.identity().tenantId()),
                        UUID.fromString(item.identity().shopId()),
                        item.shopDomain(),
                        complianceTopic(item.topic()),
                        item.referenceIds(),
                        item.occurredAt()))
                .toList();
    }

    @Override
    public ShopifyComplianceCompletion completeShopifyComplianceRequest(
            String eventId,
            ShopifyComplianceOutcome outcome) {
        String normalizedEventId = validEventId(eventId);
        if (outcome == null) {
            throw new IllegalArgumentException(
                    "Shopify compliance outcome is required");
        }
        String wireOutcome = complianceOutcome(outcome);
        ConnectorComplianceCompletionResponse response = post(
                "/internal/v1/shopify/compliance-requests/complete",
                new ConnectorComplianceCompletionRequest(
                        normalizedEventId, wireOutcome),
                ConnectorComplianceCompletionResponse.class,
                STRICT_CONTRACT_JSON);
        validateComplianceCompletion(
                response, normalizedEventId, wireOutcome);
        return new ShopifyComplianceCompletion(
                response.eventId(),
                outcome,
                response.completedAt(),
                response.alreadyCompleted());
    }

    private <T> T get(
            String path,
            Class<T> responseType,
            ObjectMapper mapper) {
        if (readBinding != null) throw new ConnectorUnavailableException();
        try {
            HttpRequest request = HttpRequest.newBuilder(resolve(path))
                    .timeout(timeout)
                    .header("Accept", "application/json")
                    .header("X-XZ-ERP-Connector-Token", connectorToken)
                    .GET()
                    .build();
            HttpResponse<String> response = client.send(
                    request,
                    HttpResponse.BodyHandlers.ofString());
            if (response.body() != null
                    && response.body().getBytes(
                            java.nio.charset.StandardCharsets.UTF_8).length
                    > MAX_BODY_BYTES) {
                throw new ConnectorUnavailableException();
            }
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new ConnectorUnavailableException();
            }
            return mapper.readValue(response.body(), responseType);
        } catch (ConnectorUnavailableException exception) {
            throw exception;
        } catch (Exception ex) {
            if (ex instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            throw new ConnectorUnavailableException();
        }
    }

    private <T> T post(String path, Object payload, Class<T> responseType) {
        return post(path, payload, responseType, JSON);
    }

    private <T> T post(
            String path,
            Object payload,
            Class<T> responseType,
            ObjectMapper mapper) {
        return post(path, payload, responseType, mapper, null);
    }

    private <T> T post(
            String path,
            Object payload,
            Class<T> responseType,
            ObjectMapper mapper,
            String expectedCorrelationId) {
        try {
            if (readBinding != null) {
                path = switch (path) {
                    case "/api/v1/erp-connector/shopify/connection" ->
                        "/internal/v1/erp-store-app/shopify/connection";
                    case "/api/v1/erp-connector/shopify/order-catalog" ->
                        "/internal/v1/erp-store-app/shopify/order-catalog";
                    default -> throw new ConnectorUnavailableException();
                };
            }
            String body = mapper.writeValueAsString(payload);
            HttpRequest.Builder builder = HttpRequest.newBuilder(resolve(path))
                    .timeout(timeout)
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .header("X-XZ-ERP-Connector-Token", connectorToken)
                    .POST(HttpRequest.BodyPublishers.ofString(body));
            if (readBinding != null) builder.header(
                    "X-XZ-Store-App-Binding-Version", Long.toString(readBinding.version()));
            HttpRequest request = builder.build();
            HttpResponse<String> response = client.send(
                    request,
                    HttpResponse.BodyHandlers.ofString());
            if (response.body() != null
                    && response.body().getBytes(java.nio.charset.StandardCharsets.UTF_8).length
                    > MAX_BODY_BYTES) {
                throw new ConnectorUnavailableException();
            }
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                if (readBinding != null) throw new ConnectorUnavailableException();
                if (path.startsWith("/api/v1/shopify-connector/installations/native-link/")) {
                    var error = STRICT_CONTRACT_JSON.readValue(response.body(), NativeLinkError.class);
                    if (response.statusCode() == 409 && error != null
                            && "NATIVE_LINK_UNAVAILABLE".equals(error.code()) && Boolean.FALSE.equals(error.retryable())) {
                        throw new ConnectorUnavailableException("NATIVE_LINK_UNAVAILABLE", false, null);
                    }
                    throw new ConnectorUnavailableException();
                }
                throw decodeSafeConnectorError(
                        response.statusCode(), response.body(),
                        expectedCorrelationId);
            }
            if (readBinding != null && (
                    !response.headers().allValues("X-XZ-Shopify-Provider").equals(
                            List.of("CUSTOMER_SERVICE_STORE_APP_READ_ONLY"))
                    || !response.headers().allValues("X-XZ-Store-App-Binding-Version").equals(
                            List.of(Long.toString(readBinding.version()))))) {
                throw new ConnectorUnavailableException();
            }
            return mapper.readValue(response.body(), responseType);
        } catch (ConnectorUnavailableException exception) {
            throw exception;
        } catch (Exception ex) {
            if (ex instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            throw new ConnectorUnavailableException();
        }
    }

    private void requireReadBinding(UUID tenantId, UUID shopId) {
        if (readBinding != null && (!readBinding.tenantId().equals(tenantId)
                || !readBinding.shopId().equals(shopId))) {
            throw new ConnectorUnavailableException();
        }
    }

    private static ConnectorUnavailableException decodeSafeConnectorError(
            int status, String body, String expectedCorrelationId) {
        try {
            ConnectorErrorResponse error = STRICT_CONTRACT_JSON.readValue(
                    body, ConnectorErrorResponse.class);
            if (error == null || error.code() == null
                    || error.message() == null || error.retryable() == null
                    || expectedCorrelationId == null
                    || !expectedCorrelationId.equals(error.correlationId())
                    || !boundedConnectorErrorMessage(error.message())) {
                return new ConnectorUnavailableException();
            }
            boolean valid = switch (error.code()) {
                case "INVALID_REQUEST" -> status == 400 && !error.retryable();
                case "FORBIDDEN" -> status == 403 && !error.retryable();
                case "PROTECTED_CUSTOMER_DATA_REQUIRED" ->
                        status == 403 && !error.retryable();
                case "CANCELED" -> status == 408 && !error.retryable();
                case "TIMEOUT" -> status == 504 && error.retryable();
                case "CONNECTOR_UNAVAILABLE" ->
                        status == 502 && error.retryable();
                default -> false;
            };
            return valid
                    ? new ConnectorUnavailableException(
                            error.code(), error.retryable(),
                            error.correlationId())
                    : new ConnectorUnavailableException();
        } catch (Exception ignored) {
            return new ConnectorUnavailableException();
        }
    }

    private static boolean boundedConnectorErrorMessage(String value) {
        if (value.isEmpty() || value.length() > 256) {
            return false;
        }
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (Character.isISOControl(character)
                    && character != '\n' && character != '\r'
                    && character != '\t') {
                return false;
            }
        }
        return true;
    }

    private static void validateConnectionResponse(
            ConnectorConnectionResponse response,
            UUID tenantId,
            UUID shopId) {
        if (response == null
                || !CONNECTION_CONTRACT_VERSION.equals(response.contractVersion())
                || tenantId == null
                || shopId == null
                || !tenantId.toString().equals(response.tenantId())
                || !shopId.toString().equals(response.shopId())
                || response.state() == null
                || response.grantedScopes() == null
                || response.checkedAt() == null) {
            throw new ConnectorUnavailableException();
        }
        String previous = null;
        for (String scope : response.grantedScopes()) {
            if (scope == null) {
                throw new ConnectorUnavailableException();
            }
            String normalized = scope.trim().toLowerCase(Locale.ROOT);
            if (normalized.isEmpty()
                    || !normalized.equals(scope)
                    || (previous != null && previous.compareTo(scope) >= 0)) {
                throw new ConnectorUnavailableException();
            }
            previous = scope;
        }
        switch (response.state()) {
            case "CONNECTED" -> {
                if (response.grantedScopes().isEmpty()) {
                    throw new ConnectorUnavailableException();
                }
                boolean hasName = response.shopName() != null
                        && !response.shopName().isBlank();
                boolean hasDomain = response.shopDomain() != null
                        && !response.shopDomain().isBlank();
                if (hasName != hasDomain) {
                    throw new ConnectorUnavailableException();
                }
                if (hasName && (!response.shopName().equals(
                                response.shopName().strip())
                        || response.shopName().length() > 160
                        || !response.shopDomain().equals(
                                response.shopDomain().strip().toLowerCase(
                                        Locale.ROOT))
                        || !response.shopDomain().matches(
                                "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.myshopify\\.com$"))) {
                    throw new ConnectorUnavailableException();
                }
            }
            case "DISCONNECTED" -> {
                // Revocation retains the connector-owned authorization fact.
            }
            case "NOT_CONFIGURED" -> {
                if (!response.grantedScopes().isEmpty()) {
                    throw new ConnectorUnavailableException();
                }
            }
            default -> throw new ConnectorUnavailableException();
        }
    }

    private static void validateComplianceRequestList(
            ConnectorComplianceRequestListResponse response) {
        if (response == null || response.requests() == null
                || response.requests().size() > 100) {
            throw new ConnectorUnavailableException();
        }
        Set<String> eventIds = new HashSet<>();
        for (ConnectorComplianceRequest item : response.requests()) {
            if (item == null || !"shopify.compliance.requested".equals(
                    item.kind()) || item.identity() == null
                    || !validUuid(item.identity().tenantId())
                    || !validUuid(item.identity().shopId())
                    || !validShopDomain(item.shopDomain())
                    || item.referenceIds() == null
                    || item.referenceIds().isEmpty()
                    || item.referenceIds().size() > 250
                    || item.occurredAt() == null) {
                throw new ConnectorUnavailableException();
            }
            if (!validEventIdForTopic(item.id(), item.topic())
                    || !eventIds.add(item.id())) {
                throw new ConnectorUnavailableException();
            }
            complianceTopic(item.topic());
            Set<String> references = new HashSet<>();
            int shopReferences = 0;
            for (String reference : item.referenceIds()) {
                if (reference == null
                        || !(reference.matches(
                                "^(?:shop|customer|order):(?:0|[1-9][0-9]{0,31})$")
                        || reference.matches(
                                "^customer_email_sha256:[a-f0-9]{64}$"))
                        || !references.add(reference)) {
                    throw new ConnectorUnavailableException();
                }
                if (reference.startsWith("shop:")) {
                    shopReferences++;
                }
            }
            if (shopReferences != 1) {
                throw new ConnectorUnavailableException();
            }
        }
    }

    private static void validateComplianceCompletion(
            ConnectorComplianceCompletionResponse response,
            String eventId,
            String outcome) {
        if (response == null
                || !eventId.equals(response.eventId())
                || !outcome.equals(response.outcome())
                || response.completedAt() == null
                || response.alreadyCompleted() == null) {
            throw new ConnectorUnavailableException();
        }
    }

    private static ShopifyComplianceTopic complianceTopic(String value) {
        return switch (value == null ? "" : value) {
            case "customers/data_request" ->
                    ShopifyComplianceTopic.CUSTOMER_DATA_REQUEST;
            case "customers/redact" ->
                    ShopifyComplianceTopic.CUSTOMER_REDACT;
            case "shop/redact" -> ShopifyComplianceTopic.SHOP_REDACT;
            default -> throw new ConnectorUnavailableException();
        };
    }

    private static String complianceOutcome(
            ShopifyComplianceOutcome outcome) {
        return switch (outcome) {
            case EXPORTED -> "exported";
            case ANONYMIZED -> "anonymized";
            case DELETED -> "deleted";
            case NOT_FOUND -> "not_found";
        };
    }

    private static String validEventId(String value) {
        if (value == null || !value.equals(value.strip())
                || !value.matches(
                        "^shopify-compliance/(?:customers/data_request|customers/redact|shop/redact)/[A-Za-z0-9._:-]{1,128}$")) {
            throw new IllegalArgumentException(
                    "Shopify compliance event ID is invalid");
        }
        return value;
    }

    private static boolean validEventIdForTopic(
            String value,
            String topic) {
        try {
            return validEventId(value).startsWith(
                    "shopify-compliance/" + topic + "/");
        } catch (IllegalArgumentException invalid) {
            return false;
        }
    }

    private static boolean validUuid(String value) {
        if (value == null || !value.equals(value.strip())) {
            return false;
        }
        try {
            return UUID.fromString(value).toString().equals(value);
        } catch (IllegalArgumentException invalid) {
            return false;
        }
    }

    private static boolean validShopDomain(String value) {
        return value != null
                && value.equals(value.strip().toLowerCase(Locale.ROOT))
                && value.matches(
                        "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.myshopify\\.com$");
    }

    private static void validateFulfillmentPublishResponse(
            ConnectorFulfillmentPublishResponse response,
            UUID tenantId,
            UUID shopId,
            FulfillmentPublishRequest request) {
        if (response == null
                || !FULFILLMENT_PUBLISH_CONTRACT_VERSION.equals(
                        response.contractVersion())
                || tenantId == null || shopId == null || request == null
                || !tenantId.toString().equals(response.tenantId())
                || !shopId.toString().equals(response.shopId())
                || !request.externalOrderRef().equals(response.orderId())
                || response.fulfillmentIds() == null
                || response.fulfillmentIds().size() != 1
                || !validShopifyGid(
                        response.fulfillmentIds().getFirst(),
                        "gid://shopify/Fulfillment/")
                || response.tracking() == null
                || !request.tracking().number().equals(
                        response.tracking().number())
                || !validOptionalConnectorText(
                        response.tracking().company(), 120)
                || !validConnectorTrackingUrl(
                        response.tracking().url())
                || response.recoveredFromShopify() == null
                || response.updatedAt() == null) {
            throw new ConnectorUnavailableException();
        }
    }

    private static void validateOrderAddressResponse(
            ConnectorOrderAddressResponse response,
            UUID tenantId,
            UUID shopId,
            OrderShippingAddressUpdateRequest request) {
        if (response == null
                || !ORDER_SHIPPING_ADDRESS_CONTRACT_VERSION.equals(
                        response.contractVersion())
                || tenantId == null || shopId == null || request == null
                || !tenantId.toString().equals(response.tenantId())
                || !shopId.toString().equals(response.shopId())
                || !request.externalOrderRef().equals(response.orderId())
                || response.address() == null || response.updatedAt() == null
                || !sameRequestedAddress(
                        connectorAddress(request.address()),
                        response.address())) {
            throw new ConnectorUnavailableException();
        }
    }

    private static boolean sameRequestedAddress(
            ConnectorMailingAddress expected,
            ConnectorMailingAddress actual) {
        return Objects.equals(expected.firstName(), actual.firstName())
                && Objects.equals(expected.lastName(), actual.lastName())
                && Objects.equals(expected.company(), actual.company())
                && Objects.equals(expected.address1(), actual.address1())
                && Objects.equals(expected.address2(), actual.address2())
                && Objects.equals(expected.city(), actual.city())
                && Objects.equals(expected.provinceCode(), actual.provinceCode())
                && Objects.equals(expected.countryCode(), actual.countryCode())
                && Objects.equals(expected.zip(), actual.zip())
                && Objects.equals(expected.phone(), actual.phone());
    }

    private static boolean validShopifyGid(
            String value,
            String prefix) {
        if (value == null || !value.startsWith(prefix)
                || value.length() == prefix.length()) {
            return false;
        }
        for (int index = prefix.length(); index < value.length(); index++) {
            char character = value.charAt(index);
            if (character < '0' || character > '9') {
                return false;
            }
        }
        return true;
    }

    private static boolean validOptionalConnectorText(
            String value,
            int limit) {
        if (value == null) {
            return true;
        }
        if (value.length() > limit || !value.equals(value.strip())) {
            return false;
        }
        return value.chars().noneMatch(Character::isISOControl);
    }

    private static boolean validConnectorTrackingUrl(String value) {
        if (value == null || value.isEmpty()) {
            return true;
        }
        if (!validOptionalConnectorText(value, 2048)) {
            return false;
        }
        try {
            URI parsed = URI.create(value);
            return parsed.getHost() != null && parsed.getUserInfo() == null
                    && ("http".equalsIgnoreCase(parsed.getScheme())
                            || "https".equalsIgnoreCase(parsed.getScheme()));
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private static void validateProductCatalogResponse(
            ConnectorProductCatalogResponse response,
            UUID tenantId,
            UUID shopId,
            int requestedLimit) {
        if (response == null
                || !"shopify.connector.product_catalog.v1".equals(
                        response.contractVersion())
                || tenantId == null
                || shopId == null
                || !tenantId.toString().equals(response.tenantId())
                || !shopId.toString().equals(response.shopId())
                || response.state() == null
                || response.pageInfo() == null
                || response.pageInfo().hasNextPage() == null
                || response.products() == null
                || response.products().size() > requestedLimit
                || (response.pageInfo().hasNextPage()
                        && (response.pageInfo().endCursor() == null
                                || response.pageInfo().endCursor().isBlank()))) {
            throw new ConnectorUnavailableException();
        }
        switch (response.state()) {
            case "CONNECTED" -> {
                if (response.fetchedAt() == null) {
                    throw new ConnectorUnavailableException();
                }
            }
            case "NOT_CONFIGURED" -> {
                if (response.fetchedAt() != null
                        || !response.products().isEmpty()
                        || response.pageInfo().hasNextPage()
                        || (response.pageInfo().endCursor() != null
                                && !response.pageInfo().endCursor().isEmpty())) {
                    throw new ConnectorUnavailableException();
                }
            }
            default -> throw new ConnectorUnavailableException();
        }
        var productIds = new HashSet<String>();
        var variantIds = new HashSet<String>();
        for (ConnectorProduct product : response.products()) {
            if (product == null
                    || product.id() == null
                    || product.id().isBlank()
                    || product.title() == null
                    || product.title().isBlank()
                    || product.variants() == null
                    || !productIds.add(product.id())) {
                throw new ConnectorUnavailableException();
            }
            for (ConnectorVariant variant : product.variants()) {
                if (variant == null
                        || variant.id() == null
                        || variant.id().isBlank()
                        || variant.title() == null
                        || variant.title().isBlank()
                        || !variantIds.add(variant.id())) {
                    throw new ConnectorUnavailableException();
                }
            }
        }
    }

    private static void validateOrderCatalogResponse(
            ConnectorOrderCatalogResponse response,
            UUID tenantId,
            UUID shopId,
            int requestedLimit) {
        if (response == null
                || !"shopify.connector.order_catalog.v1".equals(
                        response.contractVersion())
                || tenantId == null
                || shopId == null
                || !tenantId.toString().equals(response.tenantId())
                || !shopId.toString().equals(response.shopId())
                || response.state() == null
                || response.pageInfo() == null
                || response.pageInfo().hasNextPage() == null
                || response.orders() == null
                || response.orders().size() > requestedLimit
                || (response.pageInfo().hasNextPage()
                        && (response.pageInfo().endCursor() == null
                                || response.pageInfo().endCursor().isBlank()))) {
            throw new ConnectorUnavailableException();
        }
        switch (response.state()) {
            case "CONNECTED" -> {
                if (response.fetchedAt() == null) {
                    throw new ConnectorUnavailableException();
                }
            }
            case "NOT_CONFIGURED" -> {
                if (response.fetchedAt() != null
                        || !response.orders().isEmpty()
                        || response.pageInfo().hasNextPage()
                        || (response.pageInfo().endCursor() != null
                                && !response.pageInfo().endCursor().isEmpty())) {
                    throw new ConnectorUnavailableException();
                }
            }
            default -> throw new ConnectorUnavailableException();
        }
        var orderIds = new HashSet<String>();
        var lineIds = new HashSet<String>();
        var fulfillmentIds = new HashSet<String>();
        for (ConnectorOrder order : response.orders()) {
            if (order == null
                    || order.id() == null
                    || order.id().isBlank()
                    || order.name() == null
                    || order.name().isBlank()
                    || order.createdAt() == null
                    || order.createdAt().isBlank()
                    || order.total() == null
                    || order.lineItems() == null
                    || order.fulfillments() == null
                    || order.fulfillments().size() > 10
                    || !orderIds.add(order.id())) {
                throw new ConnectorUnavailableException();
            }
            for (ConnectorLineItem line : order.lineItems()) {
                if (line == null
                        || line.id() == null
                        || line.id().isBlank()
                        || line.name() == null
                        || line.name().isBlank()
                        || !lineIds.add(line.id())) {
                    throw new ConnectorUnavailableException();
                }
            }
            for (ConnectorFulfillment fulfillment : order.fulfillments()) {
                if (fulfillment == null
                        || fulfillment.id() == null
                        || fulfillment.id().isBlank()
                        || !fulfillmentIds.add(fulfillment.id())) {
                    throw new ConnectorUnavailableException();
                }
            }
        }
    }

    private static void validateCustomerCatalogResponse(
            ConnectorCustomerCatalogResponse response,
            UUID tenantId,
            UUID shopId,
            int requestedLimit) {
        if (response == null) {
            throw new ConnectorUnavailableException();
        }
        validateReadPage(response.contractVersion(),
                "shopify.connector.customer_catalog.v1",
                response.tenantId(), response.shopId(), response.state(),
                response.pageInfo(), response.fetchedAt(), response.customers(),
                tenantId, shopId, requestedLimit);
        var customerIds = new HashSet<String>();
        for (ConnectorCustomerProfile value : response.customers()) {
            if (value == null || value.id() == null || value.id().isBlank()
                    || value.displayName() == null || value.displayName().isBlank()
                    || value.createdAt() == null || value.createdAt().isBlank()
                    || value.updatedAt() == null || value.updatedAt().isBlank()
                    || value.tags() == null || value.numberOfOrders() == null
                    || !value.numberOfOrders().matches("^[0-9]+$")
                    || value.totalSpent() == null || !customerIds.add(value.id())) {
                throw new ConnectorUnavailableException();
            }
            parseInstant(value.createdAt());
            parseInstant(value.updatedAt());
            if (value.lastOrder() != null) {
                if (value.lastOrder().id() == null || value.lastOrder().id().isBlank()
                        || value.lastOrder().name() == null || value.lastOrder().name().isBlank()
                        || value.lastOrder().createdAt() == null
                        || value.lastOrder().createdAt().isBlank()
                        || value.lastOrder().total() == null) {
                    throw new ConnectorUnavailableException();
                }
                parseInstant(value.lastOrder().createdAt());
            }
        }
    }

    private static void validateReadPage(String contract, String expectedContract,
            String responseTenant, String responseShop, String state,
            ConnectorPageInfo pageInfo, Instant fetchedAt, List<?> values,
            UUID tenantId, UUID shopId, int requestedLimit) {
        if (!expectedContract.equals(contract) || tenantId == null || shopId == null
                || !tenantId.toString().equals(responseTenant)
                || !shopId.toString().equals(responseShop) || state == null
                || pageInfo == null || pageInfo.hasNextPage() == null
                || values == null || values.size() > requestedLimit
                || (pageInfo.hasNextPage() && (pageInfo.endCursor() == null
                        || pageInfo.endCursor().isBlank()))) {
            throw new ConnectorUnavailableException();
        }
        switch (state) {
            case "CONNECTED" -> { if (fetchedAt == null) throw new ConnectorUnavailableException(); }
            case "NOT_CONFIGURED" -> {
                if (fetchedAt != null || !values.isEmpty() || pageInfo.hasNextPage()
                        || (pageInfo.endCursor() != null && !pageInfo.endCursor().isEmpty())) {
                    throw new ConnectorUnavailableException();
                }
            }
            default -> throw new ConnectorUnavailableException();
        }
    }

    private static void validateLocationCatalogResponse(ConnectorLocationCatalogResponse response,
            UUID tenantId, UUID shopId, int requestedLimit) {
        if (response == null) throw new ConnectorUnavailableException();
        validateReadPage(response.contractVersion(), "shopify.connector.location_catalog.v1",
                response.tenantId(), response.shopId(), response.state(), response.pageInfo(),
                response.fetchedAt(), response.locations(), tenantId, shopId, requestedLimit);
        var ids = new HashSet<String>();
        for (ConnectorLocation value : response.locations()) {
            if (value == null || value.id() == null || value.id().isBlank()
                    || value.name() == null || value.name().isBlank() || !ids.add(value.id())) {
                throw new ConnectorUnavailableException();
            }
        }
    }

    private static void validateInventoryLevelResponse(ConnectorInventoryLevelResponse response,
            UUID tenantId, UUID shopId, String inventoryItemId, String locationId) {
        if (response == null || !"shopify.connector.inventory_level.v1".equals(response.contractVersion())
                || tenantId == null || shopId == null || !tenantId.toString().equals(response.tenantId())
                || !shopId.toString().equals(response.shopId()) || response.state() == null
                || !Objects.equals(inventoryItemId, response.inventoryItemId())
                || !Objects.equals(locationId, response.locationId()) || response.tracked() == null
                || response.active() == null || response.availableQuantity() == null) {
            throw new ConnectorUnavailableException();
        }
        switch (response.state()) {
            case "CONNECTED" -> { if (response.fetchedAt() == null) throw new ConnectorUnavailableException(); }
            case "NOT_CONFIGURED" -> {
                if (response.fetchedAt() != null || response.tracked() || response.active()
                        || response.availableQuantity() != 0 || response.onHandQuantity() != null) {
                    throw new ConnectorUnavailableException();
                }
            }
            default -> throw new ConnectorUnavailableException();
        }
    }

    private static void validateInventorySetResponse(ConnectorInventorySetResponse response,
            UUID tenantId, UUID shopId, String inventoryItemId, String locationId,
            int expectedAvailable, int targetAvailable) {
        if (response == null || !"shopify.connector.inventory_set.v1".equals(response.contractVersion())
                || tenantId == null || shopId == null || !tenantId.toString().equals(response.tenantId())
                || !shopId.toString().equals(response.shopId()) || response.outcome() == null
                || !Objects.equals(inventoryItemId, response.inventoryItemId())
                || !Objects.equals(locationId, response.locationId())
                || response.expectedAvailable() == null || response.targetAvailable() == null
                || response.expectedAvailable() != expectedAvailable
                || response.targetAvailable() != targetAvailable || response.updatedAt() == null) {
            throw new ConnectorUnavailableException();
        }
        switch (response.outcome()) {
            case "APPLIED" -> { if (response.safeErrorCode() != null && !response.safeErrorCode().isEmpty()) throw new ConnectorUnavailableException(); }
            case "STALE" -> { if (!"SHOPIFY_INVENTORY_STALE".equals(response.safeErrorCode())) throw new ConnectorUnavailableException(); }
            case "REJECTED" -> {
                if (response.safeErrorCode() == null
                        || !Set.of("SHOPIFY_INVENTORY_REJECTED", "SHOPIFY_IDEMPOTENCY_BUSY",
                        "SHOPIFY_IDEMPOTENCY_CONFLICT", "SHOPIFY_IDEMPOTENCY_FAILED")
                        .contains(response.safeErrorCode())) throw new ConnectorUnavailableException();
            }
            default -> throw new ConnectorUnavailableException();
        }
    }

    private static void validateReturnCatalogResponse(
            ConnectorReturnCatalogResponse response,
            UUID tenantId,
            UUID shopId,
            int requestedLimit) {
        if (response == null) throw new ConnectorUnavailableException();
        validateReadPage(response.contractVersion(), "shopify.connector.return_catalog.v1",
                response.tenantId(), response.shopId(), response.state(), response.pageInfo(),
                response.fetchedAt(), response.returns(), tenantId, shopId, requestedLimit);
        var returnIds = new HashSet<String>(); var lineIds = new HashSet<String>();
        for (ConnectorReturn value : response.returns()) {
            if (value == null || value.id() == null || value.id().isBlank()
                    || value.orderId() == null || value.orderId().isBlank()
                    || value.lineItems() == null || value.lineItems().isEmpty()
                    || !returnIds.add(value.id())) throw new ConnectorUnavailableException();
            for (ConnectorReturnLine line : value.lineItems()) {
                if (line == null || line.id() == null || line.id().isBlank()
                        || !lineIds.add(line.id())) throw new ConnectorUnavailableException();
            }
        }
    }

    private static void validateReturnRefundPreview(
            ConnectorReturnRefundPreviewResponse response,
            UUID tenantId,
            UUID shopId,
            ReturnRefundPreviewRequest request) {
        if (response == null
                || !"shopify.connector.return_refund_preview.v1".equals(response.contractVersion())
                || !tenantId.toString().equals(response.tenantId())
                || !shopId.toString().equals(response.shopId())
                || !Objects.equals(request.externalReturnRef(), response.returnId())
                || response.state() == null || response.lineItems() == null
                || response.refundDuties() == null || response.refundAmount() == null
                || response.maximumRefundable() == null || response.transactions() == null
                || response.fetchedAt() == null) {
            throw new ConnectorUnavailableException();
        }
        if ("REFUNDABLE".equals(response.state())
                && (response.previewToken() == null || response.previewToken().isBlank()
                || response.expiresAt() == null)) {
            throw new ConnectorUnavailableException();
        }
    }

    private static ReturnRefundPreview returnRefundPreview(
            ConnectorReturnRefundPreviewResponse response) {
        try {
            return new ReturnRefundPreview(
                    response.returnId(), ReturnRefundPreviewState.valueOf(response.state()),
                    response.lineItems().stream()
                            .map(item -> new ReturnRefundLineSelection(
                                    item.returnLineId(), item.quantity()))
                            .toList(),
                    response.refundShipping(),
                    response.refundDuties().stream()
                            .map(item -> new ReturnRefundDutySelection(
                                    item.dutyId(), ReturnRefundDutyType.valueOf(item.refundType())))
                            .toList(),
                    moneyBag(response.shippingAmount()), moneyBag(response.dutyAmount()),
                    moneyBag(response.refundAmount()), moneyBag(response.maximumRefundable()),
                    response.transactions().stream()
                            .map(item -> new ReturnRefundTransaction(
                                    item.parentTransactionId(), moneyBag(item.amount()),
                                    item.gateway(), item.formattedGateway(), item.accountNumber()))
                            .toList(),
                    response.previewToken(), response.expiresAt(), response.fetchedAt());
        } catch (RuntimeException exception) {
            throw new ConnectorUnavailableException();
        }
    }

    private static void validateDisputeCatalogResponse(ConnectorDisputeCatalogResponse response,
            UUID tenantId, UUID shopId, int requestedLimit) {
        if (response == null) throw new ConnectorUnavailableException();
        validateReadPage(response.contractVersion(), "shopify.connector.dispute_catalog.v1",
                response.tenantId(), response.shopId(), response.state(), response.pageInfo(),
                response.fetchedAt(), response.disputes(), tenantId, shopId, requestedLimit);
        var ids = new HashSet<String>();
        for (ConnectorDispute value : response.disputes()) {
            if (value == null || value.id() == null || value.id().isBlank()
                    || value.status() == null || value.type() == null || value.amount() == null
                    || !ids.add(value.id())) {
                throw new ConnectorUnavailableException();
            }
        }
    }

    private URI resolve(String path) {
        String base = baseUrl.toString();
        if (!base.endsWith("/")) {
            base += "/";
        }
        return URI.create(base).resolve(path.startsWith("/")
                ? path.substring(1)
                : path);
    }

    private static ConnectorRequest connectorRequest(
            UUID tenantId,
            UUID shopId,
            ProductCatalogRequest request) {
        return connectorRequest(
                tenantId,
                shopId,
                request == null ? 50 : request.limit(),
                request == null ? null : request.cursor(),
                request == null ? null : request.query());
    }

    private static ConnectorRequest connectorRequest(
            UUID tenantId,
            UUID shopId,
            OrderCatalogRequest request) {
        return connectorRequest(
                tenantId,
                shopId,
                request == null ? 50 : request.limit(),
                request == null ? null : request.cursor(),
                request == null ? null : request.query());
    }

    private static ConnectorRequest connectorRequest(
            UUID tenantId,
            UUID shopId,
            CustomerCatalogRequest request) {
        return connectorRequest(
                tenantId,
                shopId,
                request == null ? 50 : request.limit(),
                request == null ? null : request.cursor(),
                request == null ? null : request.query());
    }

    private static ConnectorRequest connectorRequest(
            UUID tenantId,
            UUID shopId,
            Integer requestedLimit,
            String cursor,
            String query) {
        if (tenantId == null || shopId == null) {
            throw new IllegalArgumentException("Tenant and shop are required");
        }
        int limit = requestedLimit == null || requestedLimit < 1 ? 50 : requestedLimit;
        return new ConnectorRequest(
                new ConnectorIdentity(tenantId.toString(), shopId.toString()),
                new ConnectorContext(
                        "erp-" + shopId,
                        "erp-" + UUID.randomUUID()),
                limit,
                nullable(cursor),
                nullable(query));
    }

    private static URI validateBaseUrl(
            String rawBaseUrl,
            boolean allowPrivateHttp) {
        URI uri = URI.create(required(rawBaseUrl,
                "XZ ERP App connector base URL is required").strip());
        if (uri.getHost() == null || uri.getRawQuery() != null
                || uri.getRawFragment() != null
                || uri.getRawUserInfo() != null) {
            throw new IllegalArgumentException(
                    "XZ ERP App connector base URL is invalid");
        }
        String scheme = uri.getScheme();
        if (!"https".equalsIgnoreCase(scheme)
                && !("http".equalsIgnoreCase(scheme)
                && (isLoopback(uri.getHost())
                || (allowPrivateHttp
                && isSingleLabelPrivateHost(uri.getHost()))))) {
            throw new IllegalArgumentException(
                    "XZ ERP App connector requires HTTPS, loopback HTTP, "
                    + "or explicitly allowed private HTTP");
        }
        return uri;
    }

    private static boolean isSingleLabelPrivateHost(String host) {
        return host != null
                && !host.contains(".")
                && host.matches("[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?");
    }

    private static String validateAuthorizationStartResponse(
            ConnectorOAuthStartResponse response) {
        if (response == null
                || !INSTALLATION_CONTRACT_VERSION.equals(
                        response.contractVersion())
                || response.authorizationUrl() == null) {
            throw new ConnectorUnavailableException();
        }
        try {
            URI authorizationUrl = URI.create(
                    response.authorizationUrl().strip());
            if (!"https".equalsIgnoreCase(authorizationUrl.getScheme())
                    || authorizationUrl.getHost() == null
                    || authorizationUrl.getRawUserInfo() != null
                    || authorizationUrl.getRawFragment() != null
                    || !"/shopify/oauth/authorize".equals(
                            authorizationUrl.getPath())
                    || authorizationUrl.getRawQuery() == null
                    || !OAUTH_GRANT_QUERY.matcher(
                            authorizationUrl.getRawQuery()).matches()) {
                throw new ConnectorUnavailableException();
            }
            return authorizationUrl.toString();
        } catch (IllegalArgumentException invalid) {
            throw new ConnectorUnavailableException();
        }
    }

    private static void validateUninstallResponse(
            ConnectorUninstallResponse response,
            UUID tenantId,
            UUID shopId) {
        if (response == null
                || !INSTALLATION_CONTRACT_VERSION.equals(
                        response.contractVersion())
                || tenantId == null
                || shopId == null
                || !tenantId.toString().equals(response.tenantId())
                || !shopId.toString().equals(response.shopId())
                || !Boolean.TRUE.equals(response.installationRevoked())
                || !Boolean.TRUE.equals(response.sourceDisabled())
                || !Boolean.TRUE.equals(response.cachesInvalidated())
                || response.alreadyRevoked() == null
                || response.revokedAt() == null) {
            throw new ConnectorUnavailableException();
        }
        if (response.shopDomain() != null
                && (!response.shopDomain().equals(
                        response.shopDomain().strip().toLowerCase(Locale.ROOT))
                || !response.shopDomain().matches(
                        "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.myshopify\\.com$"))) {
            throw new ConnectorUnavailableException();
        }
    }

    private static boolean isLoopback(String host) {
        return "localhost".equalsIgnoreCase(host)
                || "127.0.0.1".equals(host)
                || "::1".equals(host)
                || "[::1]".equals(host);
    }

    private static String required(String value, String message) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(message);
        }
        return value.strip();
    }

    private static String nullable(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private static ConnectorMailingAddress connectorAddress(MailingAddress value) {
        return new ConnectorMailingAddress(
                value.name(), value.firstName(), value.lastName(),
                value.company(), value.address1(), value.address2(),
                value.city(), value.province(), value.provinceCode(),
                value.country(), value.countryCode(), value.zip(),
                value.phone(), value.formatted());
    }

    private static Instant parseInstant(String value) {
        return value == null || value.isBlank() ? null : Instant.parse(value);
    }

    private static Money money(ConnectorMoney value) {
        if (value == null) {
            return null;
        }
        return new Money(value.amount(), value.currencyCode());
    }

    private static MoneyBag moneyBag(ConnectorMoneyBag value) {
        if (value == null) {
            return null;
        }
        return new MoneyBag(money(value.shopMoney()), money(value.presentmentMoney()));
    }

    private static ConnectorContext connectorContext(UUID shopId) {
        return new ConnectorContext(
                "erp-" + shopId,
                "erp-" + UUID.randomUUID());
    }

    private static MailingAddress address(ConnectorMailingAddress value) {
        if (value == null) {
            return null;
        }
        return new MailingAddress(
                value.name(),
                value.firstName(),
                value.lastName(),
                value.company(),
                value.address1(),
                value.address2(),
                value.city(),
                value.province(),
                value.provinceCode(),
                value.country(),
                value.countryCode(),
                value.zip(),
                value.phone(),
                value.formatted());
    }

    private static Customer customer(ConnectorCustomer value) {
        if (value == null) {
            return null;
        }
        return new Customer(
                value.id(),
                value.displayName(),
                value.email(),
                value.phone(),
                parseInstant(value.createdAt()),
                money(value.totalSpent()));
    }

    private record ConnectorIdentity(String tenantId, String shopId) {
    }

    private record NativeLinkProofRequest(String proof) {
        @Override public String toString() { return "NativeLinkProofRequest[REDACTED]"; }
    }
    private record NativeLinkPreviewResponse(String contractVersion, NativeShopifyLinkPreview pending) { }
    private record NativeLinkConfirmRequest(ConnectorIdentity identity, ConnectorContext context,
            String legacyShopId, String shopDomain, String actorId, String proof) {
        @Override public String toString() { return "NativeLinkConfirmRequest[REDACTED]"; }
    }
    private record NativeLinkConfirmResponse(String contractVersion, NativeLinkInstallation installation) { }
    private record NativeLinkInstallation(String contractVersion, String tenantId, String shopId,
            String shopDomain, String shopName, String state, List<String> grantedScopes,
            Instant installedAt, Instant updatedAt) { }
    private record NativeLinkError(String code, String error, Boolean retryable) { }

    private record ConnectorContext(String correlationId, String requestId) {
    }

    private record ConnectorConnectionRequest(
            ConnectorIdentity identity,
            ConnectorContext context) {
    }

    private record ConnectorRequest(
            ConnectorIdentity identity,
            ConnectorContext context,
            int limit,
            String cursor,
            String query) {
    }

    private record ConnectorDisputeCatalogRequest(
            ConnectorIdentity identity,
            ConnectorContext context,
            int limit,
            String cursor) {
    }

    private record ConnectorOAuthStartRequest(
            ConnectorIdentity identity,
            ConnectorContext context,
            String legacyShopId,
            String shopDomain) {
    }

    private record ConnectorOAuthStartResponse(
            String contractVersion,
            String authorizationUrl) {
    }

    private record ConnectorUninstallResponse(
            String contractVersion,
            String tenantId,
            String shopId,
            String shopDomain,
            Boolean installationRevoked,
            Boolean sourceDisabled,
            Boolean cachesInvalidated,
            Boolean alreadyRevoked,
            Instant revokedAt) {
    }

    private record ConnectorInventoryLevelRequest(
            ConnectorIdentity identity,
            ConnectorContext context,
            String inventoryItemId,
            String locationId) {
    }

    private record ConnectorInventorySetRequest(
            ConnectorIdentity identity,
            ConnectorContext context,
            String inventoryItemId,
            String locationId,
            int expectedAvailable,
            int targetAvailable,
            String idempotencyKey,
            String referenceDocumentUri) {
    }

    private record ConnectorConnectionResponse(
            String contractVersion,
            String tenantId,
            String shopId,
            String state,
            List<String> grantedScopes,
            String shopName,
            String shopDomain,
            Instant checkedAt) {
    }

    private record ConnectorProductCatalogResponse(
            String contractVersion,
            String tenantId,
            String shopId,
            String state,
            ConnectorPageInfo pageInfo,
            Instant fetchedAt,
            List<ConnectorProduct> products) {
    }

    private record ConnectorLocationCatalogResponse(
            String contractVersion,
            String tenantId,
            String shopId,
            String state,
            ConnectorPageInfo pageInfo,
            Instant fetchedAt,
            List<ConnectorLocation> locations) {
    }

    private record ConnectorInventoryLevelResponse(
            String contractVersion,
            String tenantId,
            String shopId,
            String state,
            String inventoryItemId,
            String locationId,
            Boolean tracked,
            Boolean active,
            Integer availableQuantity,
            Integer onHandQuantity,
            Instant fetchedAt) {
    }

    private record ConnectorInventorySetResponse(
            String contractVersion,
            String tenantId,
            String shopId,
            String outcome,
            String inventoryItemId,
            String locationId,
            Integer expectedAvailable,
            Integer targetAvailable,
            String safeErrorCode,
            Instant updatedAt) {
    }

    private record ConnectorErrorResponse(
            String code,
            String message,
            Boolean retryable,
            String correlationId) {
    }

    private record ConnectorComplianceRequestListResponse(
            List<ConnectorComplianceRequest> requests) {
    }

    private record ConnectorComplianceRequest(
            String id,
            String kind,
            ConnectorIdentity identity,
            String shopDomain,
            String topic,
            List<String> referenceIds,
            Instant occurredAt) {
    }

    private record ConnectorComplianceCompletionRequest(
            String eventId,
            String outcome) {
    }

    private record ConnectorComplianceCompletionResponse(
            String eventId,
            String outcome,
            Instant completedAt,
            Boolean alreadyCompleted) {
    }

    private record ConnectorLocation(
            String id,
            String name,
            boolean isActive,
            boolean fulfillsOnlineOrders,
            boolean hasActiveInventory,
            boolean isFulfillmentService,
            String address1,
            String address2,
            String city,
            String province,
            String provinceCode,
            String country,
            String countryCode,
            String zip) {
    }

    private record ConnectorPageInfo(Boolean hasNextPage, String endCursor) {
    }

    private record ConnectorProduct(
            String id,
            String legacyResourceId,
            String title,
            String handle,
            String status,
            String vendor,
            String productType,
            String publishedAt,
            String updatedAt,
            List<ConnectorVariant> variants) {
    }

    private record ConnectorVariant(
            String id,
            String legacyResourceId,
            String inventoryItemId,
            String sku,
            String title,
            String barcode,
            String price,
            String currencyCode,
            boolean availableForSale,
            boolean inventoryTracked) {
    }

    private record ConnectorOrderCatalogResponse(
            String contractVersion,
            String tenantId,
            String shopId,
            String state,
            ConnectorPageInfo pageInfo,
            Instant fetchedAt,
            List<ConnectorOrder> orders) {
    }

    private record ConnectorCustomerCatalogResponse(
            String contractVersion,
            String tenantId,
            String shopId,
            String state,
            ConnectorPageInfo pageInfo,
            Instant fetchedAt,
            List<ConnectorCustomerProfile> customers) {
        ConnectorCustomerCatalogResponse {
            customers = customers == null ? null : List.copyOf(customers);
        }
    }

    private record ConnectorReturnCatalogResponse(
            String contractVersion,
            String tenantId,
            String shopId,
            String state,
            ConnectorPageInfo pageInfo,
            Instant fetchedAt,
            List<ConnectorReturn> returns) {
    }

    private record ConnectorReturn(
            String id,
            String name,
            String orderId,
            String orderName,
            String status,
            String createdAt,
            String closedAt,
            String requestApprovedAt,
            int totalQuantity,
            List<ConnectorReturnLine> lineItems) {
    }

    private record ConnectorReturnLine(
            String id,
            String fulfillmentLineId,
            String orderLineId,
            String name,
            String sku,
            int quantity,
            int processableQuantity,
            int processedQuantity,
            int refundableQuantity,
            int refundedQuantity,
            String reasonHandle,
            String reasonName) {
    }

    private record ConnectorReturnDecisionRequest(
            ConnectorIdentity identity,
            ConnectorContext context,
            String returnId,
            String decision,
            String declineReason,
            String declineNote,
            boolean notifyCustomer,
            String idempotencyKey) {
    }

    private record ConnectorReturnDecisionResponse(
            String contractVersion,
            String tenantId,
            String shopId,
            String returnId,
            String status,
            Boolean recoveredFromShopify,
            Instant updatedAt) {
    }

    private record ConnectorReturnRefundLineSelection(
            String returnLineId,
            int quantity) {
    }

    private record ConnectorReturnRefundDutySelection(
            String dutyId,
            String refundType) {
    }

    private record ConnectorReturnRefundPreviewRequest(
            ConnectorIdentity identity,
            ConnectorContext context,
            String returnId,
            List<ConnectorReturnRefundLineSelection> lineItems,
            boolean refundShipping,
            List<ConnectorReturnRefundDutySelection> refundDuties) {
    }

    private record ConnectorMoneyBag(
            ConnectorMoney shopMoney,
            ConnectorMoney presentmentMoney) {
    }

    private record ConnectorReturnRefundTransaction(
            String parentTransactionId,
            ConnectorMoneyBag amount,
            String gateway,
            String formattedGateway,
            String accountNumber) {
    }

    private record ConnectorReturnRefundPreviewResponse(
            String contractVersion,
            String tenantId,
            String shopId,
            String returnId,
            String state,
            List<ConnectorReturnRefundLineSelection> lineItems,
            boolean refundShipping,
            List<ConnectorReturnRefundDutySelection> refundDuties,
            ConnectorMoneyBag shippingAmount,
            ConnectorMoneyBag dutyAmount,
            ConnectorMoneyBag refundAmount,
            ConnectorMoneyBag maximumRefundable,
            List<ConnectorReturnRefundTransaction> transactions,
            String previewToken,
            Instant expiresAt,
            Instant fetchedAt) {
    }

    private record ConnectorReturnRefundProcessRequest(
            ConnectorIdentity identity,
            ConnectorContext context,
            String returnId,
            List<ConnectorReturnRefundLineSelection> lineItems,
            boolean refundShipping,
            List<ConnectorReturnRefundDutySelection> refundDuties,
            String previewToken,
            boolean notifyCustomer,
            String idempotencyKey) {
    }

    private record ConnectorReturnRefundProcessedTransaction(
            String id,
            String parentTransactionId,
            String status,
            ConnectorMoneyBag amount) {
    }

    private record ConnectorReturnRefundProcessResponse(
            String contractVersion,
            String tenantId,
            String shopId,
            String returnId,
            String returnStatus,
            String outcome,
            ConnectorMoneyBag refundAmount,
            List<ConnectorReturnRefundProcessedTransaction> transactions,
            Boolean recoveredFromShopify,
            Instant updatedAt) {
    }

    private record ConnectorOrderAddressRequest(
            ConnectorIdentity identity,
            ConnectorContext context,
            String orderId,
            String idempotencyKey,
            ConnectorMailingAddress address) {
    }

    private record ConnectorOrderAddressResponse(
            String contractVersion,
            String tenantId,
            String shopId,
            String orderId,
            ConnectorMailingAddress address,
            Instant updatedAt) {
    }

    private record ConnectorOrderEditQuantityRequest(
            ConnectorIdentity identity,
            ConnectorContext context,
            String orderId,
            String orderLineId,
            String variantId,
            int expectedQuantity,
            int quantity,
            boolean restock,
            boolean notifyCustomer,
            String idempotencyKey) {
    }

    private record ConnectorOrderEditQuantityResponse(
            String orderId,
            String orderLineId,
            int quantity,
            ConnectorMoney total,
            boolean recoveredFromShopify,
            Instant updatedAt) {
    }

    private record ConnectorOrderAddVariantRequest(
            ConnectorIdentity identity,
            ConnectorContext context,
            String orderId,
            String variantId,
            int quantity,
            boolean notifyCustomer,
            boolean recoverExisting,
            String idempotencyKey) {
    }

    private record ConnectorOrderAddVariantResponse(
            String orderId,
            String orderLineId,
            String variantId,
            int quantity,
            String sku,
            String title,
            String variantTitle,
            ConnectorMoney unitPrice,
            ConnectorMoney total,
            boolean recoveredFromShopify,
            Instant updatedAt) {
    }

    private record ConnectorOrderAddCustomItemRequest(
            ConnectorIdentity identity,
            ConnectorContext context,
            String orderId,
            String title,
            ConnectorMoney unitPrice,
            int quantity,
            boolean requiresShipping,
            boolean taxable,
            boolean notifyCustomer,
            boolean recoverExisting,
            String idempotencyKey) {
    }

    private record ConnectorOrderAddCustomItemResponse(
            String orderId,
            String orderLineId,
            String title,
            ConnectorMoney unitPrice,
            int quantity,
            ConnectorMoney total,
            boolean recoveredFromShopify,
            Instant updatedAt) {
    }

    private record ConnectorOrderLineDiscountRequest(
            ConnectorIdentity identity,
            ConnectorContext context,
            String orderId,
            String orderLineId,
            String variantId,
            int expectedQuantity,
            ConnectorMoney expectedDiscountTotal,
            String description,
            OrderLineDiscountType discountType,
            ConnectorMoney fixedValue,
            Integer percentBasisPoints,
            boolean notifyCustomer,
            boolean recoverExisting,
            String idempotencyKey) {
    }

    private record ConnectorOrderLineDiscountResponse(
            String orderId,
            String orderLineId,
            String description,
            OrderLineDiscountType discountType,
            ConnectorMoney fixedValue,
            Integer percentBasisPoints,
            ConnectorMoney discountTotal,
            ConnectorMoney total,
            boolean recoveredFromShopify,
            Instant updatedAt) {
    }

    private record ConnectorOrderCancellationRequest(
            ConnectorIdentity identity,
            ConnectorContext context,
            String orderId,
            OrderCancellationReason reason,
            String staffNote,
            boolean refundOriginalPaymentMethods,
            boolean restock,
            boolean notifyCustomer,
            boolean recoverExisting,
            String idempotencyKey) {
    }

    private record ConnectorOrderCancellationResponse(
            String orderId,
            OrderCancellationReason reason,
            Instant cancelledAt,
            String jobId,
            boolean recoveredFromShopify,
            Instant updatedAt) {
    }

    private record ConnectorFulfillmentPublishRequest(
            ConnectorIdentity identity,
            ConnectorContext context,
            String orderId,
            String idempotencyKey,
            boolean notifyCustomer,
            ConnectorTrackingInfo tracking,
            List<ConnectorFulfillmentLine> lines) {
        ConnectorFulfillmentPublishRequest {
            lines = List.copyOf(lines);
        }
    }

    private record ConnectorFulfillmentLine(
            String orderLineId,
            int quantity) {
    }

    private record ConnectorFulfillmentPublishResponse(
            String contractVersion,
            String tenantId,
            String shopId,
            String orderId,
            List<String> fulfillmentIds,
            ConnectorTrackingInfo tracking,
            Boolean recoveredFromShopify,
            Instant updatedAt) {
        ConnectorFulfillmentPublishResponse {
            fulfillmentIds = fulfillmentIds == null
                    ? List.of() : List.copyOf(fulfillmentIds);
        }
    }

    private record ConnectorDisputeCatalogResponse(
            String contractVersion,
            String tenantId,
            String shopId,
            String state,
            ConnectorPageInfo pageInfo,
            Instant fetchedAt,
            List<ConnectorDispute> disputes) {
    }

    private record ConnectorDispute(
            String id,
            String orderId,
            String orderName,
            String status,
            String type,
            String reason,
            String networkReasonCode,
            ConnectorMoney amount,
            String initiatedAt,
            String evidenceDueBy,
            String evidenceSentOn,
            String finalizedOn) {
    }

    private record ConnectorOrder(
            String id,
            String legacyResourceId,
            String name,
            String email,
            String sourceName,
            String createdAt,
            String updatedAt,
            String cancelledAt,
            String displayFinancialStatus,
            String displayFulfillmentStatus,
            List<String> paymentGatewayNames,
            ConnectorMoney total,
            ConnectorMoney subtotal,
            ConnectorMoney shipping,
            ConnectorMailingAddress shippingAddress,
            ConnectorCustomer customer,
            List<ConnectorLineItem> lineItems,
            List<ConnectorFulfillment> fulfillments) {
        ConnectorOrder {
            paymentGatewayNames = paymentGatewayNames == null
                    ? List.of() : List.copyOf(paymentGatewayNames);
        }
    }

    private record ConnectorMoney(String amount, String currencyCode) {
    }

    private record ConnectorMailingAddress(
            String name,
            String firstName,
            String lastName,
            String company,
            String address1,
            String address2,
            String city,
            String province,
            String provinceCode,
            String country,
            String countryCode,
            String zip,
            String phone,
            List<String> formatted) {
        ConnectorMailingAddress {
            formatted = formatted == null ? List.of() : List.copyOf(formatted);
        }
    }

    private record ConnectorCustomer(
            String id,
            String legacyResourceId,
            String displayName,
            String email,
            String phone,
            String createdAt,
            String updatedAt,
            boolean verifiedEmail,
            List<String> tags,
            String numberOfOrders,
            ConnectorMoney totalSpent,
            ConnectorCustomerLocation defaultLocation,
            ConnectorCustomerOrderSummary lastOrder) {
    }

    private record ConnectorCustomerProfile(
            String id,
            String legacyResourceId,
            String displayName,
            String email,
            String phone,
            String createdAt,
            String updatedAt,
            boolean verifiedEmail,
            List<String> tags,
            String numberOfOrders,
            ConnectorMoney totalSpent,
            ConnectorCustomerLocation defaultLocation,
            ConnectorCustomerOrderSummary lastOrder) {
        ConnectorCustomerProfile {
            tags = tags == null ? null : List.copyOf(tags);
        }
    }

    private record ConnectorCustomerLocation(
            String city,
            String province,
            String country,
            String countryCode) {
    }

    private record ConnectorCustomerOrderSummary(
            String id,
            String name,
            String createdAt,
            String displayFinancialStatus,
            String displayFulfillmentStatus,
            ConnectorMoney total) {
    }

    private record ConnectorLineItem(
            String id,
            String legacyResourceId,
            String productId,
            String variantId,
            String inventoryItemId,
            String name,
            String title,
            int quantity,
            String sku,
            String variantTitle,
            boolean requiresShipping,
            ConnectorMoney discountedTotal,
            ConnectorMoney originalUnitPrice) {
    }

    private record ConnectorFulfillment(
            String id,
            String status,
            String createdAt,
            String updatedAt,
            List<ConnectorTrackingInfo> trackingInfo) {
        ConnectorFulfillment {
            trackingInfo = trackingInfo == null ? List.of() : List.copyOf(trackingInfo);
        }
    }

    private record ConnectorTrackingInfo(String company, String number, String url) {
    }
}
