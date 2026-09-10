package cn.xzkj.erp.order.api;

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
import org.springframework.web.multipart.MultipartFile;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.order.api.OrderOperationsDtos.BulkStatusRequest;
import cn.xzkj.erp.order.api.OrderOperationsDtos.TransferFilterRequest;
import cn.xzkj.erp.order.api.OrderOperationsDtos.TransferJobResponse;
import cn.xzkj.erp.order.api.OrderOperationsDtos.TransferResultResponse;
import cn.xzkj.erp.order.domain.OrderOperationsPermissionCodes;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.order.service.OrderOperationsService;
import cn.xzkj.erp.platform.api.PageEnvelope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

@RestController
@Validated
@RequestMapping("/api/v1/order-center")
public class OrderOperationsController {

    private static final Pattern REQUEST_ID =
            Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");
    private final OrderOperationsService service;

    public OrderOperationsController(OrderOperationsService service) {
        this.service = service;
    }

    @GetMapping("/transfers")
    @PreAuthorize("hasAuthority('" + OrderOperationsPermissionCodes.TRANSFER_READ + "')")
    public PageEnvelope<TransferJobResponse> listTransfers(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @RequestParam(defaultValue = "0") @Min(0) @Max(1_000_000) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(200) int size) {
        var result = service.listTransfers(tenantId, page, size);
        return new PageEnvelope<>(
                result.items().stream().map(TransferJobResponse::from).toList(),
                result.page(), result.size(), result.totalElements(), result.totalPages());
    }

    @PostMapping("/orders/bulk-status")
    @PreAuthorize("hasAuthority('orders.write')")
    public TransferResultResponse bulkStatus(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody BulkStatusRequest request,
            HttpServletRequest servletRequest) {
        return service.bulkStatus(
                actor(principal, servletRequest),
                request.commandId(),
                request.targetStatus(),
                request.reason(),
                request.orders());
    }

    @PostMapping("/transfers/exports")
    @PreAuthorize("hasAuthority('" + OrderOperationsPermissionCodes.TRANSFER_WRITE + "')")
    public TransferResultResponse export(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody(required = false) TransferFilterRequest request,
            HttpServletRequest servletRequest) {
        return service.exportCsv(actor(principal, servletRequest), request);
    }

    @PostMapping("/transfers/imports")
    @PreAuthorize("hasAuthority('" + OrderOperationsPermissionCodes.TRANSFER_WRITE + "')")
    public TransferResultResponse importCsv(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam("idempotencyKey")
            @jakarta.validation.constraints.Pattern(
                    regexp = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")
            String idempotencyKey,
            @RequestParam("file") MultipartFile file,
            HttpServletRequest servletRequest) throws java.io.IOException {
        String contentType = file.getContentType();
        if (file.isEmpty()
                || file.getSize() > 2L * 1024 * 1024
                || contentType == null
                || !java.util.Set.of(
                        "text/csv",
                        "application/csv",
                        "application/vnd.ms-excel")
                        .contains(contentType)) {
            throw new IllegalArgumentException("Invalid CSV upload");
        }
        return service.importCsv(
                actor(principal, servletRequest),
                idempotencyKey,
                file.getOriginalFilename(),
                file.getBytes());
    }

    static OrderActor actor(
            ErpPrincipal principal, HttpServletRequest request) {
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
                principal.tenantId(),
                principal.userId(),
                principal.systemAdminId(),
                requestId,
                request.getRemoteAddr());
    }
}
