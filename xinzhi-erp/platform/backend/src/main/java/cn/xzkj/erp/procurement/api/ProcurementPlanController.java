package cn.xzkj.erp.procurement.api;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.PageEnvelope;
import cn.xzkj.erp.procurement.api.ProcurementPlanDtos.CreateRequest;
import cn.xzkj.erp.procurement.api.ProcurementPlanDtos.ExportRequest;
import cn.xzkj.erp.procurement.api.ProcurementPlanDtos.ExportResponse;
import cn.xzkj.erp.procurement.api.ProcurementPlanDtos.LocationOptionResponse;
import cn.xzkj.erp.procurement.api.ProcurementPlanDtos.PlanResponse;
import cn.xzkj.erp.procurement.api.ProcurementPlanDtos.SkuOptionResponse;
import cn.xzkj.erp.procurement.api.ProcurementPlanDtos.SummaryResponse;
import cn.xzkj.erp.procurement.api.ProcurementPlanDtos.VoidRequest;
import cn.xzkj.erp.procurement.api.ProcurementPlanDtos.WarehouseOptionResponse;
import cn.xzkj.erp.procurement.domain.ProcurementPlanSearchField;
import cn.xzkj.erp.procurement.domain.ProcurementPlanStatus;
import cn.xzkj.erp.procurement.service.ProcurementPlanActor;
import cn.xzkj.erp.procurement.service.ProcurementPlanService;
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
@RequestMapping("/api/v1/procurement/plans")
public class ProcurementPlanController {
    private static final int MAX_PAGE_SIZE = 200;
    private final ProcurementPlanService service;

    public ProcurementPlanController(ProcurementPlanService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('procurement.read')")
    public PageEnvelope<PlanResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) UUID warehouseId,
            @RequestParam(required = false) UUID locationId,
            @RequestParam(required = false) ProcurementPlanStatus status,
            @RequestParam(defaultValue = "PLAN_NO") ProcurementPlanSearchField searchField,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(required = false) Instant createdFrom,
            @RequestParam(required = false) Instant createdTo,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50")
            @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                service.list(
                        actor(principal, request, null), warehouseId, locationId,
                        status, searchField, keyword, createdFrom, createdTo,
                        pageable(page, size)),
                PlanResponse::from);
    }

    @PostMapping("/exports")
    @PreAuthorize("hasAuthority('procurement.read')")
    public ExportResponse export(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ExportRequest body,
            HttpServletRequest request) {
        var result = service.exportCsv(
                actor(principal, request, null), body.warehouseId(),
                body.locationId(), body.status(), body.searchField(),
                body.keyword(), body.createdFrom(), body.createdTo());
        return new ExportResponse(
                result.filename(), result.mediaType(), result.rowCount(),
                result.content());
    }

    @GetMapping("/summary")
    @PreAuthorize("hasAuthority('procurement.read')")
    public SummaryResponse summary(
            @AuthenticationPrincipal ErpPrincipal principal,
            HttpServletRequest request) {
        return new SummaryResponse(service.countUnpurchased(
                actor(principal, request, null)));
    }

    @GetMapping("/{planId}")
    @PreAuthorize("hasAuthority('procurement.read')")
    public PlanResponse get(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            HttpServletRequest request) {
        return PlanResponse.from(service.get(
                actor(principal, request, null), planId));
    }

    @PostMapping
    @PreAuthorize("hasAuthority('procurement.write')")
    public ResponseEntity<PlanResponse> create(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestHeader("X-Request-Id")
            @Size(min = 1, max = 100)
            @Pattern(regexp = "^[A-Za-z0-9._:-]+$") String requestId,
            @Valid @RequestBody CreateRequest body,
            HttpServletRequest request) {
        PlanResponse response = PlanResponse.from(service.create(
                actor(principal, request, requestId), body.commandId(),
                body.skuId(), body.warehouseId(), body.locationId(),
                body.quantity(), body.note()));
        return ResponseEntity.created(URI.create(
                "/api/v1/procurement/plans/" + response.planId()))
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    @PostMapping("/{planId}/void")
    @PreAuthorize("hasAuthority('procurement.write')")
    public ResponseEntity<PlanResponse> voidPlan(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            @RequestHeader("X-Request-Id")
            @Size(min = 1, max = 100)
            @Pattern(regexp = "^[A-Za-z0-9._:-]+$") String requestId,
            @Valid @RequestBody VoidRequest body,
            HttpServletRequest request) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PlanResponse.from(service.voidPlan(
                        actor(principal, request, requestId), planId,
                        body.commandId(), body.expectedVersion(), body.reason())));
    }

    @GetMapping("/references/skus")
    @PreAuthorize("hasAuthority('procurement.read')")
    public PageEnvelope<SkuOptionResponse> skuOptions(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50")
            @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                service.skuOptions(
                        actor(principal, request, null), keyword,
                        pageable(page, size)),
                SkuOptionResponse::from);
    }

    @GetMapping("/references/warehouses")
    @PreAuthorize("hasAuthority('procurement.read')")
    public PageEnvelope<WarehouseOptionResponse> warehouseOptions(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50")
            @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                service.warehouseOptions(
                        actor(principal, request, null), keyword,
                        pageable(page, size)),
                WarehouseOptionResponse::from);
    }

    @GetMapping("/references/warehouses/{warehouseId}/locations")
    @PreAuthorize("hasAuthority('procurement.read')")
    public PageEnvelope<LocationOptionResponse> locationOptions(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID warehouseId,
            @RequestParam(required = false) @Size(max = 120) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50")
            @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                service.locationOptions(
                        actor(principal, request, null), warehouseId, keyword,
                        pageable(page, size)),
                LocationOptionResponse::from);
    }

    private static ProcurementPlanActor actor(
            ErpPrincipal principal, HttpServletRequest request, String requestId) {
        return new ProcurementPlanActor(
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
