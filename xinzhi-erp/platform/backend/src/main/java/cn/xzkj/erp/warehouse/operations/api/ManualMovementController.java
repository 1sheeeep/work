package cn.xzkj.erp.warehouse.operations.api;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.PageEnvelope;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.DetailResponse;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.ExportRequest;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.ExportResponse;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.LedgerResponse;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.LedgerListResponse;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.LocationOptionResponse;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.MutationResponse;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.SaveRequest;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.SkuOptionResponse;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.SummaryResponse;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.TimelineResponse;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.TimelineListResponse;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.TransitionRequest;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.WarehouseOptionResponse;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.BatchRequest;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.BatchResponse;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.BoxStockResponse;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.MovementTypeRequest;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.MovementTypeResponse;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.PriceSnapshotResponse;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.ReviewRequest;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.SettingsRequest;
import cn.xzkj.erp.warehouse.operations.api.ManualMovementDtos.SettingsResponse;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementApprovalStatus;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementDirection;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementReasonCode;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementSearchField;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementSource;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementStatus;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementTimeBucket;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementWmsStatus;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementActor;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/v1/inventory-center/manual-movements")
public class ManualMovementController {
    private static final int MAX_PAGE_SIZE = 200;
    private final ManualMovementService service;

    public ManualMovementController(ManualMovementService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('inventory.read')")
    public PageEnvelope<SummaryResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) UUID warehouseId,
            @RequestParam(required = false)
            ManualMovementDirection direction,
            @RequestParam(required = false)
            ManualMovementStatus status,
            @RequestParam(required = false)
            ManualMovementReasonCode reasonCode,
            @RequestParam(required = false)
            UUID movementTypeId,
            @RequestParam(required = false)
            ManualMovementSource source,
            @RequestParam(required = false)
            ManualMovementWmsStatus wmsStatus,
            @RequestParam(required = false)
            ManualMovementApprovalStatus approvalStatus,
            @RequestParam(required = false)
            ManualMovementSearchField searchField,
            @RequestParam(required = false)
            ManualMovementTimeBucket timeBucket,
            @RequestParam(required = false) @Size(max = 100)
            String keyword,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant createdFrom,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant createdTo,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50")
            @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                service.list(
                        actor(principal, request, null),
                        warehouseId,
                        direction,
                        status,
                        reasonCode,
                        movementTypeId,
                        source,
                        wmsStatus,
                        approvalStatus,
                        searchField,
                        timeBucket,
                        keyword,
                        createdFrom,
                        createdTo,
                        pageable(page, size)),
                SummaryResponse::from);
    }

    @PostMapping("/exports")
    @PreAuthorize("hasAuthority('inventory.read')")
    public ExportResponse export(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ExportRequest exportRequest,
            HttpServletRequest request) {
        var result = service.exportCsv(
                actor(principal, request, null),
                exportRequest.warehouseId(),
                exportRequest.direction(),
                exportRequest.status(),
                exportRequest.reasonCode(),
                exportRequest.movementTypeId(),
                exportRequest.source(),
                exportRequest.wmsStatus(),
                exportRequest.approvalStatus(),
                exportRequest.searchField(),
                exportRequest.timeBucket(),
                exportRequest.keyword(),
                exportRequest.createdFrom(),
                exportRequest.createdTo());
        return new ExportResponse(
                result.filename(), result.mediaType(), result.rowCount(),
                result.content());
    }

    @GetMapping("/{movementId}")
    @PreAuthorize("hasAuthority('inventory.read')")
    public DetailResponse get(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID movementId,
            HttpServletRequest request) {
        return DetailResponse.from(service.get(
                actor(principal, request, null), movementId));
    }

    @GetMapping("/{movementId}/timeline")
    @PreAuthorize("hasAuthority('inventory.read')")
    public TimelineListResponse timeline(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID movementId,
            HttpServletRequest request) {
        return new TimelineListResponse(service.timeline(
                                actor(principal, request, null),
                                movementId)
                        .stream()
                        .map(TimelineResponse::from)
                        .toList());
    }

    @GetMapping("/{movementId}/ledger-events")
    @PreAuthorize("hasAuthority('inventory.read')")
    public LedgerListResponse ledger(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID movementId,
            HttpServletRequest request) {
        return new LedgerListResponse(service.ledger(
                                actor(principal, request, null),
                                movementId)
                        .stream()
                        .map(LedgerResponse::from)
                        .toList());
    }

    @GetMapping("/references/warehouses")
    @PreAuthorize("hasAuthority('inventory.read')")
    public PageEnvelope<WarehouseOptionResponse> warehouseOptions(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) @Size(max = 100)
            String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50")
            @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                service.warehouseOptions(
                        actor(principal, request, null),
                        keyword,
                        pageable(page, size)),
                WarehouseOptionResponse::from);
    }

    @GetMapping("/references/warehouses/{warehouseId}/locations")
    @PreAuthorize("hasAuthority('inventory.read')")
    public PageEnvelope<LocationOptionResponse> locationOptions(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID warehouseId,
            @RequestParam(required = false) @Size(max = 100)
            String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "100")
            @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                service.locationOptions(
                        actor(principal, request, null),
                        warehouseId,
                        keyword,
                        pageable(page, size)),
                LocationOptionResponse::from);
    }

    @GetMapping("/references/skus")
    @PreAuthorize("hasAuthority('inventory.read')")
    public PageEnvelope<SkuOptionResponse> skuOptions(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) @Size(max = 100)
            String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50")
            @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                service.skuOptions(
                        actor(principal, request, null),
                        keyword,
                        pageable(page, size)),
                SkuOptionResponse::from);
    }

    @GetMapping("/references/skus/{skuId}/price-snapshot")
    @PreAuthorize("hasAuthority('inventory.read')")
    public PriceSnapshotResponse priceSnapshot(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID skuId,
            @RequestParam ManualMovementDirection direction,
            HttpServletRequest request) {
        return PriceSnapshotResponse.from(service.priceSnapshot(
                actor(principal, request, null),
                skuId,
                direction));
    }

    @GetMapping("/settings/{direction}")
    @PreAuthorize("hasAuthority('inventory.read')")
    public SettingsResponse settings(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable ManualMovementDirection direction,
            HttpServletRequest request) {
        return SettingsResponse.from(service.settings(
                actor(principal, request, null), direction));
    }

    @PutMapping("/settings/{direction}")
    @PreAuthorize("hasAuthority('inventory.manual.configure')")
    public SettingsResponse saveSettings(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable ManualMovementDirection direction,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$")
            String requestId,
            @Valid @RequestBody SettingsRequest body,
            HttpServletRequest request) {
        ManualMovementActor movementActor =
                actor(principal, request, safeRequestId(requestId));
        return SettingsResponse.from(service.saveSettings(
                movementActor,
                direction,
                body.approvalRequired(),
                body.unitPriceRequired(),
                body.showCostPrice(),
                body.costUpdatePolicy(),
                body.contactInformationRequired(),
                body.expectedVersion(),
                body.commandId()));
    }

    @GetMapping("/types")
    @PreAuthorize("hasAuthority('inventory.read')")
    public PageEnvelope<MovementTypeResponse> types(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false)
            ManualMovementDirection direction,
            @RequestParam(defaultValue = "false")
            boolean includeInactive,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50")
            @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                service.types(
                        actor(principal, request, null),
                        direction,
                        includeInactive,
                        pageable(page, size)),
                MovementTypeResponse::from);
    }

    @PostMapping("/types")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('inventory.manual.configure')")
    public MovementTypeResponse createType(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$")
            String requestId,
            @Valid @RequestBody MovementTypeRequest body,
            HttpServletRequest request) {
        ManualMovementActor movementActor =
                actor(principal, request, safeRequestId(requestId));
        return MovementTypeResponse.from(service.saveType(
                movementActor,
                null,
                body.direction(),
                body.code(),
                body.name(),
                body.status(),
                body.expectedVersion(),
                body.commandId()));
    }

    @PutMapping("/types/{typeId}")
    @PreAuthorize("hasAuthority('inventory.manual.configure')")
    public MovementTypeResponse updateType(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID typeId,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$")
            String requestId,
            @Valid @RequestBody MovementTypeRequest body,
            HttpServletRequest request) {
        ManualMovementActor movementActor =
                actor(principal, request, safeRequestId(requestId));
        return MovementTypeResponse.from(service.saveType(
                movementActor,
                typeId,
                body.direction(),
                body.code(),
                body.name(),
                body.status(),
                body.expectedVersion(),
                body.commandId()));
    }

    @GetMapping("/box-stock")
    @PreAuthorize("hasAuthority('inventory.read')")
    public PageEnvelope<BoxStockResponse> boxStock(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam UUID warehouseId,
            @RequestParam(required = false) @Size(max = 100)
            String keyword,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50")
            @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                service.boxStock(
                        actor(principal, request, null),
                        warehouseId,
                        keyword,
                        pageable(page, size)),
                BoxStockResponse::from);
    }

    @PostMapping
    @PreAuthorize("hasAuthority('inventory.manual.write')")
    @ResponseStatus(HttpStatus.CREATED)
    public MutationResponse create(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$")
            String requestId,
            @Valid @RequestBody SaveRequest body,
            HttpServletRequest request) {
        ManualMovementActor movementActor =
                actor(principal, request, safeRequestId(requestId));
        return MutationResponse.from(
                service.create(movementActor, body.toCommand()));
    }

    @PutMapping("/{movementId}")
    @PreAuthorize("hasAuthority('inventory.manual.write')")
    public MutationResponse update(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID movementId,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$")
            String requestId,
            @Valid @RequestBody SaveRequest body,
            HttpServletRequest request) {
        ManualMovementActor movementActor =
                actor(principal, request, safeRequestId(requestId));
        return MutationResponse.from(
                service.update(
                        movementActor,
                        movementId,
                        body.toCommand()));
    }

    @PostMapping("/{movementId}/submit")
    @PreAuthorize("hasAuthority('inventory.manual.write')")
    public MutationResponse submit(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID movementId,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$")
            String requestId,
            @Valid @RequestBody TransitionRequest body,
            HttpServletRequest request) {
        ManualMovementActor movementActor =
                actor(principal, request, safeRequestId(requestId));
        return MutationResponse.from(service.submit(
                movementActor, movementId, body.toCommand()));
    }

    @PostMapping("/{movementId}/review")
    @PreAuthorize("hasAuthority('inventory.manual.approve')")
    public MutationResponse review(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID movementId,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$")
            String requestId,
            @Valid @RequestBody ReviewRequest body,
            HttpServletRequest request) {
        ManualMovementActor movementActor =
                actor(principal, request, safeRequestId(requestId));
        return MutationResponse.from(service.review(
                movementActor, movementId, body.toCommand()));
    }

    @PostMapping("/{movementId}/cancel")
    @PreAuthorize("hasAuthority('inventory.manual.write')")
    public MutationResponse cancel(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID movementId,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$")
            String requestId,
            @Valid @RequestBody TransitionRequest body,
            HttpServletRequest request) {
        ManualMovementActor movementActor =
                actor(principal, request, safeRequestId(requestId));
        return MutationResponse.from(service.cancel(
                movementActor, movementId, body.toCommand()));
    }

    @PostMapping("/batch/review")
    @PreAuthorize("hasAuthority('inventory.manual.approve')")
    public BatchResponse batchReview(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(defaultValue = "true") boolean approved,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$")
            String requestId,
            @Valid @RequestBody BatchRequest body,
            HttpServletRequest request) {
        return BatchResponse.from(service.batchReview(
                actor(principal, request, safeRequestId(requestId)),
                body.toCommand(),
                approved));
    }

    @PostMapping("/batch/post")
    @PreAuthorize("hasAuthority('inventory.manual.post')")
    public BatchResponse batchPost(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$")
            String requestId,
            @Valid @RequestBody BatchRequest body,
            HttpServletRequest request) {
        return BatchResponse.from(service.batchPost(
                actor(principal, request, safeRequestId(requestId)),
                body.toCommand()));
    }

    @PostMapping("/batch/cancel")
    @PreAuthorize("hasAuthority('inventory.manual.write')")
    public BatchResponse batchCancel(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$")
            String requestId,
            @Valid @RequestBody BatchRequest body,
            HttpServletRequest request) {
        return BatchResponse.from(service.batchCancel(
                actor(principal, request, safeRequestId(requestId)),
                body.toCommand()));
    }

    @PostMapping("/{movementId}/post")
    @PreAuthorize("hasAuthority('inventory.manual.post')")
    public MutationResponse post(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID movementId,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$")
            String requestId,
            @Valid @RequestBody TransitionRequest body,
            HttpServletRequest request) {
        ManualMovementActor movementActor =
                actor(principal, request, safeRequestId(requestId));
        return MutationResponse.from(
                service.post(
                        movementActor,
                        movementId,
                        body.toCommand()));
    }

    @PostMapping("/{movementId}/reverse")
    @PreAuthorize("hasAuthority('inventory.reverse')")
    public MutationResponse reverse(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID movementId,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$")
            String requestId,
            @Valid @RequestBody TransitionRequest body,
            HttpServletRequest request) {
        ManualMovementActor movementActor =
                actor(principal, request, safeRequestId(requestId));
        return MutationResponse.from(
                service.reverse(
                        movementActor,
                        movementId,
                        body.toCommand()));
    }

    private static ManualMovementActor actor(
            ErpPrincipal principal,
            HttpServletRequest request,
            String requestId) {
        return new ManualMovementActor(
                principal.tenantId(),
                principal.userId(),
                principal.systemAdminId(),
                principal.displayName(),
                requestId,
                request.getRemoteAddr());
    }

    private static Pageable pageable(int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new ConstraintViolationException(Set.of());
        }
        return PageRequest.of(page, size);
    }

    private static String safeRequestId(String requestId) {
        if (requestId == null
                || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            throw new IllegalArgumentException(
                    "A safe request ID is required");
        }
        return requestId;
    }
}
