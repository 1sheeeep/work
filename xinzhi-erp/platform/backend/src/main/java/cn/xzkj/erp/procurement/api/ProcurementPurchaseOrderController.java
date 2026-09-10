package cn.xzkj.erp.procurement.api;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.PageEnvelope;
import cn.xzkj.erp.procurement.api.ProcurementPurchaseOrderDtos.FollowUpExportRequest;
import cn.xzkj.erp.procurement.api.ProcurementPurchaseOrderDtos.FollowUpExportResponse;
import cn.xzkj.erp.procurement.api.ProcurementPurchaseOrderDtos.DirectPurchaseOrderCreateRequest;
import cn.xzkj.erp.procurement.api.ProcurementPurchaseOrderDtos.PurchaseOrderCreateRequest;
import cn.xzkj.erp.procurement.api.ProcurementPurchaseOrderDtos.PurchaseOrderExportRequest;
import cn.xzkj.erp.procurement.api.ProcurementPurchaseOrderDtos.PurchaseOrderExportResponse;
import cn.xzkj.erp.procurement.api.ProcurementPurchaseOrderDtos.PurchaseOrderResponse;
import cn.xzkj.erp.procurement.api.ProcurementPurchaseOrderDtos.PurchaseOrderReceiptRequest;
import cn.xzkj.erp.procurement.api.ProcurementPurchaseOrderDtos.PurchaseOrderReceiptResponse;
import cn.xzkj.erp.procurement.api.ProcurementPurchaseOrderDtos.PurchaseOrderReviewRequest;
import cn.xzkj.erp.procurement.api.ProcurementPurchaseOrderDtos.PurchaseReturnCreateRequest;
import cn.xzkj.erp.procurement.api.ProcurementPurchaseOrderDtos.PurchaseReturnResponse;
import cn.xzkj.erp.procurement.api.ProcurementPurchaseOrderDtos.ReturnableOrderResponse;
import cn.xzkj.erp.procurement.api.ProcurementPurchaseOrderDtos.ReceiptLedgerExportRequest;
import cn.xzkj.erp.procurement.api.ProcurementPurchaseOrderDtos.ReceiptLedgerExportResponse;
import cn.xzkj.erp.procurement.api.ProcurementPurchaseOrderDtos.SupplierOptionResponse;
import cn.xzkj.erp.procurement.domain.ProcurementPurchaseOrderSearchField;
import cn.xzkj.erp.procurement.domain.ProcurementPurchaseOrderStatus;
import cn.xzkj.erp.procurement.domain.ProcurementReceiptSort;
import cn.xzkj.erp.procurement.domain.ProcurementReturnSearchField;
import cn.xzkj.erp.procurement.service.ProcurementPlanActor;
import cn.xzkj.erp.procurement.service.ProcurementPurchaseOrderService;
import cn.xzkj.erp.procurement.service.ProcurementPurchaseReturnService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.net.URI;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/v1/procurement/orders")
public class ProcurementPurchaseOrderController {
    private static final int MAX_PAGE_SIZE = 200;
    private final ProcurementPurchaseOrderService service;
    private final ProcurementPurchaseReturnService returnService;

    public ProcurementPurchaseOrderController(
            ProcurementPurchaseOrderService service,
            ProcurementPurchaseReturnService returnService) {
        this.service = service;
        this.returnService = returnService;
    }

