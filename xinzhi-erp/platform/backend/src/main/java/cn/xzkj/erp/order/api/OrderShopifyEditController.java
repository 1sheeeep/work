package cn.xzkj.erp.order.api;

import java.time.Instant;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.order.api.OrderDtos.OrderResponse;
import cn.xzkj.erp.order.domain.OrderShopifyEditPermissionCodes;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderShopifyCustomItemAddService;
import cn.xzkj.erp.order.service.OrderShopifyCancellationService;
import cn.xzkj.erp.order.service.OrderShopifyLineQuantityService;
import cn.xzkj.erp.order.service.OrderShopifyLineDiscountService;
import cn.xzkj.erp.order.service.OrderShopifyLineQuantityService.UpdateCommand;
import cn.xzkj.erp.order.service.OrderShopifyVariantAddService;
import cn.xzkj.erp.order.service.OrderShopifyVariantAddService.AddCommand;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderLineDiscountType;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderCancellationReason;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@RestController
@RequestMapping("/api/v1/order-center/orders")
public class OrderShopifyEditController {

    private static final Pattern REQUEST_ID =
            Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");

    private final OrderShopifyLineQuantityService lineQuantity;
    private final OrderShopifyVariantAddService variantAdd;
    private final OrderShopifyCustomItemAddService customItemAdd;
    private final OrderShopifyLineDiscountService lineDiscount;
    private final OrderShopifyCancellationService cancellation;

    public OrderShopifyEditController(
            OrderShopifyLineQuantityService lineQuantity,
            OrderShopifyVariantAddService variantAdd,
            OrderShopifyCustomItemAddService customItemAdd,
            OrderShopifyLineDiscountService lineDiscount,
            OrderShopifyCancellationService cancellation) {
        this.lineQuantity = lineQuantity;
        this.variantAdd = variantAdd;
        this.customItemAdd = customItemAdd;
        this.lineDiscount = lineDiscount;
        this.cancellation = cancellation;
    }

    @PostMapping("/{orderId}/shopify/variants")
    @PreAuthorize("hasAuthority('"
            + OrderShopifyEditPermissionCodes.WRITE
            + "') and hasAuthority('products.listing.read')")
    public VariantAddResponse addVariant(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID orderId,
            @Valid @RequestBody VariantAddRequest request,
            HttpServletRequest servletRequest) {
        var result = variantAdd.add(
                actor(principal, servletRequest), orderId,
                new AddCommand(
                        request.listingId(), request.quantity(),
                        request.notifyCustomer(),
                        request.idempotencyKey()));
        return new VariantAddResponse(
                OrderResponse.from(result.order()), result.lineId(),
                result.externalLineRef(),
                result.recoveredFromShopify(), result.replayed(),
                result.unitPriceMinor(), result.totalAmountMinor(),
                result.currency(), result.synchronizedAt());
    }

    @PostMapping("/{orderId}/shopify/custom-items")
    @PreAuthorize("hasAuthority('"
            + OrderShopifyEditPermissionCodes.WRITE + "')")
    public CustomItemAddResponse addCustomItem(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID orderId,
            @Valid @RequestBody CustomItemAddRequest request,
            HttpServletRequest servletRequest) {
        var result = customItemAdd.add(
                actor(principal, servletRequest), orderId,
                new OrderShopifyCustomItemAddService.AddCommand(
                        request.title(), request.unitPriceMinor(),
                        request.quantity(), request.requiresShipping(),
                        request.taxable(), request.notifyCustomer(),
                        request.idempotencyKey()));
        return new CustomItemAddResponse(
                OrderResponse.from(result.order()), result.lineId(),
                result.externalLineRef(),
                result.recoveredFromShopify(), result.replayed(),
                result.unitPriceMinor(), result.totalAmountMinor(),
                result.currency(), result.synchronizedAt());
    }

    @PostMapping("/{orderId}/shopify/line-discounts")
    @PreAuthorize("hasAuthority('"
            + OrderShopifyEditPermissionCodes.WRITE + "')")
    public LineDiscountResponse addLineDiscount(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID orderId,
            @Valid @RequestBody LineDiscountRequest request,
            HttpServletRequest servletRequest) {
        var result = lineDiscount.add(
                actor(principal, servletRequest), orderId,
                new OrderShopifyLineDiscountService.DiscountCommand(
                        request.lineId(), request.description(),
                        request.discountType(), request.fixedValueMinor(),
                        request.percentBasisPoints(), request.notifyCustomer(),
                        request.idempotencyKey()));
        return new LineDiscountResponse(
                OrderResponse.from(result.order()), result.lineId(),
                result.recoveredFromShopify(), result.replayed(),
                result.discountTotalMinor(), result.totalAmountMinor(),
                result.currency(), result.synchronizedAt());
    }

