package cn.xzkj.erp.inventory.api;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.inventory.api.InventoryTransferDtos.CreateTransferRequest;
import cn.xzkj.erp.inventory.api.InventoryTransferDtos.TransferExportRequest;
import cn.xzkj.erp.inventory.api.InventoryTransferDtos.TransferExportResponse;
import cn.xzkj.erp.inventory.api.InventoryTransferDtos.TransferDetailResponse;
import cn.xzkj.erp.inventory.api.InventoryTransferDtos.TransferSummaryResponse;
import cn.xzkj.erp.inventory.api.InventoryTransferDtos.TransitionTransferRequest;
import cn.xzkj.erp.inventory.api.InventoryTransferDtos.ReceiveTransferRequest;
import cn.xzkj.erp.inventory.domain.WarehouseTransferStatus;
import cn.xzkj.erp.inventory.domain.WarehouseTransferTransportMode;
import cn.xzkj.erp.inventory.service.WarehouseTransferActor;
import cn.xzkj.erp.inventory.service.WarehouseTransferSearchField;
import cn.xzkj.erp.inventory.service.WarehouseTransferService;
import cn.xzkj.erp.inventory.service.WarehouseTransferService.LineInput;
import cn.xzkj.erp.inventory.service.WarehouseTransferService.ReceiptInput;
import cn.xzkj.erp.platform.api.PageEnvelope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.format.annotation.DateTimeFormat;
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
@RequestMapping("/api/v1/inventory-center/transfers")
public class WarehouseTransferController {
    private static final int MAX_PAGE_SIZE = 200;
    private final WarehouseTransferService service;

    public WarehouseTransferController(WarehouseTransferService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('inventory.read')")
    public PageEnvelope<TransferSummaryResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) UUID sourceWarehouseId,
            @RequestParam(required = false) UUID targetWarehouseId,
            @RequestParam(name = "status", required = false)
            List<WarehouseTransferStatus> statuses,
            @RequestParam(required = false) WarehouseTransferTransportMode transportMode,
            @RequestParam(defaultValue = "BATCH") WarehouseTransferSearchField searchField,
            @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                service.list(
                        actor(principal, request, null), sourceWarehouseId,
                        targetWarehouseId, statuses, transportMode, searchField,
                        keyword, from, to, pageable(page, size)),
                TransferSummaryResponse::from);
    }

    @PostMapping("/exports")
    @PreAuthorize("hasAuthority('inventory.read')")
    public TransferExportResponse export(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody TransferExportRequest body,
            HttpServletRequest request) {
        var result = service.exportCsv(
                actor(principal, request, null), body.sourceWarehouseId(),
                body.targetWarehouseId(), body.statuses(), body.transportMode(),
                body.searchField(), body.keyword(), body.from(), body.to());
        return new TransferExportResponse(
                result.filename(), result.mediaType(), result.rowCount(),
                result.content());
    }

    @GetMapping("/{transferId}")
    @PreAuthorize("hasAuthority('inventory.read')")
    public TransferDetailResponse get(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID transferId,
            HttpServletRequest request) {
        return TransferDetailResponse.from(
                service.get(actor(principal, request, null), transferId));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('inventory.adjust')")
    public TransferDetailResponse create(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$") String requestId,
            @Valid @RequestBody CreateTransferRequest body,
            HttpServletRequest request) {
        return TransferDetailResponse.from(service.create(
                actor(principal, request, requestId), body.commandId(),
                body.sourceWarehouseId(), body.targetWarehouseId(),
                body.transferDate(), body.transportMode(),
                body.freightAmountMinor(), body.currencyCode(),
                body.logisticsChannel(), body.trackingNo(),
                body.allocationMethod(), body.expectedShipAt(),
                body.expectedArrivalAt(), body.note(), body.submit(),
                body.lines().stream()
                        .map(line -> new LineInput(line.balanceId(), line.quantity()))
                        .toList()));
    }

    @PostMapping("/{transferId}/submit")
    @PreAuthorize("hasAuthority('inventory.adjust')")
    public TransferDetailResponse submit(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID transferId,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$") String requestId,
            @Valid @RequestBody TransitionTransferRequest body,
            HttpServletRequest request) {
        return TransferDetailResponse.from(service.submit(
                actor(principal, request, requestId), transferId,
                body.commandId(), body.expectedVersion()));
    }

    @PostMapping("/{transferId}/approve")
    @PreAuthorize("hasAuthority('inventory.adjust')")
    public TransferDetailResponse approve(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID transferId,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$") String requestId,
            @Valid @RequestBody TransitionTransferRequest body,
            HttpServletRequest request) {
        return TransferDetailResponse.from(service.approve(
                actor(principal, request, requestId), transferId,
                body.commandId(), body.expectedVersion()));
    }

    @PostMapping("/{transferId}/reject")
    @PreAuthorize("hasAuthority('inventory.adjust')")
    public TransferDetailResponse reject(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID transferId,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$") String requestId,
            @Valid @RequestBody TransitionTransferRequest body,
            HttpServletRequest request) {
        return TransferDetailResponse.from(service.reject(
                actor(principal, request, requestId), transferId,
                body.commandId(), body.expectedVersion()));
    }

    @PostMapping("/{transferId}/ship")
    @PreAuthorize("hasAuthority('inventory.adjust')")
    public TransferDetailResponse ship(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID transferId,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$") String requestId,
            @Valid @RequestBody TransitionTransferRequest body,
            HttpServletRequest request) {
        return TransferDetailResponse.from(service.ship(
                actor(principal, request, requestId), transferId,
                body.commandId(), body.expectedVersion()));
    }

    @PostMapping("/{transferId}/receive")
    @PreAuthorize("hasAuthority('inventory.adjust')")
    public TransferDetailResponse receive(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID transferId,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$") String requestId,
            @Valid @RequestBody TransitionTransferRequest body,
            HttpServletRequest request) {
        return TransferDetailResponse.from(service.receive(
                actor(principal, request, requestId), transferId,
                body.commandId(), body.expectedVersion()));
    }

    @PostMapping("/{transferId}/receive-partial")
    @PreAuthorize("hasAuthority('inventory.adjust')")
    public TransferDetailResponse receivePartial(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID transferId,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$") String requestId,
            @Valid @RequestBody ReceiveTransferRequest body,
            HttpServletRequest request) {
        return TransferDetailResponse.from(service.receivePartial(
                actor(principal, request, requestId), transferId,
                body.commandId(), body.expectedVersion(),
                body.lines().stream()
                        .map(line -> new ReceiptInput(
                                line.lineId(), line.quantity()))
                        .toList()));
    }

    @PostMapping("/{transferId}/cancel")
    @PreAuthorize("hasAuthority('inventory.adjust')")
    public TransferDetailResponse cancel(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID transferId,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$") String requestId,
            @Valid @RequestBody TransitionTransferRequest body,
            HttpServletRequest request) {
        return TransferDetailResponse.from(service.cancel(
                actor(principal, request, requestId), transferId,
                body.commandId(), body.expectedVersion()));
    }

    private static WarehouseTransferActor actor(
            ErpPrincipal principal, HttpServletRequest request, String requestId) {
        return new WarehouseTransferActor(
                principal.tenantId(), principal.userId(),
                principal.systemAdminId(), principal.displayName(),
                requestId, request.getRemoteAddr());
    }

    private static PageRequest pageable(int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new ConstraintViolationException(Set.of());
        }
        return PageRequest.of(page, size);
    }
}
