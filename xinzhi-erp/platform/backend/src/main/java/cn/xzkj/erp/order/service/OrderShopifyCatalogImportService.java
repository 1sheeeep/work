package cn.xzkj.erp.order.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Service;

import cn.xzkj.erp.order.domain.OrderProfile;
import cn.xzkj.erp.order.domain.TenantOrder;
import cn.xzkj.erp.order.repository.OrderRepository;
import cn.xzkj.erp.order.service.OrderCenterService.CreateLineCommand;
import cn.xzkj.erp.order.service.OrderCenterService.CreateOrderCommand;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService.AddressPreview;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService.MoneyPreview;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService.ShopifyFulfillmentPreview;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService.ShopifyOrderLinePreview;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService.ShopifyOrderPreview;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService.ShopifyTrackingPreview;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.settings.address.AddressMappingService;
import cn.xzkj.erp.settings.address.AddressMappingService.AddressType;
import cn.xzkj.erp.settings.address.AddressMappingService.Platform;

@Service
public class OrderShopifyCatalogImportService {

    private static final int MAX_SELECTED_ORDERS = 50;

    private final OrderShopifyCatalogPreviewService previewService;
    private final OrderCenterService orderService;
    private final OrderRepository orderRepository;
    private final AddressMappingService addressMappingService;

    public OrderShopifyCatalogImportService(
            OrderShopifyCatalogPreviewService previewService,
            OrderCenterService orderService,
            OrderRepository orderRepository,
            AddressMappingService addressMappingService) {
        this.previewService = previewService;
        this.orderService = orderService;
        this.orderRepository = orderRepository;
        this.addressMappingService = addressMappingService;
    }

    public ShopifyOrderCatalogImportResult importSelectedOrders(
            OrderActor actor,
            UUID shopId,
            int limit,
            String cursor,
            String query,
            List<String> externalOrderRefs) {
        return importSelectedOrders(
                actor, shopId, limit, cursor, query, false,
                externalOrderRefs);
    }

    public ShopifyOrderCatalogImportResult importSelectedOrders(
            OrderActor actor,
            UUID shopId,
            int limit,
            String cursor,
            String query,
            boolean historical,
            List<String> externalOrderRefs) {
        Objects.requireNonNull(actor, "Actor is required");
        Objects.requireNonNull(
                actor.tenantId(),
                "Tenant is required");
        Set<String> selectedRefs = selectedRefs(externalOrderRefs);
        var preview = previewService.previewForImport(
                actor,
                shopId,
                limit,
                cursor,
                query,
                historical);
        Map<String, ShopifyOrderPreview> orders = new LinkedHashMap<>();
        for (ShopifyOrderPreview order : preview.orders()) {
            if (order.externalOrderRef() != null) {
                orders.putIfAbsent(order.externalOrderRef(), order);
            }
        }

        List<ShopifyOrderCatalogImportItemResult> items = new ArrayList<>();
        for (String selectedRef : selectedRefs) {
            ShopifyOrderPreview order = orders.get(selectedRef);
            if (order == null) {
                items.add(skipped(
                        selectedRef,
                        null,
                        ShopifyOrderCatalogImportStatus.SKIPPED_NOT_IN_PAGE,
                        "Selected Shopify order was not found in the fetched catalog page"));
                continue;
            }
            items.add(importOrder(actor, shopId, order));
        }
        long importedCount = items.stream()
                .filter(item -> item.status()
                        == ShopifyOrderCatalogImportStatus.IMPORTED)
                .count();
        return new ShopifyOrderCatalogImportResult(
                selectedRefs.size(),
                importedCount,
                items.size() - importedCount,
                items);
    }

