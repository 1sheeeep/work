package cn.xzkj.erp.order.service;

import static cn.xzkj.erp.order.domain.OrderAuditActions.PROTECTED_CUSTOMER_DATA_READ;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.order.repository.OrderSkuLookupRepository;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.MailingAddress;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Money;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.repository.TenantShopRepository;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;
import cn.xzkj.erp.product.domain.ProductSku;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.settings.general.SystemGeneralSettingService;

@Service
public class OrderShopifyCatalogPreviewService {

    private static final int SHOPIFY_DEFAULT_ORDER_WINDOW_DAYS = 60;
    private static final int SHOPIFY_QUERY_MAX_LENGTH = 500;

    private final TenantShopRepository shopRepository;
    private final OrderSkuLookupRepository skuRepository;
    private final ChannelConnectorGateway connector;
    private final SecurityAuditRecorder auditRecorder;
    private final SystemGeneralSettingService systemGeneralSettingService;

    public OrderShopifyCatalogPreviewService(
            TenantShopRepository shopRepository,
            OrderSkuLookupRepository skuRepository,
            ChannelConnectorGateway connector,
            SecurityAuditRecorder auditRecorder,
            SystemGeneralSettingService systemGeneralSettingService) {
        this.shopRepository = shopRepository;
        this.skuRepository = skuRepository;
        this.connector = connector;
        this.auditRecorder = auditRecorder;
        this.systemGeneralSettingService = systemGeneralSettingService;
    }

    @Transactional(readOnly = true)
    public ShopifyOrderCatalogPreview preview(
            OrderActor actor,
            UUID shopId,
            int limit,
            String cursor,
            String query) {
        return preview(actor, shopId, limit, cursor, query, false);
    }

    @Transactional(readOnly = true)
    public ShopifyOrderCatalogPreview preview(
            OrderActor actor,
            UUID shopId,
            int limit,
            String cursor,
            String query,
            boolean historical) {
        requireActor(actor);
        systemGeneralSettingService.requireOrderPullAllowed(
                actor.tenantId(), Instant.now());
        var preview = previewInternal(
                actor.tenantId(), shopId, limit, cursor, query, historical);
        auditProtectedCustomerDataRead(
                actor, shopId, "shopifyCatalogPreview", preview.orders().size());
        return preview;
    }

    @Transactional(readOnly = true)
    public ShopifyOrderCatalogPreview previewForImport(
            OrderActor actor,
            UUID shopId,
            int limit,
            String cursor,
            String query) {
        return previewForImport(actor, shopId, limit, cursor, query, false);
    }

    @Transactional(readOnly = true)
    public ShopifyOrderCatalogPreview previewForImport(
            OrderActor actor,
            UUID shopId,
            int limit,
            String cursor,
            String query,
            boolean historical) {
        requireActor(actor);
        systemGeneralSettingService.requireOrderPullAllowed(
                actor.tenantId(), Instant.now());
        var preview = previewInternal(
                actor.tenantId(), shopId, limit, cursor, query, historical);
        auditProtectedCustomerDataRead(
                actor, shopId, "shopifyCatalogImport", preview.orders().size());
        return preview;
    }

    private ShopifyOrderCatalogPreview previewInternal(
            UUID tenantId,
            UUID shopId,
            int limit,
            String cursor,
            String query,
            boolean historical) {
        if (tenantId == null || shopId == null) {
            throw new IllegalArgumentException("Tenant and shop are required");
        }
        if (limit < 1 || limit > 100) {
            throw new IllegalArgumentException(
                    "Shopify order preview limit must be between 1 and 100");
        }
        var shop = shopRepository.findByIdAndTenantId(shopId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Shop was not found"));
        if (shop.getStatus() != ShopStatus.ACTIVE) {
            throw new ConflictException(
                    "Shopify order preview requires an active shop");
        }
        requireShopifyAccess(tenantId, shopId, "read_orders");
        if (historical) {
            requireShopifyAccess(tenantId, shopId, "read_all_orders");
        }
        var page = connector.fetchShopifyOrderCatalog(
                tenantId,
                shopId,
                new ChannelConnectorGateway.OrderCatalogRequest(
                        limit,
                        nullable(cursor),
                        nullable(orderQuery(query, historical))));
        Map<String, ProductSku> localSkus = localSkuMap(tenantId, page.orders()
                .stream()
                .flatMap(order -> order.lineItems().stream())
                .map(ChannelConnectorGateway.OrderCatalogLine::sku)
                .toList());
        return new ShopifyOrderCatalogPreview(
                page.mode(),
                page.connectionStatus(),
                page.cursor(),
                page.hasNextPage(),
                page.fetchedAt(),
                page.orders().stream()
                        .map(order -> orderPreview(order, localSkus))
                        .toList());
    }

    private static String orderQuery(String query, boolean historical) {
        String normalized = query == null ? "" : query.strip();
        if (!historical) {
            return normalized;
        }
        String cutoff = "created_at:<" + LocalDate.now(ZoneOffset.UTC)
                .minusDays(SHOPIFY_DEFAULT_ORDER_WINDOW_DAYS);
        String combined = normalized.isBlank()
                ? cutoff
                : normalized + " " + cutoff;
        if (combined.length() > SHOPIFY_QUERY_MAX_LENGTH) {
            throw new IllegalArgumentException(
                    "Shopify historical order query must be at most 500 characters");
        }
        return combined;
    }

    private void auditProtectedCustomerDataRead(
            OrderActor actor,
            UUID shopId,
            String surface,
            int recordCount) {
        auditRecorder.record(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                PROTECTED_CUSTOMER_DATA_READ,
                "shop", shopId.toString(), actor.requestId(),
                actor.sourceIp(), Map.of(
                        "surface", surface,
                        "fieldSet", "name,address,phone,email",
                        "recordCount", Integer.toString(recordCount))));
    }

