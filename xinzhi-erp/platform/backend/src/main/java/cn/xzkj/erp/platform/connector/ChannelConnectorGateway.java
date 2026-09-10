package cn.xzkj.erp.platform.connector;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

public interface ChannelConnectorGateway {

    Map<String, String> SHOPIFY_READ_SCOPE_IMPLIED_BY_WRITE = Map.ofEntries(
            Map.entry("read_products", "write_products"),
            Map.entry("read_publications", "write_publications"),
            Map.entry("read_inventory", "write_inventory"),
            Map.entry("read_orders", "write_orders"),
            Map.entry("read_draft_orders", "write_draft_orders"),
            Map.entry("read_order_edits", "write_order_edits"),
            Map.entry("read_merchant_managed_fulfillment_orders",
                    "write_merchant_managed_fulfillment_orders"),
            Map.entry("read_shipping", "write_shipping"),
            Map.entry("read_returns", "write_returns"),
            Map.entry("read_customers", "write_customers"),
            Map.entry("read_discounts", "write_discounts"),
            Map.entry("read_price_rules", "write_price_rules"),
            Map.entry("read_themes", "write_themes"));

    ChannelSnapshot snapshot(UUID tenantId, UUID shopId);

    default NativeShopifyLinkPreview previewNativeShopifyLink(String proof) {
        throw new ConnectorUnavailableException();
    }

    default ChannelSnapshot confirmNativeShopifyLink(
            UUID tenantId, UUID shopId, UUID actorId, String shopDomain, String proof) {
        throw new ConnectorUnavailableException();
    }

    record NativeShopifyLinkPreview(
            String shopDomain, String shopName, List<String> grantedScopes, Instant expiresAt) {
        public NativeShopifyLinkPreview { grantedScopes = List.copyOf(grantedScopes); }
    }

    ChannelSnapshot authorizeShopify(UUID tenantId, UUID shopId);

    default ShopifyAuthorizationStart startShopifyAuthorization(
            UUID tenantId,
            UUID shopId,
            String shopDomain) {
        return new ShopifyAuthorizationStart(
                authorizeShopify(tenantId, shopId),
                null);
    }

    ChannelSnapshot retryShopify(UUID tenantId, UUID shopId);

    ChannelSnapshot uninstallShopify(UUID tenantId, UUID shopId);

    ProductCatalogPage fetchShopifyProductCatalog(
            UUID tenantId,
            UUID shopId,
            ProductCatalogRequest request);

    LocationCatalogPage fetchShopifyLocationCatalog(
            UUID tenantId,
            UUID shopId,
            LocationCatalogRequest request);

    InventoryLevelSnapshot fetchShopifyInventoryLevel(
            UUID tenantId,
            UUID shopId,
            InventoryLevelRequest request);

    InventorySetResult setShopifyInventoryAvailable(
            UUID tenantId,
            UUID shopId,
            InventorySetRequest request);

    OrderCatalogPage fetchShopifyOrderCatalog(
            UUID tenantId,
            UUID shopId,
            OrderCatalogRequest request);

    CustomerCatalogPage fetchShopifyCustomerCatalog(
            UUID tenantId,
            UUID shopId,
            CustomerCatalogRequest request);

    ReturnCatalogPage fetchShopifyReturnCatalog(
            UUID tenantId,
            UUID shopId,
            ReturnCatalogRequest request);

    ReturnDecisionResult decideShopifyReturn(
            UUID tenantId,
            UUID shopId,
            ReturnDecisionRequest request);

    ReturnRefundPreview previewShopifyReturnRefund(
            UUID tenantId,
            UUID shopId,
            ReturnRefundPreviewRequest request);

    ReturnRefundProcessResult processShopifyReturnRefund(
            UUID tenantId,
            UUID shopId,
            ReturnRefundProcessRequest request);

    OrderShippingAddressUpdateResult updateShopifyOrderShippingAddress(
            UUID tenantId,
            UUID shopId,
            OrderShippingAddressUpdateRequest request);