    @GetMapping("/returns")
    @PreAuthorize("hasAuthority('procurement.read')")
    public PageEnvelope<PurchaseReturnResponse> listReturns(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(defaultValue = "RETURN_NO")
            ProcurementReturnSearchField searchField,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(required = false) Instant returnedFrom,
            @RequestParam(required = false) Instant returnedTo,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(MAX_PAGE_SIZE)
            int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                returnService.list(
                        actor(principal, request, null), searchField, keyword,
                        returnedFrom, returnedTo, pageable(page, size)),
                PurchaseReturnResponse::from);
    }

    @GetMapping("/returns/references/orders")
    @PreAuthorize("hasAuthority('procurement.read')")
    public PageEnvelope<ReturnableOrderResponse> returnableOrders(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(MAX_PAGE_SIZE)
            int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                returnService.listReturnableOrders(
                        actor(principal, request, null), keyword,
                        pageable(page, size)),
                ReturnableOrderResponse::from);
    }

    @PostMapping("/returns")
    @PreAuthorize("hasAuthority('procurement.write')")
    public ResponseEntity<PurchaseReturnResponse> createReturn(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestHeader("X-Request-Id") @Size(min = 1, max = 100)
            @Pattern(regexp = "^[A-Za-z0-9._:-]+$") String requestId,
            @Valid @RequestBody PurchaseReturnCreateRequest body,
            HttpServletRequest request) {
        PurchaseReturnResponse response = PurchaseReturnResponse.from(
                returnService.create(
                        actor(principal, request, requestId), body.commandId(),
                        body.purchaseOrderId(), body.expectedOrderVersion(),
                        body.quantity(), body.reason()));
        return ResponseEntity.created(URI.create(
                        "/api/v1/procurement/orders/returns/"
                                + response.purchaseReturnId()))
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    @GetMapping
    @PreAuthorize("hasAuthority('procurement.read')")
    public PageEnvelope<PurchaseOrderResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) UUID warehouseId,
            @RequestParam(required = false) UUID supplierId,
            @RequestParam(required = false) ProcurementPurchaseOrderStatus status,
            @RequestParam(defaultValue = "false") boolean receivableOnly,
            @RequestParam(defaultValue = "PURCHASE_NO")
            ProcurementPurchaseOrderSearchField searchField,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(required = false) Instant createdFrom,
            @RequestParam(required = false) Instant createdTo,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                service.list(
                        actor(principal, request, null), warehouseId, supplierId,
                        status, receivableOnly,
                        searchField, keyword, createdFrom, createdTo,
                        pageable(page, size)),
                PurchaseOrderResponse::from);
    }

    @GetMapping("/{purchaseOrderId}")
    @PreAuthorize("hasAuthority('procurement.read')")
    public PurchaseOrderResponse get(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID purchaseOrderId,
            HttpServletRequest request) {
        return PurchaseOrderResponse.from(service.get(
                actor(principal, request, null), purchaseOrderId));
    }

    @PostMapping("/follow-up/exports")
    @PreAuthorize("hasAuthority('procurement.read')")
    public FollowUpExportResponse exportFollowUp(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody FollowUpExportRequest body,
            HttpServletRequest request) {
        var result = service.exportFollowUpCsv(
                actor(principal, request, null), body.searchField(),
                body.keyword(), body.createdFrom(), body.createdTo());
        return new FollowUpExportResponse(
                result.filename(), result.mediaType(), result.rowCount(),
                result.content());
    }

    @PostMapping("/exports")
    @PreAuthorize("hasAuthority('procurement.read')")
    public PurchaseOrderExportResponse export(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody PurchaseOrderExportRequest body,
            HttpServletRequest request) {
        var result = service.exportCsv(
                actor(principal, request, null), body.status(),
                body.receivableOnly(), body.searchField(), body.keyword(),
                body.createdFrom(), body.createdTo());
        return new PurchaseOrderExportResponse(
                result.filename(), result.mediaType(), result.rowCount(),
                result.content());
    }

    @PostMapping
    @PreAuthorize("hasAuthority('procurement.write')")
    public ResponseEntity<PurchaseOrderResponse> create(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestHeader("X-Request-Id") @Size(min = 1, max = 100)
            @Pattern(regexp = "^[A-Za-z0-9._:-]+$") String requestId,
            @Valid @RequestBody PurchaseOrderCreateRequest body,
            HttpServletRequest request) {
        PurchaseOrderResponse response = PurchaseOrderResponse.from(service.create(
                actor(principal, request, requestId), body.commandId(),
                body.planId(), body.expectedPlanVersion(), body.supplierId(),
                body.orderNote()));
        return ResponseEntity.created(URI.create(
                        "/api/v1/procurement/orders/" + response.purchaseOrderId()))
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    @PostMapping("/direct")
    @PreAuthorize("hasAuthority('procurement.write')")
    public ResponseEntity<PurchaseOrderResponse> createDirect(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestHeader("X-Request-Id") @Size(min = 1, max = 100)
            @Pattern(regexp = "^[A-Za-z0-9._:-]+$") String requestId,
            @Valid @RequestBody DirectPurchaseOrderCreateRequest body,
            HttpServletRequest request) {
        PurchaseOrderResponse response = PurchaseOrderResponse.from(
                service.createDirect(
                        actor(principal, request, requestId), body.commandId(),
                        body.supplierId(), body.skuId(), body.warehouseId(),
                        body.locationId(), body.quantity(), body.orderNote()));
        return ResponseEntity.created(URI.create(
                        "/api/v1/procurement/orders/" + response.purchaseOrderId()))
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    @PostMapping("/{purchaseOrderId}/receipts")
    @PreAuthorize("hasAuthority('procurement.write')")
    public ResponseEntity<PurchaseOrderResponse> receive(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID purchaseOrderId,
            @RequestHeader("X-Request-Id") @Size(min = 1, max = 100)
            @Pattern(regexp = "^[A-Za-z0-9._:-]+$") String requestId,
            @Valid @RequestBody PurchaseOrderReceiptRequest body,
            HttpServletRequest request) {
        PurchaseOrderResponse response = PurchaseOrderResponse.from(service.receive(
                actor(principal, request, requestId), purchaseOrderId,
                body.commandId(), body.expectedVersion(), body.quantity()));
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    @PostMapping("/{purchaseOrderId}/review")
    @PreAuthorize("hasAuthority('procurement.write')")
    public ResponseEntity<PurchaseOrderResponse> review(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID purchaseOrderId,
            @RequestHeader("X-Request-Id") @Size(min = 1, max = 100)
            @Pattern(regexp = "^[A-Za-z0-9._:-]+$") String requestId,
            @Valid @RequestBody PurchaseOrderReviewRequest body,
            HttpServletRequest request) {
        PurchaseOrderResponse response = PurchaseOrderResponse.from(service.review(
                actor(principal, request, requestId), purchaseOrderId,
                body.expectedVersion(), body.approved(), body.reviewNote()));
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    @GetMapping("/receipts")
    @PreAuthorize("hasAuthority('procurement.read')")
    public PageEnvelope<PurchaseOrderReceiptResponse> listReceipts(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) @Size(max = 120)
            String supplierKeyword,
            @RequestParam(required = false) @Size(max = 120)
            String purchaseKeyword,
            @RequestParam(required = false) Instant receivedFrom,
            @RequestParam(required = false) Instant receivedTo,
            @RequestParam(defaultValue = "RECEIVED_AT")
            ProcurementReceiptSort sort,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE)
            int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                service.listReceipts(
                        actor(principal, request, null), null,
                        supplierKeyword, purchaseKeyword,
                        receivedFrom, receivedTo, sort,
                        pageable(page, size)),
                PurchaseOrderReceiptResponse::from);
    }

    @PostMapping("/receipts/exports")
    @PreAuthorize("hasAuthority('procurement.read')")
    public ReceiptLedgerExportResponse exportReceiptLedger(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ReceiptLedgerExportRequest body,
            HttpServletRequest request) {
        var result = service.exportReceiptLedgerCsv(
                actor(principal, request, null), body.supplierKeyword(),
                body.purchaseKeyword(), body.receivedFrom(), body.receivedTo(),
                body.sort());
        return new ReceiptLedgerExportResponse(
                result.filename(), result.mediaType(), result.rowCount(),
                result.content());
    }

    @GetMapping("/{purchaseOrderId}/receipts")
    @PreAuthorize("hasAuthority('procurement.read')")
    public PageEnvelope<PurchaseOrderReceiptResponse> listOrderReceipts(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID purchaseOrderId,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE)
            int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                service.listReceipts(
                        actor(principal, request, null), purchaseOrderId,
                        null, null, null, null,
                        ProcurementReceiptSort.RECEIVED_AT,
                        pageable(page, size)),
                PurchaseOrderReceiptResponse::from);
    }

    @GetMapping("/references/plans/{planId}/suppliers")
    @PreAuthorize("hasAuthority('procurement.read')")
    public PageEnvelope<SupplierOptionResponse> supplierOptions(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                service.supplierOptions(
                        actor(principal, request, null), planId, keyword,
                        pageable(page, size)),
                SupplierOptionResponse::from);
    }

    @GetMapping("/references/skus/{skuId}/suppliers")
    @PreAuthorize("hasAuthority('procurement.read')")
    public PageEnvelope<SupplierOptionResponse> supplierOptionsForSku(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID skuId,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                service.supplierOptionsForSku(
                        actor(principal, request, null), skuId, keyword,
                        pageable(page, size)),
                SupplierOptionResponse::from);
    }

    private static ProcurementPlanActor actor(
            ErpPrincipal principal, HttpServletRequest request, String requestId) {
        return new ProcurementPlanActor(
                principal.tenantId(), principal.userId(), principal.systemAdminId(),
                principal.displayName(), requestId, request.getRemoteAddr());
    }

    private static PageRequest pageable(int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new ConstraintViolationException(Set.of());
        }
        return PageRequest.of(page, size);
    }
}