    private static void requireActor(OrderActor actor) {
        Objects.requireNonNull(actor, "Actor is required");
        Objects.requireNonNull(actor.tenantId(), "Tenant is required");
        boolean userActor = actor.userId() != null;
        boolean systemAdminActor = actor.systemAdminId() != null;
        if (userActor == systemAdminActor) {
            throw new IllegalArgumentException(
                    "Exactly one actor identity is required");
        }
    }

    private ShopifyOrderPreview orderPreview(
            ChannelConnectorGateway.OrderCatalogOrder order,
            Map<String, ProductSku> localSkus) {
        return new ShopifyOrderPreview(
                order.externalOrderRef(),
                order.legacyResourceId(),
                order.name(),
                order.email(),
                order.sourceName(),
                order.createdAt(),
                order.updatedAt(),
                order.cancelledAt(),
                order.financialStatus(),
                order.fulfillmentStatus(),
                order.paymentGatewayNames(),
                money(order.total()),
                money(order.subtotal()),
                money(order.shipping()),
                address(order.shippingAddress()),
                order.customer() == null ? null
                        : new ShopifyCustomerPreview(
                                order.customer().externalCustomerRef(),
                                order.customer().displayName(),
                                order.customer().email(),
                                order.customer().phone(),
                                order.customer().createdAt(),
                                money(order.customer().totalSpent())),
                order.lineItems().stream()
                        .map(line -> linePreview(line, localSkus))
                        .toList(),
                order.fulfillments().stream()
                        .map(fulfillment -> new ShopifyFulfillmentPreview(
                                fulfillment.externalFulfillmentRef(),
                                fulfillment.status(),
                                fulfillment.createdAt(),
                                fulfillment.updatedAt(),
                                fulfillment.trackingInfo().stream()
                                        .map(tracking -> new ShopifyTrackingPreview(
                                                tracking.company(),
                                                tracking.number(),
                                                tracking.url()))
                                        .toList()))
                        .toList());
    }

    private ShopifyOrderLinePreview linePreview(
            ChannelConnectorGateway.OrderCatalogLine line,
            Map<String, ProductSku> localSkus) {
        String normalized = normalizeSkuCode(line.sku());
        ProductSku matched = normalized == null ? null : localSkus.get(normalized);
        ShopifyOrderLineMatchStatus status = normalized == null
                ? ShopifyOrderLineMatchStatus.EMPTY_PLATFORM_SKU
                : matched == null
                        ? ShopifyOrderLineMatchStatus.MISSING_LOCAL_SKU
                        : ShopifyOrderLineMatchStatus.EXACT_SKU_MATCH;
        return new ShopifyOrderLinePreview(
                line.externalLineRef(),
                line.externalListingRef(),
                line.externalVariantRef(),
                line.inventoryItemRef(),
                line.name(),
                line.title(),
                line.quantity(),
                line.sku(),
                line.variantTitle(),
                line.requiresShipping(),
                money(line.discountedTotal()),
                money(line.originalUnitPrice()),
                status,
                matched == null ? null : new LocalSkuMatch(
                        matched.getId(),
                        matched.getBusinessCode(),
                        matched.getName(),
                        matched.getStatus()));
    }