    OrderEditQuantityResult updateShopifyOrderLineQuantity(
            UUID tenantId,
            UUID shopId,
            OrderEditQuantityRequest request);

    OrderAddVariantResult addShopifyOrderVariant(
            UUID tenantId,
            UUID shopId,
            OrderAddVariantRequest request);

    OrderAddCustomItemResult addShopifyOrderCustomItem(
            UUID tenantId,
            UUID shopId,
            OrderAddCustomItemRequest request);

    OrderLineDiscountResult addShopifyOrderLineDiscount(
            UUID tenantId,
            UUID shopId,
            OrderLineDiscountRequest request);

    OrderCancellationResult cancelShopifyOrder(
            UUID tenantId,
            UUID shopId,
            OrderCancellationRequest request);

    FulfillmentPublishResult publishShopifyFulfillment(
            UUID tenantId,
            UUID shopId,
            FulfillmentPublishRequest request);

    DisputeCatalogPage fetchShopifyDisputes(
            UUID tenantId,
            UUID shopId,
            DisputeCatalogRequest request);

    List<ShopifyComplianceRequest> listShopifyComplianceRequests();

    ShopifyComplianceCompletion completeShopifyComplianceRequest(
            String eventId,
            ShopifyComplianceOutcome outcome);

    enum ConnectorMode {
        UNCONFIGURED,
        DETERMINISTIC_FAKE,
        XZ_ERP_APP,
        CUSTOMER_SERVICE_STORE_APP_READ_ONLY
    }

    enum ConnectionStatus {
        NOT_CONNECTED,
        PENDING,
        CONNECTED,
        FAILED,
        REVOKED
    }

    enum ShopifyScopeCoverageStatus {
        REQUESTED,
        GRANTED,
        MISSING
    }

    enum ShopifyComplianceTopic {
        CUSTOMER_DATA_REQUEST,
        CUSTOMER_REDACT,
        SHOP_REDACT
    }

    enum ShopifyComplianceOutcome {
        EXPORTED,
        ANONYMIZED,
        DELETED,
        NOT_FOUND
    }

    record ShopifyComplianceRequest(
            String eventId,
            UUID tenantId,
            UUID shopId,
            String shopDomain,
            ShopifyComplianceTopic topic,
            List<String> referenceIds,
            Instant occurredAt) {
        public ShopifyComplianceRequest {
            referenceIds = referenceIds == null
                    ? List.of() : List.copyOf(referenceIds);
        }
    }

    record ShopifyComplianceCompletion(
            String eventId,
            ShopifyComplianceOutcome outcome,
            Instant completedAt,
            boolean alreadyCompleted) {
    }

    record Connection(
            ConnectionStatus status,
            String safeErrorCode,
            String safeErrorSummary,
            Instant updatedAt,
            String shopName,
            String shopDomain
    ) {
        public Connection(
                ConnectionStatus status,
                String safeErrorCode,
                String safeErrorSummary,
                Instant updatedAt) {
            this(status, safeErrorCode, safeErrorSummary, updatedAt, null, null);
        }
    }

    record ChannelActivity(
            UUID id,
            String action,
            String target,
            ConnectionStatus result,
            String safeSummary,
            Instant createdAt
    ) {
    }

    record ChannelSnapshot(
            ConnectorMode mode,
            Connection shopify,
            List<ShopifyPermissionScope> shopifyScopes,
            List<ChannelActivity> activity
    ) {
        public ChannelSnapshot {
            shopifyScopes = shopifyScopes == null
                    ? List.of()
                    : List.copyOf(shopifyScopes);
            activity = activity == null ? List.of() : List.copyOf(activity);
        }
    }

    record ShopifyAuthorizationStart(
            ChannelSnapshot snapshot,
            String authorizationUrl
    ) {
        public ShopifyAuthorizationStart {
            if (snapshot == null) {
                throw new IllegalArgumentException(
                        "Shopify authorization snapshot is required");
            }
            authorizationUrl = authorizationUrl == null
                    || authorizationUrl.isBlank()
                            ? null
                            : authorizationUrl.strip();
        }
    }

