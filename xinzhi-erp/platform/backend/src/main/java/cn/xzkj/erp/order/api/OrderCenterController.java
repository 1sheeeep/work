package cn.xzkj.erp.order.api;

import java.net.URI;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.order.api.OrderDtos.CreateOrderRequest;
import cn.xzkj.erp.order.api.OrderDtos.DashboardSummaryResponse;
import cn.xzkj.erp.order.api.OrderDtos.OrderResponse;
import cn.xzkj.erp.order.api.OrderDtos.OrderSummaryResponse;
import cn.xzkj.erp.order.api.OrderDtos.SkuMatchQueueItemResponse;
import cn.xzkj.erp.order.api.OrderDtos.ShopifyShippingAddressUpdateRequest;
import cn.xzkj.erp.order.api.OrderDtos.UpdateOrderStatusRequest;
import cn.xzkj.erp.order.api.OrderDtos.UpdateLineSkuMatchRequest;
import cn.xzkj.erp.order.api.OrderDtos.UpdateOrderProfileRequest;
import cn.xzkj.erp.order.domain.OrderPermissionCodes;
import cn.xzkj.erp.order.domain.OrderStatus;
import cn.xzkj.erp.order.domain.OrderQueryContracts.ConditionField;
import cn.xzkj.erp.order.domain.OrderQueryContracts.ConditionLogic;
import cn.xzkj.erp.order.domain.OrderQueryContracts.ConditionOperator;
import cn.xzkj.erp.order.domain.OrderQueryContracts.ListStage;
import cn.xzkj.erp.order.domain.OrderQueryContracts.SortDirection;
import cn.xzkj.erp.order.domain.OrderQueryContracts.SortField;
import cn.xzkj.erp.order.domain.OrderQueryContracts.TimeField;
import cn.xzkj.erp.order.service.OrderCenterService;
import cn.xzkj.erp.order.service.OrderCenterService.CreateLineCommand;
import cn.xzkj.erp.order.service.OrderCenterService.CreateOrderCommand;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.platform.api.PageEnvelope;
import cn.xzkj.erp.order.repository.OrderListQueryRepository;
import cn.xzkj.erp.order.repository.OrderListQueryRepository.Query;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService;
import cn.xzkj.erp.order.service.OrderShopifyCatalogPreviewService.ShopifyOrderCatalogPreview;
import cn.xzkj.erp.order.service.OrderShopifyCatalogImportService;
import cn.xzkj.erp.order.service.OrderShopifyCatalogImportService.ShopifyOrderCatalogImportResult;
import cn.xzkj.erp.order.service.OrderShopifyShippingAddressService;
import cn.xzkj.erp.order.service.OrderShopifyShippingAddressService.ShippingAddressCommand;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/order-center")
public class OrderCenterController {
    private static final int MAX_PAGE_SIZE = 200;
    private static final Pattern REQUEST_ID = Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");
    private final OrderCenterService service;
    private final OrderListQueryRepository listQueryRepository;
    private final OrderShopifyCatalogPreviewService shopifyCatalogPreviewService;
    private final OrderShopifyCatalogImportService shopifyCatalogImportService;
    private final OrderShopifyShippingAddressService shopifyShippingAddressService;

    public OrderCenterController(OrderCenterService service,
            OrderListQueryRepository listQueryRepository,
            OrderShopifyCatalogPreviewService shopifyCatalogPreviewService,
            OrderShopifyCatalogImportService shopifyCatalogImportService,
            OrderShopifyShippingAddressService shopifyShippingAddressService) {
        this.service = service;
        this.listQueryRepository = listQueryRepository;
        this.shopifyCatalogPreviewService = shopifyCatalogPreviewService;
        this.shopifyCatalogImportService = shopifyCatalogImportService;
        this.shopifyShippingAddressService = shopifyShippingAddressService;
    }

    @PostMapping("/orders")
    @PreAuthorize("hasAuthority('" + OrderPermissionCodes.WRITE + "')")
    public ResponseEntity<OrderResponse> createOrder(@AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody CreateOrderRequest request, HttpServletRequest servletRequest) {
        CreateOrderCommand command = new CreateOrderCommand(request.shopId(), request.externalOrderRef(),
                request.idempotencyKey(), request.currency(), request.buyerReference(), request.placedAt(),
                request.warehouseId(),
                OrderDtos.toDomain(
                        request.operational(), request.warehouseId()),
                OrderDtos.toDomain(request.profile()),
                request.lines().stream().map(line -> new CreateLineCommand(line.skuId(),
                        line.externalListingRef(), line.externalVariantRef(), line.externalLineRef(),
                        line.titleSnapshot(), line.quantity(), line.unitPriceMinor(), line.currency())).toList());
        OrderResponse response = OrderResponse.from(service.createOrder(actor(principal, servletRequest), command));
        return ResponseEntity.created(URI.create("/api/v1/order-center/orders/" + response.id())).body(response);
    }