    private Map<String, ProductSku> localSkuMap(
            UUID tenantId,
            Collection<String> platformSkus) {
        List<String> codes = platformSkus.stream()
                .map(OrderShopifyCatalogPreviewService::normalizeSkuCode)
                .filter(Objects::nonNull)
                .distinct()
                .sorted()
                .toList();
        if (codes.isEmpty()) {
            return Map.of();
        }
        return skuRepository.findByTenantIdAndBusinessCodeInAndStatusNot(
                        tenantId,
                        codes,
                        ProductStatus.ARCHIVED)
                .stream()
                .collect(Collectors.toMap(
                        sku -> normalizeSkuCode(sku.getBusinessCode()),
                        sku -> sku,
                        (left, ignored) -> left,
                        HashMap::new));
    }

    private static MoneyPreview money(Money value) {
        if (value == null) {
            return null;
        }
        return new MoneyPreview(
                value.amount(),
                amountMinor(value.amount()),
                value.currencyCode());
    }

    private static Long amountMinor(String amount) {
        String value = nullable(amount);
        if (value == null) {
            return null;
        }
        try {
            return new BigDecimal(value)
                    .movePointRight(2)
                    .setScale(0, RoundingMode.HALF_UP)
                    .longValueExact();
        } catch (ArithmeticException | NumberFormatException ignored) {
            return null;
        }
    }

    private static AddressPreview address(MailingAddress value) {
        if (value == null) {
            return null;
        }
        return new AddressPreview(
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

    private static String nullable(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private static String normalizeSkuCode(String value) {
        String normalized = nullable(value);
        return normalized == null ? null : normalized.toUpperCase(Locale.ROOT);
    }

    private void requireShopifyAccess(
            UUID tenantId,
            UUID shopId,
            String requiredScope) {
        var snapshot = connector.snapshot(tenantId, shopId);
        if (snapshot.shopify().status() != ConnectionStatus.CONNECTED) {
            throw ShopifyAuthorizationConflictException.notConnected();
        }
        var coverage = ChannelConnectorGateway.shopifyScopeCoverage(
                snapshot.shopifyScopes(), requiredScope);
        if (coverage == null) {
            throw ShopifyAuthorizationConflictException.scopeUnavailable();
        }
        if (coverage
                == ChannelConnectorGateway.ShopifyScopeCoverageStatus.MISSING) {
            throw ShopifyAuthorizationConflictException.missingScope(requiredScope);
        }
    }

    public record ShopifyOrderCatalogPreview(
            ChannelConnectorGateway.ConnectorMode mode,
            ConnectionStatus connectionStatus,
            String cursor,
            boolean hasNextPage,
            Instant fetchedAt,
            List<ShopifyOrderPreview> orders) {
        public ShopifyOrderCatalogPreview {
            orders = List.copyOf(orders);
        }
    }

    public record ShopifyOrderPreview(
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
            MoneyPreview total,
            MoneyPreview subtotal,
            MoneyPreview shipping,
            AddressPreview shippingAddress,
            ShopifyCustomerPreview customer,
            List<ShopifyOrderLinePreview> lineItems,
            List<ShopifyFulfillmentPreview> fulfillments) {
        public ShopifyOrderPreview {
            paymentGatewayNames = List.copyOf(paymentGatewayNames);
            lineItems = List.copyOf(lineItems);
            fulfillments = List.copyOf(fulfillments);
        }
    }

    public record ShopifyOrderLinePreview(
            String externalLineRef,
            String externalListingRef,
            String externalVariantRef,
            String inventoryItemRef,
            String name,
            String title,
            int quantity,
            String platformSku,
            String variantTitle,
            boolean requiresShipping,
            MoneyPreview discountedTotal,
            MoneyPreview originalUnitPrice,
            ShopifyOrderLineMatchStatus matchStatus,
            LocalSkuMatch localSku) {
    }

    public enum ShopifyOrderLineMatchStatus {
        EXACT_SKU_MATCH,
        MISSING_LOCAL_SKU,
        EMPTY_PLATFORM_SKU
    }

    public record LocalSkuMatch(
            UUID id,
            String businessCode,
            String name,
            ProductStatus status) {
    }

    public record MoneyPreview(
            String amount,
            Long amountMinor,
            String currencyCode) {
    }

    public record AddressPreview(
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
        public AddressPreview {
            formatted = List.copyOf(formatted);
        }
    }

    public record ShopifyCustomerPreview(
            String externalCustomerRef,
            String displayName,
            String email,
            String phone,
            Instant createdAt,
            MoneyPreview totalSpent) {
    }

    public record ShopifyFulfillmentPreview(
            String externalFulfillmentRef,
            String status,
            Instant createdAt,
            Instant updatedAt,
            List<ShopifyTrackingPreview> trackingInfo) {
        public ShopifyFulfillmentPreview {
            trackingInfo = List.copyOf(trackingInfo);
        }
    }

    public record ShopifyTrackingPreview(
            String company,
            String number,
            String url) {
    }
}
