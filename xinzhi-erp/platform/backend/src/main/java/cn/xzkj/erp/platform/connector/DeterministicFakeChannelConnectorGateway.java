package cn.xzkj.erp.platform.connector;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "erp.channel-connector.mode", havingValue = "deterministic-fake")
public class DeterministicFakeChannelConnectorGateway implements ChannelConnectorGateway {

    private static final int MAX_ACTIVITY = 25;

    private final Map<ShopKey, FakeState> states = new ConcurrentHashMap<>();
    private final Clock clock;

    public DeterministicFakeChannelConnectorGateway() {
        this(Clock.systemUTC());
    }

    DeterministicFakeChannelConnectorGateway(Clock clock) {
        this.clock = clock;
    }

    @Override
    public ChannelSnapshot snapshot(UUID tenantId, UUID shopId) {
        return state(tenantId, shopId).snapshot();
    }

    @Override
    public ChannelSnapshot authorizeShopify(UUID tenantId, UUID shopId) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            Instant now = clock.instant();
            state.shopify = failed(now);
            state.addActivity("shopify.authorize", "SHOPIFY", ConnectionStatus.FAILED,
                    "授权请求暂时失败，请稍后重试。", now);
            return state.snapshot();
        }
    }

    @Override
    public ChannelSnapshot retryShopify(UUID tenantId, UUID shopId) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            Instant now = clock.instant();
            state.shopify = connected(now);
            state.addActivity("shopify.retry", "SHOPIFY", ConnectionStatus.CONNECTED,
                    "连接已恢复。", now);
            return state.snapshot();
        }
    }

    @Override
    public ChannelSnapshot uninstallShopify(UUID tenantId, UUID shopId) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            Instant now = clock.instant();
            state.shopify = new Connection(ConnectionStatus.REVOKED, null, null, now);
            state.addActivity("shopify.revoke", "SHOPIFY", ConnectionStatus.REVOKED,
                    "授权已撤销。", now);
            return state.snapshot();
        }
    }

    @Override
    public ProductCatalogPage fetchShopifyProductCatalog(
            UUID tenantId,
            UUID shopId,
            ProductCatalogRequest request) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            ConnectionStatus status = state.shopify.status();
            if (status != ConnectionStatus.CONNECTED) {
                return new ProductCatalogPage(
                        ConnectorMode.DETERMINISTIC_FAKE,
                        status,
                        null,
                        false,
                        clock.instant(),
                        List.of());
            }
            String query = request == null ? "" : nullable(request.query());
            List<ProductCatalogProduct> products = deterministicProducts(clock.instant());
            if (query != null) {
                String needle = query.toLowerCase(Locale.ROOT);
                products = products.stream()
                        .filter(product -> product.title().toLowerCase(Locale.ROOT).contains(needle)
                                || product.variants().stream().anyMatch(variant ->
                                        variant.sku().toLowerCase(Locale.ROOT).contains(needle)))
                        .toList();
            }
            int limit = request == null ? 50 : request.limit();
            if (limit < 1 || limit > 100) {
                throw new IllegalArgumentException("Catalog limit must be between 1 and 100");
            }
            return new ProductCatalogPage(
                    ConnectorMode.DETERMINISTIC_FAKE,
                    ConnectionStatus.CONNECTED,
                    null,
                    false,
                    clock.instant(),
                    products.stream().limit(limit).toList());
        }
    }

    @Override
    public LocationCatalogPage fetchShopifyLocationCatalog(
            UUID tenantId,
            UUID shopId,
            LocationCatalogRequest request) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            ConnectionStatus status = state.shopify.status();
            if (status != ConnectionStatus.CONNECTED) {
                return new LocationCatalogPage(
                        ConnectorMode.DETERMINISTIC_FAKE, status, null,
                        false, clock.instant(), List.of());
            }
            int limit = request == null ? 50 : request.limit();
            if (limit < 1 || limit > 100) {
                throw new IllegalArgumentException(
                        "Location catalog limit must be between 1 and 100");
            }
            return new LocationCatalogPage(
                    ConnectorMode.DETERMINISTIC_FAKE,
                    ConnectionStatus.CONNECTED,
                    null,
                    false,
                    clock.instant(),
                    List.of(new LocationCatalogLocation(
                            "gid://shopify/Location/1001",
                            "Shopify main location",
                            true,
                            true,
                            true,
                            false,
                            "1 Test Street",
                            null,
                            "Toronto",
                            "Ontario",
                            "ON",
                            "Canada",
                            "CA",
                            "M1M 1M1")));
        }
    }

    @Override
    public InventoryLevelSnapshot fetchShopifyInventoryLevel(
            UUID tenantId,
            UUID shopId,
            InventoryLevelRequest request) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            ConnectionStatus status = state.shopify.status();
            if (status != ConnectionStatus.CONNECTED) {
                return new InventoryLevelSnapshot(
                        ConnectorMode.DETERMINISTIC_FAKE, status,
                        request.externalInventoryItemRef(),
                        request.externalLocationRef(), false, false,
                        0, null, clock.instant());
            }
            return new InventoryLevelSnapshot(
                    ConnectorMode.DETERMINISTIC_FAKE,
                    ConnectionStatus.CONNECTED,
                    request.externalInventoryItemRef(),
                    request.externalLocationRef(), true, true,
                    25, 30, clock.instant());
        }
    }

    @Override
    public InventorySetResult setShopifyInventoryAvailable(
            UUID tenantId,
            UUID shopId,
            InventorySetRequest request) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            if (state.shopify.status() != ConnectionStatus.CONNECTED) {
                throw new ConnectorUnavailableException();
            }
            InventorySetOutcome outcome = request.expectedAvailable() == 25
                    ? InventorySetOutcome.APPLIED
                    : InventorySetOutcome.STALE;
            return new InventorySetResult(
                    outcome,
                    request.externalInventoryItemRef(),
                    request.externalLocationRef(),
                    request.expectedAvailable(),
                    request.targetAvailable(),
                    outcome == InventorySetOutcome.STALE
                            ? "SHOPIFY_INVENTORY_STALE" : null,
                    clock.instant());
        }
    }

    @Override
    public OrderCatalogPage fetchShopifyOrderCatalog(
            UUID tenantId,
            UUID shopId,
            OrderCatalogRequest request) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            ConnectionStatus status = state.shopify.status();
            if (status != ConnectionStatus.CONNECTED) {
                return new OrderCatalogPage(
                        ConnectorMode.DETERMINISTIC_FAKE,
                        status,
                        null,
                        false,
                        clock.instant(),
                        List.of());
            }
            String query = request == null ? "" : nullable(request.query());
            List<OrderCatalogOrder> orders = deterministicOrders(clock.instant());
            if (query != null) {
                String needle = query.toLowerCase(Locale.ROOT);
                orders = orders.stream()
                        .filter(order -> order.name().toLowerCase(Locale.ROOT).contains(needle)
                                || order.lineItems().stream().anyMatch(line ->
                                        line.sku().toLowerCase(Locale.ROOT).contains(needle)))
                        .toList();
            }
            int limit = request == null ? 50 : request.limit();
            if (limit < 1 || limit > 100) {
                throw new IllegalArgumentException("Order limit must be between 1 and 100");
            }
            return new OrderCatalogPage(
                    ConnectorMode.DETERMINISTIC_FAKE,
                    ConnectionStatus.CONNECTED,
                    null,
                    false,
                    clock.instant(),
                    orders.stream().limit(limit).toList());
        }
    }

    @Override
    public CustomerCatalogPage fetchShopifyCustomerCatalog(
            UUID tenantId,
            UUID shopId,
            CustomerCatalogRequest request) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            ConnectionStatus status = state.shopify.status();
            if (status != ConnectionStatus.CONNECTED) {
                return new CustomerCatalogPage(
                        ConnectorMode.DETERMINISTIC_FAKE, status, null,
                        false, clock.instant(), List.of());
            }
            int limit = request == null ? 50 : request.limit();
            if (limit < 1 || limit > 100) {
                throw new IllegalArgumentException(
                        "Customer limit must be between 1 and 100");
            }
            Instant now = clock.instant();
            List<CustomerProfile> customers = List.of(new CustomerProfile(
                    "gid://shopify/Customer/6001", "6001", "Customer",
                    "customer@example.test", "+10000000000",
                    now.minusSeconds(86_400), now, true, List.of("VIP"), "2",
                    new Money("178.00", "USD"),
                    new CustomerLocation("New York", "New York", "United States", "US"),
                    new CustomerOrderSummary(
                            "gid://shopify/Order/5001", "#1001",
                            now.minusSeconds(3_600), "PAID", "UNFULFILLED",
                            new Money("78.00", "USD"))));
            String query = request == null ? null : nullable(request.query());
            if (query != null) {
                String needle = query.toLowerCase(Locale.ROOT);
                customers = customers.stream().filter(customer ->
                        customer.displayName().toLowerCase(Locale.ROOT).contains(needle)
                                || customer.email().toLowerCase(Locale.ROOT).contains(needle)
                                || customer.phone().toLowerCase(Locale.ROOT).contains(needle))
                        .toList();
            }
            return new CustomerCatalogPage(
                    ConnectorMode.DETERMINISTIC_FAKE,
                    ConnectionStatus.CONNECTED,
                    null,
                    false,
                    now,
                    customers.stream().limit(limit).toList());
        }
    }

    @Override
    public OrderShippingAddressUpdateResult updateShopifyOrderShippingAddress(
            UUID tenantId,
            UUID shopId,
            OrderShippingAddressUpdateRequest request) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            if (state.shopify.status() != ConnectionStatus.CONNECTED) {
                throw new ConnectorUnavailableException();
            }
            if (request == null || request.address() == null
                    || request.externalOrderRef() == null
                    || request.idempotencyKey() == null) {
                throw new IllegalArgumentException(
                        "Order shipping address command is required");
            }
            return new OrderShippingAddressUpdateResult(
                    request.address(), clock.instant());
        }
    }

    @Override
    public OrderEditQuantityResult updateShopifyOrderLineQuantity(
            UUID tenantId,
            UUID shopId,
            OrderEditQuantityRequest request) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            if (state.shopify.status() != ConnectionStatus.CONNECTED) {
                throw new ConnectorUnavailableException();
            }
            if (request == null || request.externalOrderRef() == null
                    || request.externalOrderLineRef() == null
                    || request.externalVariantRef() == null
                    || request.idempotencyKey() == null) {
                throw new IllegalArgumentException(
                        "Order line quantity command is required");
            }
            return new OrderEditQuantityResult(
                    request.externalOrderRef(),
                    request.externalOrderLineRef(),
                    request.quantity(), new Money("49.95", "USD"),
                    false, clock.instant());
        }
    }

    @Override
    public OrderAddVariantResult addShopifyOrderVariant(
            UUID tenantId,
            UUID shopId,
            OrderAddVariantRequest request) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            if (state.shopify.status() != ConnectionStatus.CONNECTED) {
                throw new ConnectorUnavailableException();
            }
            if (request == null || request.externalOrderRef() == null
                    || request.externalVariantRef() == null
                    || request.idempotencyKey() == null
                    || request.quantity() < 1) {
                throw new IllegalArgumentException(
                        "Order variant command is required");
            }
            String lineRef = "gid://shopify/LineItem/"
                    + Integer.toUnsignedLong(
                            request.idempotencyKey().hashCode());
            return new OrderAddVariantResult(
                    request.externalOrderRef(), lineRef,
                    request.externalVariantRef(), request.quantity(),
                    "FAKE-SKU", "Fake Shopify product", "Default",
                    new Money("25.00", "USD"),
                    new Money("125.00", "USD"),
                    request.recoverExisting(), clock.instant());
        }
    }

    @Override
    public OrderAddCustomItemResult addShopifyOrderCustomItem(
            UUID tenantId,
            UUID shopId,
            OrderAddCustomItemRequest request) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            if (state.shopify.status() != ConnectionStatus.CONNECTED) {
                throw new ConnectorUnavailableException();
            }
            if (request == null || request.externalOrderRef() == null
                    || request.title() == null || request.unitPrice() == null
                    || request.idempotencyKey() == null
                    || request.quantity() < 1) {
                throw new IllegalArgumentException(
                        "Custom order item command is required");
            }
            String lineRef = "gid://shopify/LineItem/"
                    + Integer.toUnsignedLong(
                            request.idempotencyKey().hashCode());
            return new OrderAddCustomItemResult(
                    request.externalOrderRef(), lineRef, request.title(),
                    request.unitPrice(), request.quantity(),
                    new Money("125.00", request.unitPrice().currencyCode()),
                    request.recoverExisting(), clock.instant());
        }
    }

    @Override
    public OrderLineDiscountResult addShopifyOrderLineDiscount(
            UUID tenantId,
            UUID shopId,
            OrderLineDiscountRequest request) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            if (state.shopify.status() != ConnectionStatus.CONNECTED) {
                throw new ConnectorUnavailableException();
            }
            if (request == null || request.externalOrderRef() == null
                    || request.externalOrderLineRef() == null
                    || request.description() == null
                    || request.expectedDiscountTotal() == null
                    || request.discountType() == null) {
                throw new IllegalArgumentException(
                        "Order line discount command is required");
            }
            BigDecimal added = request.discountType()
                    == OrderLineDiscountType.FIXED
                    ? new BigDecimal(request.fixedValue().amount())
                    : new BigDecimal("1.00");
            BigDecimal discountTotal = new BigDecimal(
                    request.expectedDiscountTotal().amount()).add(added);
            return new OrderLineDiscountResult(
                    request.externalOrderRef(),
                    request.externalOrderLineRef(), request.description(),
                    request.discountType(), request.fixedValue(),
                    request.percentBasisPoints(),
                    new Money(discountTotal.toPlainString(),
                            request.expectedDiscountTotal().currencyCode()),
                    new Money("124.00",
                            request.expectedDiscountTotal().currencyCode()),
                    request.recoverExisting(), clock.instant());
        }
    }

    @Override
    public OrderCancellationResult cancelShopifyOrder(
            UUID tenantId, UUID shopId, OrderCancellationRequest request) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            if (state.shopify.status() != ConnectionStatus.CONNECTED) {
                throw new ConnectorUnavailableException();
            }
            if (request == null || request.reason() == null
                    || request.externalOrderRef() == null) {
                throw new IllegalArgumentException(
                        "Order cancellation command is required");
            }
            Instant now = clock.instant();
            return new OrderCancellationResult(
                    request.externalOrderRef(), request.reason(), now,
                    "gid://shopify/Job/fake", request.recoverExisting(), now);
        }
    }

    @Override
    public FulfillmentPublishResult publishShopifyFulfillment(
            UUID tenantId,
            UUID shopId,
            FulfillmentPublishRequest request) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            if (state.shopify.status() != ConnectionStatus.CONNECTED) {
                throw new ConnectorUnavailableException();
            }
            if (request == null || request.tracking() == null
                    || request.lines() == null || request.lines().isEmpty()) {
                throw new IllegalArgumentException(
                        "Fulfillment publish command is required");
            }
            return new FulfillmentPublishResult(
                    List.of("gid://shopify/Fulfillment/9001"),
                    request.tracking(), false, clock.instant());
        }
    }

    @Override
    public DisputeCatalogPage fetchShopifyDisputes(
            UUID tenantId,
            UUID shopId,
            DisputeCatalogRequest request) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            if (state.shopify.status() != ConnectionStatus.CONNECTED) {
                return new DisputeCatalogPage(
                        ConnectorMode.DETERMINISTIC_FAKE,
                        state.shopify.status(), null, false,
                        clock.instant(), List.of());
            }
            int limit = request == null ? 50 : request.limit();
            if (limit < 1 || limit > 100) {
                throw new IllegalArgumentException(
                        "Dispute limit must be between 1 and 100");
            }
            Instant now = clock.instant();
            var dispute = new Dispute(
                    "gid://shopify/ShopifyPaymentsDispute/9101",
                    "gid://shopify/Order/5001",
                    "#ORDER-1001",
                    "NEEDS_RESPONSE",
                    "CHARGEBACK",
                    "PRODUCT_NOT_RECEIVED",
                    "13.1",
                    new Money("78.00", "USD"),
                    now.minusSeconds(86_400),
                    now.plusSeconds(5 * 86_400),
                    null, null);
            return new DisputeCatalogPage(
                    ConnectorMode.DETERMINISTIC_FAKE,
                    ConnectionStatus.CONNECTED,
                    null, false, now,
                    limit == 0 ? List.of() : List.of(dispute));
        }
    }

    @Override
    public ReturnCatalogPage fetchShopifyReturnCatalog(
            UUID tenantId,
            UUID shopId,
            ReturnCatalogRequest request) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            if (state.shopify.status() != ConnectionStatus.CONNECTED) {
                return new ReturnCatalogPage(
                        ConnectorMode.DETERMINISTIC_FAKE,
                        state.shopify.status(), null, false,
                        clock.instant(), List.of());
            }
            int limit = request == null ? 50 : request.limit();
            if (limit < 1 || limit > 100) {
                throw new IllegalArgumentException(
                        "Return limit must be between 1 and 100");
            }
            Instant now = clock.instant();
            var line = new ShopifyReturnLine(
                    "gid://shopify/ReturnLineItem/9301",
                    "gid://shopify/FulfillmentLineItem/9302",
                    "gid://shopify/LineItem/9303",
                    "商品 1", "SKU-001", 1,
                    1, 0, 1, 0,
                    "unknown", "Unknown");
            var item = new ShopifyReturn(
                    "gid://shopify/Return/9401", "#RETURN-1001",
                    "gid://shopify/Order/5001", "#ORDER-1001",
                    "OPEN", now.minusSeconds(3_600), null, now, 1,
                    List.of(line));
            return new ReturnCatalogPage(
                    ConnectorMode.DETERMINISTIC_FAKE,
                    ConnectionStatus.CONNECTED,
                    null, false, now, List.of(item));
        }
    }

    @Override
    public ReturnDecisionResult decideShopifyReturn(
            UUID tenantId, UUID shopId, ReturnDecisionRequest request) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            if (state.shopify.status() != ConnectionStatus.CONNECTED || request == null) {
                throw new ConnectorUnavailableException();
            }
            return new ReturnDecisionResult(
                    request.externalReturnRef(),
                    request.decision() == ReturnDecision.APPROVE ? "OPEN" : "DECLINED",
                    false, clock.instant());
        }
    }

    @Override
    public ReturnRefundPreview previewShopifyReturnRefund(
            UUID tenantId, UUID shopId, ReturnRefundPreviewRequest request) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            if (state.shopify.status() != ConnectionStatus.CONNECTED || request == null) {
                throw new ConnectorUnavailableException();
            }
            MoneyBag amount = new MoneyBag(
                    new Money("10.00", "USD"), new Money("10.00", "USD"));
            return new ReturnRefundPreview(
                    request.externalReturnRef(), ReturnRefundPreviewState.REFUNDABLE,
                    request.lineItems(), request.refundShipping(), request.refundDuties(),
                    null, null, amount, amount, List.of(),
                    "fake-preview-token", clock.instant().plusSeconds(300), clock.instant());
        }
    }

    @Override
    public ReturnRefundProcessResult processShopifyReturnRefund(
            UUID tenantId, UUID shopId, ReturnRefundProcessRequest request) {
        FakeState state = state(tenantId, shopId);
        synchronized (state) {
            if (state.shopify.status() != ConnectionStatus.CONNECTED || request == null) {
                throw new ConnectorUnavailableException();
            }
            MoneyBag amount = new MoneyBag(
                    new Money("10.00", "USD"), new Money("10.00", "USD"));
            return new ReturnRefundProcessResult(
                    request.externalReturnRef(), "CLOSED",
                    ReturnRefundProcessOutcome.APPLIED, amount, List.of(),
                    false, clock.instant());
        }
    }

    @Override
    public List<ShopifyComplianceRequest> listShopifyComplianceRequests() {
        throw new ConnectorUnavailableException();
    }

    @Override
    public ShopifyComplianceCompletion completeShopifyComplianceRequest(
            String eventId,
            ShopifyComplianceOutcome outcome) {
        throw new ConnectorUnavailableException();
    }

    private FakeState state(UUID tenantId, UUID shopId) {
        return states.computeIfAbsent(new ShopKey(tenantId, shopId), ignored -> new FakeState());
    }

    private static Connection failed(Instant now) {
        return new Connection(
                ConnectionStatus.FAILED,
                "CONNECTION_TIMEOUT",
                "授权请求超时，请稍后重试。",
                now);
    }

    private static Connection connected(Instant now) {
        return new Connection(ConnectionStatus.CONNECTED, null, null, now);
    }

    private static List<ProductCatalogProduct> deterministicProducts(Instant now) {
        return List.of(
                new ProductCatalogProduct(
                        "gid://shopify/Product/1001",
                        "商品 1",
                        "product-001",
                        "ACTIVE",
                        now,
                        List.of(new ProductCatalogVariant(
                                "gid://shopify/ProductVariant/2001",
                                "gid://shopify/InventoryItem/3001",
                                "SKU-001",
                                "Default",
                                "60.00",
                                "USD",
                                true,
                                true))),
                new ProductCatalogProduct(
                        "gid://shopify/Product/1002",
                        "商品 2",
                        "product-002",
                        "DRAFT",
                        now,
                        List.of(new ProductCatalogVariant(
                                "gid://shopify/ProductVariant/2002",
                                "gid://shopify/InventoryItem/3002",
                                "SKU-002",
                                "Default",
                                "18.00",
                        "USD",
                        false,
                        true))));
    }

    private static List<OrderCatalogOrder> deterministicOrders(Instant now) {
        return List.of(new OrderCatalogOrder(
                "gid://shopify/Order/5001",
                "5001",
                "#1001",
                "customer@example.test",
                "web",
                now.minusSeconds(3_600),
                now,
                null,
                "PAID",
                "UNFULFILLED",
                List.of("shopify_payments"),
                new Money("78.00", "USD"),
                new Money("70.00", "USD"),
                new Money("8.00", "USD"),
                new MailingAddress(
                        "Customer",
                        "Customer",
                        "Customer",
                        null,
                        "1 Main St",
                        null,
                        "New York",
                        "New York",
                        "NY",
                        "United States",
                        "US",
                        "10001",
                        "+10000000000",
                        List.of("1 Main St", "New York NY 10001")),
                new Customer(
                        "gid://shopify/Customer/6001",
                        "Customer",
                        "customer@example.test",
                        "+10000000000",
                        now.minusSeconds(86_400),
                        new Money("178.00", "USD")),
                List.of(new OrderCatalogLine(
                        "gid://shopify/LineItem/7001",
                        "gid://shopify/Product/1001",
                        "gid://shopify/ProductVariant/2001",
                        "gid://shopify/InventoryItem/3001",
                        "商品 1 - 默认",
                        "商品 1",
                        1,
                        "SKU-001",
                        "Default",
                        true,
                        new Money("70.00", "USD"),
                        new Money("70.00", "USD"))),
                List.of()));
    }

    private static String nullable(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private record ShopKey(UUID tenantId, UUID shopId) {
    }

    private static final class FakeState {
        private Connection shopify =
                new Connection(ConnectionStatus.NOT_CONNECTED, null, null, null);
        private final List<ChannelActivity> activity = new ArrayList<>();

        private void addActivity(
                String action,
                String target,
                ConnectionStatus result,
                String summary,
                Instant now) {
            UUID id = UUID.nameUUIDFromBytes(
                    (action + ":" + target + ":" + result + ":" + now + ":" + activity.size())
                            .getBytes(StandardCharsets.UTF_8));
            activity.add(new ChannelActivity(id, action, target, result, summary, now));
            if (activity.size() > MAX_ACTIVITY) {
                activity.remove(0);
            }
        }

        private synchronized ChannelSnapshot snapshot() {
            List<ChannelActivity> activitySnapshot = activity.reversed().stream().toList();
            return new ChannelSnapshot(
                    ConnectorMode.DETERMINISTIC_FAKE,
                    shopify,
                    ChannelConnectorGateway.plannedShopifyScopes(List.of()),
                    activitySnapshot);
        }
    }
}