    @PostMapping("/{orderId}/shopify/cancellation")
    @PreAuthorize("hasAuthority('"
            + OrderShopifyEditPermissionCodes.WRITE + "')")
    public CancellationResponse cancelOrder(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID orderId,
            @Valid @RequestBody CancellationRequest request,
            HttpServletRequest servletRequest) {
        var result = cancellation.cancel(
                actor(principal, servletRequest), orderId,
                new OrderShopifyCancellationService.CancellationCommand(
                        request.reason(), request.staffNote(),
                        request.refundOriginalPaymentMethods(),
                        request.restock(), request.notifyCustomer(),
                        request.idempotencyKey()));
        return new CancellationResponse(
                OrderResponse.from(result.order()),
                result.recoveredFromShopify(), result.replayed(),
                result.cancelledAt(), result.jobId(),
                result.synchronizedAt());
    }

    @PutMapping("/{orderId}/shopify/line-quantity")
    @PreAuthorize("hasAuthority('"
            + OrderShopifyEditPermissionCodes.WRITE + "')")
    public LineQuantityUpdateResponse updateLineQuantity(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID orderId,
            @Valid @RequestBody LineQuantityUpdateRequest request,
            HttpServletRequest servletRequest) {
        var result = lineQuantity.update(
                actor(principal, servletRequest), orderId,
                new UpdateCommand(
                        request.lineId(), request.expectedQuantity(),
                        request.quantity(), request.restock(),
                        request.notifyCustomer(), request.idempotencyKey()));
        return new LineQuantityUpdateResponse(
                OrderResponse.from(result.order()),
                result.recoveredFromShopify(), result.replayed(),
                result.totalAmountMinor(), result.currency(),
                result.synchronizedAt());
    }

    private static OrderActor actor(
            ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId != null) {
            requestId = requestId.strip();
            if (!REQUEST_ID.matcher(requestId).matches()) {
                requestId = null;
            }
        }
        if (requestId == null) {
            requestId = UUID.randomUUID().toString();
        }
        return new OrderActor(
                principal.tenantId(), principal.userId(),
                principal.systemAdminId(), requestId,
                request.getRemoteAddr());
    }

    public record LineQuantityUpdateRequest(
            @NotNull UUID lineId,
            @Min(1) @Max(100_000) int expectedQuantity,
            @Min(0) @Max(100_000) int quantity,
            boolean restock,
            boolean notifyCustomer,
            @NotBlank @Size(max = 100) String idempotencyKey) {
    }

    public record LineQuantityUpdateResponse(
            OrderResponse order,
            boolean recoveredFromShopify,
            boolean replayed,
            Long totalAmountMinor,
            String currency,
            Instant synchronizedAt) {
    }

    public record VariantAddRequest(
            @NotNull UUID listingId,
            @Min(1) @Max(100_000) int quantity,
            boolean notifyCustomer,
            @NotBlank @Size(max = 100) String idempotencyKey) {
    }

    public record VariantAddResponse(
            OrderResponse order,
            UUID lineId,
            String externalLineRef,
            boolean recoveredFromShopify,
            boolean replayed,
            Long unitPriceMinor,
            Long totalAmountMinor,
            String currency,
            Instant synchronizedAt) {
    }

    public record CustomItemAddRequest(
            @NotBlank @Size(max = 255) String title,
            @Min(0) long unitPriceMinor,
            @Min(1) @Max(100_000) int quantity,
            boolean requiresShipping,
            boolean taxable,
            boolean notifyCustomer,
            @NotBlank @Size(max = 100) String idempotencyKey) {
    }

    public record CustomItemAddResponse(
            OrderResponse order,
            UUID lineId,
            String externalLineRef,
            boolean recoveredFromShopify,
            boolean replayed,
            Long unitPriceMinor,
            Long totalAmountMinor,
            String currency,
            Instant synchronizedAt) {
    }

    public record LineDiscountRequest(
            @NotNull UUID lineId,
            @NotBlank @Size(max = 255) String description,
            @NotNull OrderLineDiscountType discountType,
            @Min(1) Long fixedValueMinor,
            @Min(1) @Max(10_000) Integer percentBasisPoints,
            boolean notifyCustomer,
            @NotBlank @Size(max = 100) String idempotencyKey) {
    }

    public record LineDiscountResponse(
            OrderResponse order,
            UUID lineId,
            boolean recoveredFromShopify,
            boolean replayed,
            Long discountTotalMinor,
            Long totalAmountMinor,
            String currency,
                Instant synchronizedAt) {
    }

    public record CancellationRequest(
            @NotNull OrderCancellationReason reason,
            @Size(max = 180) String staffNote,
            boolean refundOriginalPaymentMethods,
            boolean restock,
            boolean notifyCustomer,
            @NotBlank @Size(max = 64) String idempotencyKey) {
    }

    public record CancellationResponse(
            OrderResponse order,
            boolean recoveredFromShopify,
            boolean replayed,
            Instant cancelledAt,
            String jobId,
            Instant synchronizedAt) {
    }
}