    record ShopifyPermissionScope(
            String scope,
            String purpose,
            ShopifyScopeCoverageStatus status
    ) {
    }

    static List<ShopifyPermissionScope> plannedShopifyScopes(List<String> grantedScopes) {
        return plannedShopifyScopes(grantedScopes, false);
    }

    static List<ShopifyPermissionScope> plannedShopifyScopes(
            List<String> grantedScopes,
            boolean authoritativeGrantList) {
        Set<String> granted = grantedScopes == null
                ? Set.of()
                : grantedScopes.stream()
                        .map(scope -> scope == null
                                ? ""
                                : scope.strip().toLowerCase(Locale.ROOT))
                        .filter(scope -> !scope.isBlank())
                        .collect(Collectors.toUnmodifiableSet());
        return SHOPIFY_SCOPE_PLAN.stream()
                .map(item -> new ShopifyPermissionScope(
                        item.scope(),
                        item.purpose(),
                        granted.isEmpty()
                                ? authoritativeGrantList
                                        ? ShopifyScopeCoverageStatus.MISSING
                                        : ShopifyScopeCoverageStatus.REQUESTED
                                : scopeGranted(granted, item.scope())
                                        ? ShopifyScopeCoverageStatus.GRANTED
                                        : ShopifyScopeCoverageStatus.MISSING))
                .toList();
    }

    static ShopifyScopeCoverageStatus shopifyScopeCoverage(
            List<ShopifyPermissionScope> scopes,
            String requiredScope) {
        if (scopes == null || requiredScope == null
                || requiredScope.isBlank()) {
            return null;
        }
        String normalized = requiredScope.strip().toLowerCase(Locale.ROOT);
        String impliedBy = SHOPIFY_READ_SCOPE_IMPLIED_BY_WRITE.get(normalized);
        ShopifyScopeCoverageStatus fallback = null;
        for (ShopifyPermissionScope scope : scopes) {
            if (scope == null || scope.scope() == null) {
                continue;
            }
            String candidate = scope.scope().strip().toLowerCase(Locale.ROOT);
            if (!normalized.equals(candidate)
                    && (impliedBy == null || !impliedBy.equals(candidate))) {
                continue;
            }
            if (scope.status() == ShopifyScopeCoverageStatus.GRANTED) {
                return ShopifyScopeCoverageStatus.GRANTED;
            }
            if (fallback == null
                    || scope.status() == ShopifyScopeCoverageStatus.MISSING) {
                fallback = scope.status();
            }
        }
        return fallback;
    }

    private static boolean scopeGranted(
            Set<String> granted,
            String requiredScope) {
        String impliedBy = SHOPIFY_READ_SCOPE_IMPLIED_BY_WRITE.get(
                requiredScope);
        return granted.contains(requiredScope)
                || impliedBy != null && granted.contains(impliedBy);
    }

    List<ShopifyPermissionScope> SHOPIFY_SCOPE_PLAN = List.of(
            new ShopifyPermissionScope("write_orders", "订单收货地址、备注和运营处理", ShopifyScopeCoverageStatus.REQUESTED),
            new ShopifyPermissionScope("read_all_orders", "读取超过默认时间窗的历史订单", ShopifyScopeCoverageStatus.REQUESTED),
            new ShopifyPermissionScope("write_order_edits", "修改订单商品行、数量、折扣和金额", ShopifyScopeCoverageStatus.REQUESTED),
            new ShopifyPermissionScope("read_products", "商品和变体拉取", ShopifyScopeCoverageStatus.REQUESTED),
            new ShopifyPermissionScope("write_inventory", "库存调整和同步", ShopifyScopeCoverageStatus.REQUESTED),
            new ShopifyPermissionScope("read_locations", "仓库/地点读取", ShopifyScopeCoverageStatus.REQUESTED),
            new ShopifyPermissionScope("write_merchant_managed_fulfillment_orders", "商家自管履约单处理", ShopifyScopeCoverageStatus.REQUESTED),
            new ShopifyPermissionScope("write_returns", "退货处理", ShopifyScopeCoverageStatus.REQUESTED),
            new ShopifyPermissionScope("read_customers", "客户档案与订单售后识别", ShopifyScopeCoverageStatus.REQUESTED),
            new ShopifyPermissionScope("read_shopify_payments_disputes", "拒付金额、状态、原因和截止时间", ShopifyScopeCoverageStatus.REQUESTED)
    );