    private ShopifyOrderCatalogImportItemResult importOrder(
            OrderActor actor,
            UUID shopId,
            ShopifyOrderPreview order) {
        if (orderRepository.existsByTenantIdAndShopIdAndExternalOrderRef(
                actor.tenantId(), shopId, order.externalOrderRef())) {
            return skipped(
                    order.externalOrderRef(),
                    order.name(),
                    ShopifyOrderCatalogImportStatus.SKIPPED_DUPLICATE,
                    "Order already exists in ERP");
        }
        String currency = currency(order);
        if (currency == null || order.createdAt() == null
                || order.lineItems().isEmpty()) {
            return skipped(
                    order.externalOrderRef(),
                    order.name(),
                    ShopifyOrderCatalogImportStatus.SKIPPED_INVALID_ORDER,
                    "Shopify order is missing required order fields");
        }
        List<CreateLineCommand> lines = lines(order, currency);
        if (lines.isEmpty()) {
            return skipped(
                    order.externalOrderRef(),
                    order.name(),
                    ShopifyOrderCatalogImportStatus.SKIPPED_INVALID_ORDER,
                    "Shopify order is missing importable order lines");
        }
        try {
            var created = orderService.createOrder(
                    actor,
                    new CreateOrderCommand(
                            shopId,
                            order.externalOrderRef(),
                            idempotencyKey(shopId, order.externalOrderRef()),
                            currency,
                            buyerReference(order),
                            order.createdAt(),
                            null,
                            operational(actor.tenantId(), order),
                            profile(actor.tenantId(), order),
                            lines));
            return new ShopifyOrderCatalogImportItemResult(
                    order.externalOrderRef(),
                    order.name(),
                    created.order().getId(),
                    ShopifyOrderCatalogImportStatus.IMPORTED,
                    null);
        } catch (ConflictException ex) {
            return skipped(
                    order.externalOrderRef(),
                    order.name(),
                    ShopifyOrderCatalogImportStatus.SKIPPED_CONFLICT,
                    "Order could not be imported because it conflicts with existing order data");
        } catch (ResourceNotFoundException | IllegalArgumentException ex) {
            return skipped(
                    order.externalOrderRef(),
                    order.name(),
                    ShopifyOrderCatalogImportStatus.SKIPPED_INVALID_ORDER,
                    "Shopify order did not pass ERP order validation");
        }
    }

    private static List<CreateLineCommand> lines(
            ShopifyOrderPreview order,
            String currency) {
        List<CreateLineCommand> lines = new ArrayList<>();
        Set<String> refs = new LinkedHashSet<>();
        for (ShopifyOrderLinePreview line : order.lineItems()) {
            String externalLineRef = text(line.externalLineRef(), 160);
            String title = text(firstNonBlank(line.name(), line.title(),
                    externalLineRef), 300);
            if (externalLineRef == null || title == null || line.quantity() < 1
                    || !refs.add(externalLineRef)) {
                return List.of();
            }
            UUID skuId = line.localSku() == null ? null : line.localSku().id();
            lines.add(new CreateLineCommand(
                    skuId,
                    text(line.externalListingRef(), 160),
                    text(line.externalVariantRef(), 160),
                    externalLineRef,
                    title,
                    line.quantity(),
                    unitPriceMinor(line),
                    currency));
        }
        return lines;
    }

    private TenantOrder.OperationalMetadata operational(UUID tenantId,
            ShopifyOrderPreview order) {
        AddressPreview address = order.shippingAddress();
        String countryCode = address == null
                ? null : text(upper(address.countryCode()), 2);
        String provinceFallback = address == null ? null : text(firstNonBlank(
                address.provinceCode(), address.province()), 120);
        String province = address == null ? null
                : addressMappingService.resolveFirst(tenantId, Platform.SHOPIFY,
                        countryCode, AddressType.PROVINCE,
                        candidates(address.province(), address.provinceCode()),
                        provinceFallback);
        return new TenantOrder.OperationalMetadata(
                platformStatus(order),
                paymentStatus(order.financialStatus()),
                trackingCompany(order.fulfillments()),
                countryCode,
                province,
                address == null ? null : text(address.zip(), 32),
                null,
                amountMinor(order.total()),
                amountMinor(order.shipping()),
                null,
                "PAID".equals(paymentStatus(order.financialStatus()))
                        ? order.createdAt() : null,
                null,
                shippedAt(order.fulfillments()),
                text(order.fulfillmentStatus(), 32),
                null,
                null,
                null,
                false,
                null,
                false,
                false);
    }

