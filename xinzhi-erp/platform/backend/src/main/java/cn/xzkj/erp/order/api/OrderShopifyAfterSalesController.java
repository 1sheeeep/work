package cn.xzkj.erp.order.api;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.order.domain.OrderPermissionCodes;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderShopifyAfterSalesService;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Dispute;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Money;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.MoneyBag;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnDecision;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnDeclineReason;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnRefundDutySelection;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnRefundDutyType;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnRefundLineSelection;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyReturn;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyReturnLine;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/order-center/shopify")
public class OrderShopifyAfterSalesController {

    private static final Pattern REQUEST_ID =
            Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");

    private final OrderShopifyAfterSalesService afterSales;

    public OrderShopifyAfterSalesController(
            OrderShopifyAfterSalesService afterSales) {
        this.afterSales = afterSales;
    }

    @GetMapping("/returns")
    @PreAuthorize("hasAuthority('" + OrderPermissionCodes.READ + "')")
    public ReturnPageResponse returns(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam @NotNull UUID shopId,
            @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit,
            @RequestParam(required = false) @Size(max = 4096) String cursor,
            @RequestParam(required = false) @Size(max = 500) String query) {
        var page = afterSales.returns(
                principal.tenantId(), shopId, limit, cursor, query);
        return new ReturnPageResponse(
                shopId, page.cursor(), page.hasNextPage(), page.fetchedAt(),
                page.returns().stream().map(ReturnResponse::from).toList());
    }

    @PostMapping("/returns/decision")
    @PreAuthorize("hasAuthority('" + OrderPermissionCodes.WRITE + "')")
    public ReturnDecisionResponse decideReturn(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ReturnDecisionBody body,
            HttpServletRequest request) {
        var result = afterSales.decideReturn(
                actor(principal, request), body.shopId(),
                new ChannelConnectorGateway.ReturnDecisionRequest(
                        body.externalReturnRef(), body.decision(),
                        body.decision() == ReturnDecision.DECLINE
                                ? body.declineReason() : null,
                        body.decision() == ReturnDecision.DECLINE
                                ? body.declineNote() : null,
                        body.notifyCustomer(), body.idempotencyKey()));
        return new ReturnDecisionResponse(
                result.externalReturnRef(), result.status(),
                result.recoveredFromShopify(), result.updatedAt());
    }

    @PostMapping("/returns/refund-preview")
    @PreAuthorize("hasAuthority('" + OrderPermissionCodes.WRITE + "')")
    public RefundPreviewResponse previewRefund(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody RefundPreviewBody body) {
        var result = afterSales.previewRefund(
                principal.tenantId(), body.shopId(),
                new ChannelConnectorGateway.ReturnRefundPreviewRequest(
                        body.externalReturnRef(), lines(body.lineItems()),
                        body.refundShipping(), duties(body.refundDuties())));
        return RefundPreviewResponse.from(result);
    }

    @PostMapping("/returns/refund-process")
    @PreAuthorize("hasAuthority('" + OrderPermissionCodes.WRITE + "')")
    public RefundProcessResponse processRefund(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody RefundProcessBody body,
            HttpServletRequest request) {
        var result = afterSales.processRefund(
                actor(principal, request), body.shopId(),
                new ChannelConnectorGateway.ReturnRefundProcessRequest(
                        body.externalReturnRef(), lines(body.lineItems()),
                        body.refundShipping(), duties(body.refundDuties()),
                        body.previewToken(), body.notifyCustomer(),
                        body.idempotencyKey()));
        return RefundProcessResponse.from(result);
    }

    @GetMapping("/disputes")
    @PreAuthorize("hasAuthority('" + OrderPermissionCodes.READ + "')")
    public DisputePageResponse disputes(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam @NotNull UUID shopId,
            @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit,
            @RequestParam(required = false) @Size(max = 4096) String cursor) {
        var page = afterSales.disputes(
                principal.tenantId(), shopId, limit, cursor);
        return new DisputePageResponse(
                shopId, page.cursor(), page.hasNextPage(), page.fetchedAt(),
                page.disputes().stream().map(DisputeResponse::from).toList());
    }