    record ProductCatalogRequest(
            int limit,
            String cursor,
            String query
    ) {
    }

    record ProductCatalogPage(
            ConnectorMode mode,
            ConnectionStatus connectionStatus,
            String cursor,
            boolean hasNextPage,
            Instant fetchedAt,
            List<ProductCatalogProduct> products
    ) {
        public ProductCatalogPage {
            products = List.copyOf(products);
        }
    }

    record ProductCatalogProduct(
            String externalListingRef,
            String title,
            String handle,
            String externalStatus,
            Instant updatedAt,
            List<ProductCatalogVariant> variants
    ) {
        public ProductCatalogProduct {
            variants = List.copyOf(variants);
        }
    }

    record ProductCatalogVariant(
            String externalVariantRef,
            String inventoryItemRef,
            String sku,
            String title,
            String price,
            String currencyCode,
            boolean availableForSale,
            boolean inventoryTracked
    ) {
    }

    record LocationCatalogRequest(int limit, String cursor) {
    }

    record LocationCatalogPage(
            ConnectorMode mode,
            ConnectionStatus connectionStatus,
            String cursor,
            boolean hasNextPage,
            Instant fetchedAt,
            List<LocationCatalogLocation> locations) {
        public LocationCatalogPage {
            locations = locations == null ? List.of() : List.copyOf(locations);
        }
    }

    record LocationCatalogLocation(
            String externalLocationRef,
            String name,
            boolean active,
            boolean fulfillsOnlineOrders,
            boolean hasActiveInventory,
            boolean fulfillmentService,
            String address1,
            String address2,
            String city,
            String province,
            String provinceCode,
            String country,
            String countryCode,
            String zip) {
    }

    record InventoryLevelRequest(
            String externalInventoryItemRef,
            String externalLocationRef) {
    }

    record InventoryLevelSnapshot(
            ConnectorMode mode,
            ConnectionStatus connectionStatus,
            String externalInventoryItemRef,
            String externalLocationRef,
            boolean tracked,
            boolean active,
            int availableQuantity,
            Integer onHandQuantity,
            Instant fetchedAt) {
    }

    enum InventorySetOutcome {
        APPLIED,
        STALE,
        REJECTED
    }

    record InventorySetRequest(
            String externalInventoryItemRef,
            String externalLocationRef,
            int expectedAvailable,
            int targetAvailable,
            String idempotencyKey,
            UUID publicationId) {
    }

    record InventorySetResult(
            InventorySetOutcome outcome,
            String externalInventoryItemRef,
            String externalLocationRef,
            int expectedAvailable,
            int targetAvailable,
            String safeErrorCode,
            Instant updatedAt) {
    }

    record OrderCatalogRequest(
            int limit,
            String cursor,
            String query
    ) {
    }

    record CustomerCatalogRequest(
            int limit,
            String cursor,
            String query
    ) {
    }

    record OrderShippingAddressUpdateRequest(
            String externalOrderRef,
            String idempotencyKey,
            MailingAddress address
    ) {
    }

    record OrderShippingAddressUpdateResult(
            MailingAddress address,
            Instant updatedAt
    ) {
    }

    record OrderEditQuantityRequest(
            String externalOrderRef,
            String externalOrderLineRef,
            String externalVariantRef,
            int expectedQuantity,
            int quantity,
            boolean restock,
            boolean notifyCustomer,
            String idempotencyKey
    ) {
    }