    @PutMapping("/orders/{orderId}/profile")
    @PreAuthorize("hasAuthority('" + OrderPermissionCodes.WRITE + "')")
    public OrderResponse updateProfile(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID orderId,
            @Valid @RequestBody UpdateOrderProfileRequest request,
            HttpServletRequest servletRequest) {
        return OrderResponse.from(service.updateProfile(
                actor(principal, servletRequest), orderId, request.version(),
                request.profileVersion(), request.warehouseId(),
                OrderDtos.toDomain(
                        request.operational(), request.warehouseId()),
                OrderDtos.toDomain(request.profile())));
    }

    @PutMapping("/orders/{orderId}/shopify/shipping-address")
    @PreAuthorize("hasAuthority('" + OrderPermissionCodes.WRITE + "')")
    public ShopifyShippingAddressUpdateResponse updateShopifyShippingAddress(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID orderId,
            @Valid @RequestBody ShopifyShippingAddressUpdateRequest request,
            HttpServletRequest servletRequest) {
        var address = request.address();
        var result = shopifyShippingAddressService.update(
                actor(principal, servletRequest),
                orderId,
                new ShippingAddressCommand(
                        request.version(), request.profileVersion(),
                        request.idempotencyKey(), address.firstName(),
                        address.lastName(), address.company(),
                        address.address1(), address.address2(), address.city(),
                        address.provinceCode(), address.countryCode(),
                        address.zip(), address.phone()));
        return new ShopifyShippingAddressUpdateResponse(
                OrderResponse.from(result.order()),
                result.synchronizedAt(), result.replayed());
    }

