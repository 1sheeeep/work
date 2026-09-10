package cn.xzkj.erp.inventory.api;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.inventory.api.InventoryCountDtos.CountDetailResponse;
import cn.xzkj.erp.inventory.api.InventoryCountDtos.CountSummaryResponse;
import cn.xzkj.erp.inventory.api.InventoryCountDtos.CountExportRequest;
import cn.xzkj.erp.inventory.api.InventoryCountDtos.CountExportResponse;
import cn.xzkj.erp.inventory.api.InventoryCountDtos.CreateCountRequest;
import cn.xzkj.erp.inventory.api.InventoryCountDtos.TransitionCountRequest;
import cn.xzkj.erp.inventory.domain.InventoryCountStatus;
import cn.xzkj.erp.inventory.service.InventoryCountActor;
import cn.xzkj.erp.inventory.service.InventoryCountSearchField;
import cn.xzkj.erp.inventory.service.InventoryCountService;
import cn.xzkj.erp.inventory.service.InventoryCountService.LineInput;
import cn.xzkj.erp.platform.api.PageEnvelope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
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
@RequestMapping("/api/v1/inventory-center/counts")
public class InventoryCountController {
    private static final int MAX_PAGE_SIZE = 200;
    private final InventoryCountService service;

    public InventoryCountController(InventoryCountService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('inventory.read')")
    public PageEnvelope<CountSummaryResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) UUID warehouseId,
            @RequestParam(required = false) InventoryCountStatus status,
            @RequestParam(defaultValue = "BATCH") InventoryCountSearchField searchField,
            @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) Long differenceMin,
            @RequestParam(required = false) Long differenceMax,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                service.list(
                        actor(principal, request, null),
                        warehouseId,
                        status,
                        searchField,
                        keyword,
                        from,
                        to,
                        differenceMin,
                        differenceMax,
                        pageable(page, size)),
                CountSummaryResponse::from);
    }

    @PostMapping("/exports")
    @PreAuthorize("hasAuthority('inventory.read')")
    public CountExportResponse export(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody CountExportRequest body,
            HttpServletRequest request) {
        var result = service.exportCsv(
                actor(principal, request, null), body.warehouseId(),
                body.status(), body.searchField(), body.keyword(), body.from(),
                body.to(), body.differenceMin(), body.differenceMax());
        return new CountExportResponse(
                result.filename(), result.mediaType(), result.rowCount(),
                result.content());
    }

    @GetMapping("/{countId}")
    @PreAuthorize("hasAuthority('inventory.read')")
    public CountDetailResponse get(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID countId,
            HttpServletRequest request) {
        return CountDetailResponse.from(
                service.get(actor(principal, request, null), countId));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('inventory.adjust')")
    public CountDetailResponse create(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$") String requestId,
            @Valid @RequestBody CreateCountRequest body,
            HttpServletRequest request) {
        return CountDetailResponse.from(service.create(
                actor(principal, request, requestId),
                body.commandId(),
                body.warehouseId(),
                body.countDate(),
                body.note(),
                body.submit(),
                body.lines().stream()
                        .map(line -> new LineInput(
                                line.balanceId(), line.countedOnHand()))
                        .toList()));
    }

    @PostMapping("/{countId}/submit")
    @PreAuthorize("hasAuthority('inventory.adjust')")
    public CountDetailResponse submit(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID countId,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$") String requestId,
            @Valid @RequestBody TransitionCountRequest body,
            HttpServletRequest request) {
        return CountDetailResponse.from(service.submit(
                actor(principal, request, requestId),
                countId,
                body.commandId(),
                body.expectedVersion()));
    }

    @PostMapping("/{countId}/approve")
    @PreAuthorize("hasAuthority('inventory.adjust')")
    public CountDetailResponse approve(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID countId,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$") String requestId,
            @Valid @RequestBody TransitionCountRequest body,
            HttpServletRequest request) {
        return CountDetailResponse.from(service.approve(
                actor(principal, request, requestId),
                countId,
                body.commandId(),
                body.expectedVersion()));
    }

    @PostMapping("/{countId}/reject")
    @PreAuthorize("hasAuthority('inventory.adjust')")
    public CountDetailResponse reject(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID countId,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$") String requestId,
            @Valid @RequestBody TransitionCountRequest body,
            HttpServletRequest request) {
        return CountDetailResponse.from(service.reject(
                actor(principal, request, requestId),
                countId,
                body.commandId(),
                body.expectedVersion()));
    }

    @PostMapping("/{countId}/cancel")
    @PreAuthorize("hasAuthority('inventory.adjust')")
    public CountDetailResponse cancel(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID countId,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$") String requestId,
            @Valid @RequestBody TransitionCountRequest body,
            HttpServletRequest request) {
        return CountDetailResponse.from(service.cancel(
                actor(principal, request, requestId),
                countId,
                body.commandId(),
                body.expectedVersion()));
    }

    private static InventoryCountActor actor(
            ErpPrincipal principal,
            HttpServletRequest request,
            String requestId) {
        return new InventoryCountActor(
                principal.tenantId(),
                principal.userId(),
                principal.systemAdminId(),
                principal.displayName(),
                requestId,
                request.getRemoteAddr());
    }

    private static PageRequest pageable(int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new ConstraintViolationException(Set.of());
        }
        return PageRequest.of(page, size);
    }
}