    record OrderEditQuantityResult(
            String externalOrderRef,
            String externalOrderLineRef,
            int quantity,
            Money total,
            boolean recoveredFromShopify,
            Instant updatedAt
    ) {
    }

    record OrderAddVariantRequest(
            String externalOrderRef,
            String externalVariantRef,
            int quantity,
            boolean notifyCustomer,
            boolean recoverExisting,
            String idempotencyKey
    ) {
    }

    record OrderAddVariantResult(
            String externalOrderRef,
            String externalOrderLineRef,
            String externalVariantRef,
            int quantity,
            String platformSku,
            String title,
            String variantTitle,
            Money unitPrice,
            Money total,
            boolean recoveredFromShopify,
            Instant updatedAt
    ) {
    }

    record OrderAddCustomItemRequest(
            String externalOrderRef,
            String title,
            Money unitPrice,
            int quantity,
            boolean requiresShipping,
            boolean taxable,
            boolean notifyCustomer,
            boolean recoverExisting,
            String idempotencyKey
    ) {
    }

    record OrderAddCustomItemResult(
            String externalOrderRef,
            String externalOrderLineRef,
            String title,
            Money unitPrice,
            int quantity,
            Money total,
            boolean recoveredFromShopify,
            Instant updatedAt
    ) {
    }

    enum OrderLineDiscountType {
        FIXED,
        PERCENTAGE
    }

    record OrderLineDiscountRequest(
            String externalOrderRef,
            String externalOrderLineRef,
            String externalVariantRef,
            int expectedQuantity,
            Money expectedDiscountTotal,
            String description,
            OrderLineDiscountType discountType,
            Money fixedValue,
            Integer percentBasisPoints,
            boolean notifyCustomer,
            boolean recoverExisting,
            String idempotencyKey
    ) {
    }

    record OrderLineDiscountResult(
            String externalOrderRef,
            String externalOrderLineRef,
            String description,
            OrderLineDiscountType discountType,
            Money fixedValue,
            Integer percentBasisPoints,
            Money discountTotal,
            Money total,
            boolean recoveredFromShopify,
            Instant updatedAt
    ) {
    }

    enum OrderCancellationReason {
        CUSTOMER, DECLINED, FRAUD, INVENTORY, STAFF, OTHER
    }

    record OrderCancellationRequest(
            String externalOrderRef,
            OrderCancellationReason reason,
            String staffNote,
            boolean refundOriginalPaymentMethods,
            boolean restock,
            boolean notifyCustomer,
            boolean recoverExisting,
            String idempotencyKey) {
    }

    record OrderCancellationResult(
            String externalOrderRef,
            OrderCancellationReason reason,
            Instant cancelledAt,
            String jobId,
            boolean recoveredFromShopify,
            Instant updatedAt) {
    }

    record FulfillmentPublishRequest(
            String externalOrderRef,
            String idempotencyKey,
            boolean notifyCustomer,
            TrackingInfo tracking,
            List<FulfillmentPublishLine> lines
    ) {
        public FulfillmentPublishRequest {
            lines = List.copyOf(lines);
        }
    }

    record FulfillmentPublishLine(
            String externalOrderLineRef,
            int quantity
    ) {
    }

    record FulfillmentPublishResult(
            List<String> externalFulfillmentRefs,
            TrackingInfo tracking,
            boolean recoveredFromShopify,
            Instant updatedAt
    ) {
        public FulfillmentPublishResult {
            externalFulfillmentRefs = List.copyOf(externalFulfillmentRefs);
        }
    }

    record DisputeCatalogRequest(
            int limit,
            String cursor) {
    }

    record ReturnCatalogRequest(
            int limit,
            String cursor,
            String query) {
    }

    record ReturnCatalogPage(
            ConnectorMode mode,
            ConnectionStatus connectionStatus,
            String cursor,
            boolean hasNextPage,
            Instant fetchedAt,
            List<ShopifyReturn> returns) {
        public ReturnCatalogPage {
            returns = List.copyOf(returns);
        }
    }