    private OrderProfile profile(UUID tenantId, ShopifyOrderPreview order) {
        AddressPreview address = order.shippingAddress();
        ShopifyTrackingPreview tracking = firstTracking(order.fulfillments());
        String countryCode = address == null
                ? null : text(upper(address.countryCode()), 2);
        String cityFallback = address == null ? null : text(address.city(), 120);
        String city = address == null ? null
                : addressMappingService.resolveFirst(tenantId, Platform.SHOPIFY,
                        countryCode, AddressType.CITY,
                        candidates(address.city()), cityFallback);
        return new OrderProfile(
                null,
                null,
                order.name(),
                order.customer() == null
                        ? null : text(order.customer().externalCustomerRef(), 160),
                null,
                address == null ? null : text(address.name(), 200),
                firstNonBlank(
                        address == null ? null : address.phone(),
                        order.customer() == null ? null : order.customer().phone()),
                firstNonBlank(
                        order.email(),
                        order.customer() == null ? null : order.customer().email()),
                address == null ? null : text(address.company(), 200),
                address == null ? null : text(address.address1(), 300),
                address == null ? null : text(address.address2(), 300),
                city,
                null,
                null,
                null,
                tracking == null ? null : text(tracking.company(), 120),
                tracking == null ? null : text(tracking.number(), 160),
                null,
                amountMinor(order.subtotal()),
                null,
                null,
                null,
                null,
                null,
                amountMinor(order.total()),
                null,
                null,
                amountMinor(order.shipping()),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                order.lineItems().isEmpty() ? null : order.lineItems().size(),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                order.cancelledAt(),
                null,
                null,
                null,
                null,
                null,
                0,
                null,
                null);
    }

    private static List<String> candidates(String... values) {
        return Arrays.stream(values).filter(Objects::nonNull).toList();
    }

    private static ShopifyOrderCatalogImportItemResult skipped(
            String externalOrderRef,
            String name,
            ShopifyOrderCatalogImportStatus status,
            String safeSummary) {
        return new ShopifyOrderCatalogImportItemResult(
                externalOrderRef,
                name,
                null,
                status,
                safeSummary);
    }

    private static Set<String> selectedRefs(List<String> externalOrderRefs) {
        if (externalOrderRefs == null || externalOrderRefs.isEmpty()) {
            throw new IllegalArgumentException(
                    "At least one Shopify order must be selected");
        }
        if (externalOrderRefs.size() > MAX_SELECTED_ORDERS) {
            throw new IllegalArgumentException(
                    "At most 50 Shopify orders can be imported at once");
        }
        Set<String> refs = new LinkedHashSet<>();
        for (String ref : externalOrderRefs) {
            String normalized = text(ref, 160);
            if (normalized == null) {
                throw new IllegalArgumentException(
                        "Shopify order reference is invalid");
            }
            if (!refs.add(normalized)) {
                throw new IllegalArgumentException(
                        "Shopify order references must be unique");
            }
        }
        return refs;
    }

    private static String currency(ShopifyOrderPreview order) {
        String value = order.total() == null ? null : order.total().currencyCode();
        if (value == null) {
            for (ShopifyOrderLinePreview line : order.lineItems()) {
                if (line.discountedTotal() != null
                        && line.discountedTotal().currencyCode() != null) {
                    value = line.discountedTotal().currencyCode();
                    break;
                }
            }
        }
        value = upper(value);
        return value != null && value.matches("^[A-Z]{3}$") ? value : null;
    }