    private static List<ReturnRefundLineSelection> lines(
            List<RefundLineBody> lines) {
        return lines.stream()
                .map(item -> new ReturnRefundLineSelection(
                        item.externalReturnLineRef(), item.quantity()))
                .toList();
    }

    private static List<ReturnRefundDutySelection> duties(
            List<RefundDutyBody> duties) {
        return duties.stream()
                .map(item -> new ReturnRefundDutySelection(
                        item.externalDutyRef(), item.refundType()))
                .toList();
    }

    private static OrderActor actor(
            ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId != null) {
            requestId = requestId.strip();
        }
        if (requestId == null || !REQUEST_ID.matcher(requestId).matches()) {
            requestId = UUID.randomUUID().toString();
        }
        return new OrderActor(
                principal.tenantId(), principal.userId(),
                principal.systemAdminId(), requestId,
                request.getRemoteAddr());
    }

    public record ReturnDecisionBody(
            @NotNull UUID shopId,
            @NotBlank @Size(max = 160) String externalReturnRef,
            @NotNull ReturnDecision decision,
            ReturnDeclineReason declineReason,
            @Size(max = 500) String declineNote,
            boolean notifyCustomer,
            @NotBlank @Size(max = 100) String idempotencyKey) {
    }

    public record RefundLineBody(
            @NotBlank @Size(max = 160) String externalReturnLineRef,
            @Min(1) @Max(1_000_000) int quantity) {
    }

    public record RefundDutyBody(
            @NotBlank @Size(max = 160) String externalDutyRef,
            @NotNull ReturnRefundDutyType refundType) {
    }

    public record RefundPreviewBody(
            @NotNull UUID shopId,
            @NotBlank @Size(max = 160) String externalReturnRef,
            @NotEmpty @Size(max = 100) List<@Valid RefundLineBody> lineItems,
            boolean refundShipping,
            @Size(max = 100) List<@Valid RefundDutyBody> refundDuties) {
        public RefundPreviewBody {
            refundDuties = refundDuties == null ? List.of() : List.copyOf(refundDuties);
        }
    }

    public record RefundProcessBody(
            @NotNull UUID shopId,
            @NotBlank @Size(max = 160) String externalReturnRef,
            @NotEmpty @Size(max = 100) List<@Valid RefundLineBody> lineItems,
            boolean refundShipping,
            @Size(max = 100) List<@Valid RefundDutyBody> refundDuties,
            @NotBlank @Size(max = 4096) String previewToken,
            boolean notifyCustomer,
            @NotBlank @Size(max = 100) String idempotencyKey) {
        public RefundProcessBody {
            refundDuties = refundDuties == null ? List.of() : List.copyOf(refundDuties);
        }
    }

    public record ReturnPageResponse(
            UUID shopId,
            String cursor,
            boolean hasNextPage,
            Instant fetchedAt,
            List<ReturnResponse> returns) {
    }

    public record ReturnResponse(
            String externalReturnRef,
            String name,
            String externalOrderRef,
            String orderName,
            String status,
            Instant createdAt,
            Instant closedAt,
            Instant requestApprovedAt,
            int totalQuantity,
            List<ReturnLineResponse> lineItems) {
        static ReturnResponse from(ShopifyReturn value) {
            return new ReturnResponse(
                    value.externalReturnRef(), value.name(),
                    value.externalOrderRef(), value.orderName(), value.status(),
                    value.createdAt(), value.closedAt(), value.requestApprovedAt(),
                    value.totalQuantity(),
                    value.lineItems().stream().map(ReturnLineResponse::from).toList());
        }
    }

    public record ReturnLineResponse(
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
        static ReturnLineResponse from(ShopifyReturnLine value) {
            return new ReturnLineResponse(
                    value.externalReturnLineRef(),
                    value.externalFulfillmentLineRef(),
                    value.externalOrderLineRef(), value.name(), value.sku(),
                    value.quantity(), value.processableQuantity(),
                    value.processedQuantity(), value.refundableQuantity(),
                    value.refundedQuantity(), value.reasonHandle(), value.reasonName());
        }
    }

    public record ReturnDecisionResponse(
            String externalReturnRef,
            String status,
            boolean recoveredFromShopify,
            Instant updatedAt) {
    }

    public record MoneyResponse(String amount, String currencyCode) {
        static MoneyResponse from(Money value) {
            return value == null ? null
                    : new MoneyResponse(value.amount(), value.currencyCode());
        }
    }

    public record MoneyBagResponse(
            MoneyResponse shopMoney,
            MoneyResponse presentmentMoney) {
        static MoneyBagResponse from(MoneyBag value) {
            return value == null ? null
                    : new MoneyBagResponse(
                            MoneyResponse.from(value.shopMoney()),
                            MoneyResponse.from(value.presentmentMoney()));
        }
    }

    public record RefundPreviewResponse(
            String externalReturnRef,
            String state,
            List<RefundLineBody> lineItems,
            boolean refundShipping,
            List<RefundDutyBody> refundDuties,
            MoneyBagResponse shippingAmount,
            MoneyBagResponse dutyAmount,
            MoneyBagResponse refundAmount,
            MoneyBagResponse maximumRefundable,
            String previewToken,
            Instant expiresAt,
            Instant fetchedAt) {
        static RefundPreviewResponse from(
                ChannelConnectorGateway.ReturnRefundPreview value) {
            return new RefundPreviewResponse(
                    value.externalReturnRef(), value.state().name(),
                    value.lineItems().stream()
                            .map(item -> new RefundLineBody(
                                    item.externalReturnLineRef(), item.quantity()))
                            .toList(),
                    value.refundShipping(),
                    value.refundDuties().stream()
                            .map(item -> new RefundDutyBody(
                                    item.externalDutyRef(), item.refundType()))
                            .toList(),
                    MoneyBagResponse.from(value.shippingAmount()),
                    MoneyBagResponse.from(value.dutyAmount()),
                    MoneyBagResponse.from(value.refundAmount()),
                    MoneyBagResponse.from(value.maximumRefundable()),
                    value.previewToken(), value.expiresAt(), value.fetchedAt());
        }
    }

    public record RefundProcessResponse(
            String externalReturnRef,
            String returnStatus,
            String outcome,
            MoneyBagResponse refundAmount,
            boolean recoveredFromShopify,
            Instant updatedAt) {
        static RefundProcessResponse from(
                ChannelConnectorGateway.ReturnRefundProcessResult value) {
            return new RefundProcessResponse(
                    value.externalReturnRef(), value.returnStatus(),
                    value.outcome().name(), MoneyBagResponse.from(value.refundAmount()),
                    value.recoveredFromShopify(), value.updatedAt());
        }
    }

    public record DisputePageResponse(
            UUID shopId,
            String cursor,
            boolean hasNextPage,
            Instant fetchedAt,
            List<DisputeResponse> disputes) {
    }

    public record DisputeResponse(
            String externalDisputeRef,
            String externalOrderRef,
            String orderName,
            String status,
            String type,
            String reason,
            String networkReasonCode,
            MoneyResponse amount,
            Instant initiatedAt,
            Instant evidenceDueBy,
            Instant evidenceSentOn,
            Instant finalizedOn) {
        static DisputeResponse from(Dispute value) {
            return new DisputeResponse(
                    value.externalDisputeRef(), value.externalOrderRef(),
                    value.orderName(), value.status(), value.type(), value.reason(),
                    value.networkReasonCode(), MoneyResponse.from(value.amount()),
                    value.initiatedAt(), value.evidenceDueBy(),
                    value.evidenceSentOn(), value.finalizedOn());
        }
    }
}