    record ShopifyReturn(
            String externalReturnRef,
            String name,
            String externalOrderRef,
            String orderName,
            String status,
            Instant createdAt,
            Instant closedAt,
            Instant requestApprovedAt,
            int totalQuantity,
            List<ShopifyReturnLine> lineItems) {
        public ShopifyReturn {
            lineItems = List.copyOf(lineItems);
        }
    }

    record ShopifyReturnLine(
            String externalReturnLineRef,
            String externalFulfillmentLineRef,
            String externalOrderLineRef,
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

    enum ReturnDecision {
        APPROVE, DECLINE
    }

    enum ReturnDeclineReason {
        FINAL_SALE, OTHER, RETURN_PERIOD_ENDED
    }

    record ReturnDecisionRequest(
            String externalReturnRef,
            ReturnDecision decision,
            ReturnDeclineReason declineReason,
            String declineNote,
            boolean notifyCustomer,
            String idempotencyKey) {
    }

    record ReturnDecisionResult(
            String externalReturnRef,
            String status,
            boolean recoveredFromShopify,
            Instant updatedAt) {
    }

    record ReturnRefundLineSelection(
            String externalReturnLineRef,
            int quantity) {
    }

    enum ReturnRefundDutyType {
        FULL, PROPORTIONAL
    }

    record ReturnRefundDutySelection(
            String externalDutyRef,
            ReturnRefundDutyType refundType) {
    }

    record ReturnRefundPreviewRequest(
            String externalReturnRef,
            List<ReturnRefundLineSelection> lineItems,
            boolean refundShipping,
            List<ReturnRefundDutySelection> refundDuties) {
        public ReturnRefundPreviewRequest {
            lineItems = List.copyOf(lineItems);
            refundDuties = List.copyOf(refundDuties);
        }
    }

    record MoneyBag(Money shopMoney, Money presentmentMoney) {
    }

    record ReturnRefundTransaction(
            String externalParentTransactionRef,
            MoneyBag amount,
            String gateway,
            String formattedGateway,
            String accountNumber) {
    }

    enum ReturnRefundPreviewState {
        REFUNDABLE, NOT_REFUNDABLE
    }

    record ReturnRefundPreview(
            String externalReturnRef,
            ReturnRefundPreviewState state,
            List<ReturnRefundLineSelection> lineItems,
            boolean refundShipping,
            List<ReturnRefundDutySelection> refundDuties,
            MoneyBag shippingAmount,
            MoneyBag dutyAmount,
            MoneyBag refundAmount,
            MoneyBag maximumRefundable,
            List<ReturnRefundTransaction> transactions,
            String previewToken,
            Instant expiresAt,
            Instant fetchedAt) {
        public ReturnRefundPreview {
            lineItems = List.copyOf(lineItems);
            refundDuties = List.copyOf(refundDuties);
            transactions = List.copyOf(transactions);
        }
    }

    record ReturnRefundProcessRequest(
            String externalReturnRef,
            List<ReturnRefundLineSelection> lineItems,
            boolean refundShipping,
            List<ReturnRefundDutySelection> refundDuties,
            String previewToken,
            boolean notifyCustomer,
            String idempotencyKey) {
        public ReturnRefundProcessRequest {
            lineItems = List.copyOf(lineItems);
            refundDuties = List.copyOf(refundDuties);
        }
    }

    enum ReturnRefundProcessOutcome {
        APPLIED, PENDING, REVIEW_REQUIRED
    }

    record ReturnRefundProcessedTransaction(
            String externalTransactionRef,
            String externalParentTransactionRef,
            String status,
            MoneyBag amount) {
    }

    record ReturnRefundProcessResult(
            String externalReturnRef,
            String returnStatus,
            ReturnRefundProcessOutcome outcome,
            MoneyBag refundAmount,
            List<ReturnRefundProcessedTransaction> transactions,
            boolean recoveredFromShopify,
            Instant updatedAt) {
        public ReturnRefundProcessResult {
            transactions = List.copyOf(transactions);
        }
    }

    record DisputeCatalogPage(
            ConnectorMode mode,
            ConnectionStatus connectionStatus,
            String cursor,
            boolean hasNextPage,
            Instant fetchedAt,
            List<Dispute> disputes) {
        public DisputeCatalogPage {
            disputes = List.copyOf(disputes);
        }
    }

    record Dispute(
            String externalDisputeRef,
            String externalOrderRef,
            String orderName,
            String status,
            String type,
            String reason,
            String networkReasonCode,
            Money amount,
            Instant initiatedAt,
            Instant evidenceDueBy,
            Instant evidenceSentOn,
            Instant finalizedOn) {
    }

    record OrderCatalogPage(
            ConnectorMode mode,
            ConnectionStatus connectionStatus,
            String cursor,
            boolean hasNextPage,
            Instant fetchedAt,
            List<OrderCatalogOrder> orders
    ) {
        public OrderCatalogPage {
            orders = List.copyOf(orders);
        }
    }

    record CustomerCatalogPage(
            ConnectorMode mode,
            ConnectionStatus connectionStatus,
            String cursor,
            boolean hasNextPage,
            Instant fetchedAt,
            List<CustomerProfile> customers
    ) {
        public CustomerCatalogPage {
            customers = List.copyOf(customers);
        }
    }

    record CustomerProfile(
            String externalCustomerRef,
            String legacyResourceId,
            String displayName,
            String email,
            String phone,
            Instant createdAt,
            Instant updatedAt,
            boolean verifiedEmail,
            List<String> tags,
            String numberOfOrders,
            Money totalSpent,
            CustomerLocation defaultLocation,
            CustomerOrderSummary lastOrder
    ) {
        public CustomerProfile {
            tags = List.copyOf(tags);
        }
    }

    record CustomerLocation(
            String city,
            String province,
            String country,
            String countryCode
    ) {
    }

    record CustomerOrderSummary(
            String externalOrderRef,
            String name,
            Instant createdAt,
            String financialStatus,
            String fulfillmentStatus,
            Money total
    ) {
    }

    record OrderCatalogOrder(
            String externalOrderRef,
            String legacyResourceId,
            String name,
            String email,
            String sourceName,
            Instant createdAt,
            Instant updatedAt,
            Instant cancelledAt,
            String financialStatus,
            String fulfillmentStatus,
            List<String> paymentGatewayNames,
            Money total,
            Money subtotal,
            Money shipping,
            MailingAddress shippingAddress,
            Customer customer,
            List<OrderCatalogLine> lineItems,
            List<Fulfillment> fulfillments
    ) {
        public OrderCatalogOrder {
            paymentGatewayNames = List.copyOf(paymentGatewayNames);
            lineItems = List.copyOf(lineItems);
            fulfillments = List.copyOf(fulfillments);
        }
    }

    record OrderCatalogLine(
            String externalLineRef,
            String externalListingRef,
            String externalVariantRef,
            String inventoryItemRef,
            String name,
            String title,
            int quantity,
            String sku,
            String variantTitle,
            boolean requiresShipping,
            Money discountedTotal,
            Money originalUnitPrice
    ) {
    }

    record Money(String amount, String currencyCode) {
    }

    record MailingAddress(
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
            List<String> formatted
    ) {
        public MailingAddress {
            formatted = List.copyOf(formatted);
        }
    }

    record Customer(
            String externalCustomerRef,
            String displayName,
            String email,
            String phone,
            Instant createdAt,
            Money totalSpent
    ) {
    }

    record Fulfillment(
            String externalFulfillmentRef,
            String status,
            Instant createdAt,
            Instant updatedAt,
            List<TrackingInfo> trackingInfo
    ) {
        public Fulfillment {
            trackingInfo = List.copyOf(trackingInfo);
        }
    }

    record TrackingInfo(String company, String number, String url) {
    }
}