    private static long unitPriceMinor(ShopifyOrderLinePreview line) {
        Long direct = amountMinor(line.originalUnitPrice());
        if (direct != null) {
            return direct;
        }
        Long total = amountMinor(line.discountedTotal());
        if (total == null || line.quantity() < 1) {
            return 0L;
        }
        return total / line.quantity();
    }

    private static Long amountMinor(MoneyPreview money) {
        return money == null ? null : money.amountMinor();
    }

    private static String buyerReference(ShopifyOrderPreview order) {
        return firstNonBlank(
                order.email(),
                order.customer() == null ? null : order.customer().email(),
                order.customer() == null ? null : order.customer().phone());
    }

    private static String paymentStatus(String status) {
        return switch (upper(status) == null ? "" : upper(status)) {
            case "PAID" -> "PAID";
            case "REFUNDED" -> "REFUNDED";
            case "PARTIALLY_REFUNDED" -> "PARTIALLY_REFUNDED";
            case "PENDING", "AUTHORIZED", "PARTIALLY_PAID" -> "UNPAID";
            default -> null;
        };
    }

    private static String platformStatus(ShopifyOrderPreview order) {
        String value = firstNonBlank(order.financialStatus(),
                order.fulfillmentStatus());
        if (value == null) {
            return null;
        }
        if (order.financialStatus() != null && order.fulfillmentStatus() != null) {
            value = order.financialStatus() + "/" + order.fulfillmentStatus();
        }
        return text(value, 64);
    }

    private static Instant shippedAt(List<ShopifyFulfillmentPreview> fulfillments) {
        return fulfillments.stream()
                .filter(item -> item.trackingInfo().stream()
                        .anyMatch(tracking -> tracking.number() != null))
                .map(ShopifyFulfillmentPreview::createdAt)
                .filter(Objects::nonNull)
                .findFirst()
                .orElse(null);
    }

    private static String trackingCompany(
            List<ShopifyFulfillmentPreview> fulfillments) {
        ShopifyTrackingPreview tracking = firstTracking(fulfillments);
        return tracking == null ? null : text(tracking.company(), 80);
    }

    private static ShopifyTrackingPreview firstTracking(
            List<ShopifyFulfillmentPreview> fulfillments) {
        return fulfillments.stream()
                .flatMap(fulfillment -> fulfillment.trackingInfo().stream())
                .filter(tracking -> tracking.number() != null
                        || tracking.company() != null)
                .findFirst()
                .orElse(null);
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            String normalized = text(value, 1_000);
            if (normalized != null) {
                return normalized;
            }
        }
        return null;
    }

    private static String text(String value, int maxLength) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String normalized = value.replaceAll("[\\r\\n\\t]+", " ").strip();
        if (normalized.length() > maxLength) {
            return normalized.substring(0, maxLength);
        }
        return normalized;
    }

    private static String upper(String value) {
        String normalized = text(value, 80);
        return normalized == null ? null : normalized.toUpperCase(Locale.ROOT);
    }

    private static String idempotencyKey(UUID shopId, String externalOrderRef) {
        return "shopify." + sha256(shopId + "\n" + externalOrderRef)
                .substring(0, 56);
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    public record ShopifyOrderCatalogImportResult(
            int requestedCount,
            long importedCount,
            long skippedCount,
            List<ShopifyOrderCatalogImportItemResult> items) {
        public ShopifyOrderCatalogImportResult {
            items = List.copyOf(items);
        }
    }

    public record ShopifyOrderCatalogImportItemResult(
            String externalOrderRef,
            String name,
            UUID orderId,
            ShopifyOrderCatalogImportStatus status,
            String safeSummary) {
    }

    public enum ShopifyOrderCatalogImportStatus {
        IMPORTED,
        SKIPPED_DUPLICATE,
        SKIPPED_NOT_IN_PAGE,
        SKIPPED_INVALID_ORDER,
        SKIPPED_CONFLICT
    }
}