    @GetMapping("/orders")
    @PreAuthorize("hasAuthority('" + OrderPermissionCodes.READ + "')")
    public PageEnvelope<OrderSummaryResponse> listOrders(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) UUID shopId,
            @RequestParam(required = false) UUID platformId,
            @RequestParam(required = false) UUID warehouseId,
            @RequestParam(required = false) UUID locationId,
            @RequestParam(required = false) OrderStatus status,
            @RequestParam(required = false) ListStage stage,
            @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(required = false) @Size(max = 100) String skuKeyword,
            @RequestParam(required = false)
            @jakarta.validation.constraints.Pattern(
                    regexp = "UNPAID|PAID|PARTIALLY_REFUNDED|REFUNDED") String paymentStatus,
            @RequestParam(required = false) @Size(max = 64) String platformStatus,
            @RequestParam(required = false)
            @jakarta.validation.constraints.Pattern(regexp = "^[A-Z]{2}$") String countryCode,
            @RequestParam(required = false) @Size(max = 32) String trackingStatus,
            @RequestParam(required = false) @Size(max = 80) String logisticsChannel,
            @RequestParam(required = false)
            @jakarta.validation.constraints.Pattern(regexp = "^[A-Z]{3}$") String currency,
            @RequestParam(required = false) Boolean printed,
            @RequestParam(required = false) Boolean reshipment,
            @RequestParam(required = false) @Size(max = 80) String fixedCategory,
            @RequestParam(required = false) @Size(max = 80) String customCategory,
            @RequestParam(required = false) @Size(max = 80) String customerCategory,
            @RequestParam(required = false) UUID pickerUserId,
            @RequestParam(required = false) UUID shipperUserId,
            @RequestParam(required = false) UUID salespersonUserId,
            @RequestParam(required = false) UUID purchaserUserId,
            @RequestParam(required = false) UUID developerUserId,
            @RequestParam(required = false) UUID managerUserId,
            @RequestParam(required = false) @Size(max = 160) String supplierReference,
            @RequestParam(required = false) @Size(max = 120) String parentProductCategory,
            @RequestParam(required = false) @Size(max = 120) String childProductCategory,
            @RequestParam(required = false) @Size(max = 40) String productStatus,
            @RequestParam(required = false) @Size(max = 160) String extendedAttribute,
            @RequestParam(required = false) @Min(1) Integer minProductKinds,
            @RequestParam(required = false) @Min(1) Integer maxProductKinds,
            @RequestParam(required = false) @Min(0) Long minAmountMinor,
            @RequestParam(required = false) @Min(0) Long maxAmountMinor,
            @RequestParam(required = false) BigDecimal minWeightGrams,
            @RequestParam(required = false) BigDecimal maxWeightGrams,
            @RequestParam(required = false) Instant placedFrom,
            @RequestParam(required = false) Instant placedTo,
            @RequestParam(required = false) Instant paidFrom,
            @RequestParam(required = false) Instant paidTo,
            @RequestParam(required = false) ConditionField conditionField1,
            @RequestParam(required = false) ConditionOperator conditionOperator1,
            @RequestParam(required = false) @Size(max = 200) String conditionValue1,
            @RequestParam(required = false) ConditionField conditionField2,
            @RequestParam(required = false) ConditionOperator conditionOperator2,
            @RequestParam(required = false) @Size(max = 200) String conditionValue2,
            @RequestParam(required = false) ConditionLogic conditionLogic,
            @RequestParam(required = false) TimeField timeField1,
            @RequestParam(required = false) Instant timeFrom1,
            @RequestParam(required = false) Instant timeTo1,
            @RequestParam(required = false) TimeField timeField2,
            @RequestParam(required = false) Instant timeFrom2,
            @RequestParam(required = false) Instant timeTo2,
            @RequestParam(required = false) SortField sortField,
            @RequestParam(required = false) SortDirection sortDirection,
            @RequestParam(defaultValue = "0") @Min(0) @Max(1_000_000) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest servletRequest) {
        UUID tenantId = principal.tenantId();
        if (page < 0 || page > 1_000_000 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new ConstraintViolationException(java.util.Set.of());
        }
        if (shopId != null && !listQueryRepository.shopExists(tenantId, shopId)) {
            throw new ResourceNotFoundException("Shop not found");
        }
        if (warehouseId != null && !listQueryRepository.warehouseExists(tenantId, warehouseId)) {
            throw new ResourceNotFoundException("Warehouse not found");
        }
        if ((minAmountMinor != null && maxAmountMinor != null && minAmountMinor > maxAmountMinor)
                || invalidRange(minWeightGrams, maxWeightGrams)
                || invalidRange(placedFrom, placedTo)
                || invalidRange(paidFrom, paidTo)
                || invalidRange(minProductKinds, maxProductKinds)
                || invalidRange(timeFrom1, timeTo1)
                || invalidRange(timeFrom2, timeTo2)) {
            throw new ConstraintViolationException(java.util.Set.of());
        }
        var result = service.searchOrders(actor(principal, servletRequest),
                new Query(shopId, warehouseId, status, paymentStatus, platformStatus,
                        countryCode, trackingStatus, currency, printed, reshipment,
                        minAmountMinor, maxAmountMinor, minWeightGrams, maxWeightGrams,
                        placedFrom, placedTo, paidFrom, paidTo, keyword, skuKeyword,
                        platformId, stage, logisticsChannel, fixedCategory,
                        customCategory, customerCategory, locationId,
                        pickerUserId, shipperUserId, salespersonUserId,
                        purchaserUserId, developerUserId, managerUserId,
                        supplierReference, parentProductCategory,
                        childProductCategory, productStatus, extendedAttribute,
                        minProductKinds, maxProductKinds,
                        conditionField1, conditionOperator1, conditionValue1,
                        conditionField2, conditionOperator2, conditionValue2,
                        conditionLogic, timeField1, timeFrom1, timeTo1,
                        timeField2, timeFrom2, timeTo2,
                        sortField, sortDirection),
                page, size);
        long total = result.totalElements();
        return new PageEnvelope<>(
                result.items().stream().map(OrderSummaryResponse::from).toList(),
                page, size, total, total == 0 ? 0 : (int) ((total + size - 1) / size));
    }

    @GetMapping("/sku-match-queue")
    @PreAuthorize("hasAuthority('" + OrderPermissionCodes.READ + "')")
    public PageEnvelope<SkuMatchQueueItemResponse> listSkuMatchQueue(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) UUID shopId,
            @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) @Max(1_000_000) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest servletRequest) {
        return PageEnvelope.from(
                service.listSkuMatchQueue(actor(principal, servletRequest), shopId,
                        queueKeyword(keyword), pageable(page, size)),
                SkuMatchQueueItemResponse::from);
    }

    @GetMapping("/shopify/catalog-preview")
    @PreAuthorize("hasAuthority('" + OrderPermissionCodes.READ + "')")
    public ShopifyOrderCatalogPreview previewShopifyCatalog(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam UUID shopId,
            @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit,
            @RequestParam(required = false) @Size(max = 4096) String cursor,
            @RequestParam(required = false) @Size(max = 500) String query,
            @RequestParam(defaultValue = "false") boolean historical,
            HttpServletRequest servletRequest) {
        return shopifyCatalogPreviewService.preview(
                actor(principal, servletRequest),
                shopId,
                limit,
                cursor,
                query,
                historical);
    }

    @PostMapping("/shopify/catalog-import")
    @PreAuthorize("hasAuthority('" + OrderPermissionCodes.WRITE + "')")
    public ShopifyOrderCatalogImportResult importShopifyCatalog(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ShopifyOrderCatalogImportRequest request,
            HttpServletRequest servletRequest) {
        return shopifyCatalogImportService.importSelectedOrders(
                actor(principal, servletRequest),
                request.shopId(),
                request.limit() == null ? 50 : request.limit(),
                request.cursor(),
                request.query(),
                Boolean.TRUE.equals(request.historical()),
                request.externalOrderRefs());
    }

    @GetMapping("/dashboard-summary")
    @PreAuthorize("hasAuthority('" + OrderPermissionCodes.READ + "')")
    public DashboardSummaryResponse dashboardSummary(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) UUID shopId,
            HttpServletRequest servletRequest) {
        return DashboardSummaryResponse.from(
                service.dashboardSummary(
                        actor(principal, servletRequest), shopId));
    }

    @GetMapping("/orders/{orderId}")
    @PreAuthorize("hasAuthority('" + OrderPermissionCodes.READ + "')")
    public OrderResponse getOrder(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID orderId,
            HttpServletRequest servletRequest) {
        return OrderResponse.from(
                service.getOrder(actor(principal, servletRequest), orderId));
    }

    @PutMapping("/orders/{orderId}/status")
    @PreAuthorize("hasAuthority('" + OrderPermissionCodes.WRITE + "')")
    public OrderResponse changeStatus(@AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID orderId, @Valid @RequestBody UpdateOrderStatusRequest request,
            HttpServletRequest servletRequest) {
        return OrderResponse.from(service.changeStatus(actor(principal, servletRequest), orderId,
                request.version(), request.targetStatus(), request.reason()));
    }

    @PutMapping("/orders/{orderId}/lines/{lineId}/sku-match")
    @PreAuthorize("hasAuthority('" + OrderPermissionCodes.WRITE + "')")
    public OrderResponse changeLineSkuMatch(@AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID orderId, @PathVariable UUID lineId,
            @Valid @RequestBody UpdateLineSkuMatchRequest request,
            HttpServletRequest servletRequest) {
        return OrderResponse.from(service.changeLineSkuMatch(actor(principal, servletRequest),
                orderId, lineId, request.version(), request.skuId()));
    }

    private static PageRequest pageable(int page, int size) {
        if (page < 0 || page > 1_000_000 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new ConstraintViolationException(java.util.Set.of());
        }
        return PageRequest.of(page, size);
    }

    private static <T extends Comparable<T>> boolean invalidRange(T from, T to) {
        return from != null && to != null && from.compareTo(to) > 0;
    }

    private static String queueKeyword(String keyword) {
        if (keyword != null && keyword.length() > 100) {
            throw new ConstraintViolationException(java.util.Set.of());
        }
        return keyword;
    }

    private static OrderActor actor(ErpPrincipal principal, HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId != null) {
            requestId = requestId.strip();
            if (!REQUEST_ID.matcher(requestId).matches()) { requestId = null; }
        }
        if (requestId == null) {
            requestId = UUID.randomUUID().toString();
        }
        return new OrderActor(
                principal.tenantId(),
                principal.userId(),
                principal.systemAdminId(),
                requestId,
                request.getRemoteAddr());
    }

    public record ShopifyOrderCatalogImportRequest(
            @NotNull UUID shopId,
            @Min(1) @Max(100) Integer limit,
            @Size(max = 4096) String cursor,
            @Size(max = 500) String query,
            Boolean historical,
            @NotEmpty @Size(max = 50) List<@Size(max = 160) String> externalOrderRefs) {
    }

    public record ShopifyShippingAddressUpdateResponse(
            OrderResponse order,
            Instant synchronizedAt,
            boolean replayed) {
    }
}
