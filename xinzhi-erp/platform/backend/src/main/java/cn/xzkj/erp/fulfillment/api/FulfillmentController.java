package cn.xzkj.erp.fulfillment.api;

import java.net.URI;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.fulfillment.api.FulfillmentDtos.AllocateRequest;
import cn.xzkj.erp.fulfillment.api.FulfillmentDtos.BookLogisticsShipmentRequest;
import cn.xzkj.erp.fulfillment.api.FulfillmentDtos.CreatePackageRequest;
import cn.xzkj.erp.fulfillment.api.FulfillmentDtos.CreatePlanRequest;
import cn.xzkj.erp.fulfillment.api.FulfillmentDtos.CorrectHandoverRequest;
import cn.xzkj.erp.fulfillment.api.FulfillmentDtos.HandoverPackageRequest;
import cn.xzkj.erp.fulfillment.api.FulfillmentDtos.HandoverBookedLogisticsRequest;
import cn.xzkj.erp.fulfillment.api.FulfillmentDtos.PickRequest;
import cn.xzkj.erp.fulfillment.api.FulfillmentDtos.PlanResponse;
import cn.xzkj.erp.fulfillment.api.FulfillmentDtos.PlanSummaryResponse;
import cn.xzkj.erp.fulfillment.api.FulfillmentDtos.ReasonedCommandRequest;
import cn.xzkj.erp.fulfillment.api.FulfillmentDtos.SealPackageRequest;
import cn.xzkj.erp.fulfillment.api.FulfillmentDtos.ShopifyFulfillmentPublishRequest;
import cn.xzkj.erp.fulfillment.api.FulfillmentDtos.ShopifyFulfillmentPublishResponse;
import cn.xzkj.erp.fulfillment.api.FulfillmentDtos.VersionedCommandRequest;
import cn.xzkj.erp.fulfillment.domain.FulfillmentPermissionCodes;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Status;
import cn.xzkj.erp.fulfillment.service.FulfillmentService;
import cn.xzkj.erp.fulfillment.service.FulfillmentService.Actor;
import cn.xzkj.erp.fulfillment.service.FulfillmentService.Allocation;
import cn.xzkj.erp.fulfillment.service.FulfillmentService.QuantityChange;
import cn.xzkj.erp.fulfillment.service.ShopifyFulfillmentPublicationService;
import cn.xzkj.erp.fulfillment.service.ShopifyFulfillmentPublicationService.PublishCommand;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.logistics.shipment.LogisticsShipmentService;
import cn.xzkj.erp.platform.api.PageEnvelope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/fulfillment-center")
public class FulfillmentController {

    private static final Pattern REQUEST_ID = Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");
    private final FulfillmentService service;
    private final ShopifyFulfillmentPublicationService shopifyPublications;
    private final LogisticsShipmentService logisticsShipments;

    public FulfillmentController(
            FulfillmentService service,
            ShopifyFulfillmentPublicationService shopifyPublications,
            LogisticsShipmentService logisticsShipments) {
        this.service = service;
        this.shopifyPublications = shopifyPublications;
        this.logisticsShipments = logisticsShipments;
    }

    @PostMapping("/plans")
    @PreAuthorize("hasAuthority('" + FulfillmentPermissionCodes.ALLOCATE + "')")
    public ResponseEntity<PlanResponse> create(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody CreatePlanRequest request,
            HttpServletRequest servletRequest) {
        PlanResponse response = PlanResponse.from(service.create(actor(principal, servletRequest),
                request.orderId(), request.idempotencyKey()));
        return ResponseEntity.created(URI.create("/api/v1/fulfillment-center/plans/" + response.id()))
                .body(response);
    }

    @GetMapping("/plans")
    @PreAuthorize("hasAuthority('" + FulfillmentPermissionCodes.READ + "')")
    public PageEnvelope<PlanSummaryResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) Status status,
            @RequestParam(required = false) UUID shopId,
            @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(defaultValue = "0") @Min(0) @Max(1_000_000) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(200) int size,
            HttpServletRequest servletRequest) {
        var result = service.list(
                actor(principal, servletRequest), status, shopId, keyword, page, size);
        return new PageEnvelope<>(
                result.items().stream().map(PlanSummaryResponse::from).toList(),
                result.page(), result.size(), result.totalElements(), result.totalPages());
    }

    @GetMapping("/plans/{planId}")
    @PreAuthorize("hasAuthority('" + FulfillmentPermissionCodes.READ + "')")
    public PlanResponse get(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            HttpServletRequest servletRequest) {
        return PlanResponse.from(
                service.get(actor(principal, servletRequest), planId));
    }

    @GetMapping("/orders/{orderId}/plan")
    @PreAuthorize("hasAuthority('" + FulfillmentPermissionCodes.READ + "')")
    public PlanResponse getByOrder(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID orderId,
            HttpServletRequest servletRequest) {
        return PlanResponse.from(
                service.getByOrder(
                        actor(principal, servletRequest), orderId));
    }

    @PostMapping("/plans/{planId}/allocations")
    @PreAuthorize("hasAuthority('" + FulfillmentPermissionCodes.ALLOCATE + "')")
    public PlanResponse allocate(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            @Valid @RequestBody AllocateRequest request,
            HttpServletRequest servletRequest) {
        return PlanResponse.from(service.allocate(actor(principal, servletRequest), planId,
                request.version(), request.commandId(), request.assignments().stream()
                        .map(item -> new Allocation(item.orderLineId(), item.quantity(),
                                item.warehouseId(), item.locationId()))
                        .toList()));
    }

    @PostMapping("/plans/{planId}/picks")
    @PreAuthorize("hasAuthority('" + FulfillmentPermissionCodes.PICK + "')")
    public PlanResponse pick(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            @Valid @RequestBody PickRequest request,
            HttpServletRequest servletRequest) {
        return PlanResponse.from(service.recordPick(actor(principal, servletRequest), planId,
                request.version(), request.commandId(), request.quantities().stream()
                        .map(item -> new QuantityChange(item.lineId(), item.quantity()))
                        .toList()));
    }

    @PostMapping("/plans/{planId}/packages")
    @PreAuthorize("hasAuthority('" + FulfillmentPermissionCodes.PACK + "')")
    public PlanResponse createPackage(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            @Valid @RequestBody CreatePackageRequest request,
            HttpServletRequest servletRequest) {
        return PlanResponse.from(service.createPackage(actor(principal, servletRequest), planId,
                request.version(), request.commandId(), request.warehouseId(),
                request.packageNumber(), request.items().stream()
                        .map(item -> new cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PackageItem(
                                item.fulfillmentLineId(), item.quantity()))
                        .toList()));
    }

    @PostMapping("/plans/{planId}/packages/{packageId}/seal")
    @PreAuthorize("hasAuthority('" + FulfillmentPermissionCodes.PACK + "')")
    public PlanResponse seal(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            @PathVariable UUID packageId,
            @Valid @RequestBody SealPackageRequest request,
            HttpServletRequest servletRequest) {
        return PlanResponse.from(service.sealPackage(actor(principal, servletRequest), planId,
                packageId, request.version(), request.packageVersion(), request.commandId()));
    }

    @PostMapping("/plans/{planId}/packages/{packageId}/handover")
    @PreAuthorize("hasAuthority('" + FulfillmentPermissionCodes.SHIP + "')")
    public PlanResponse handover(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            @PathVariable UUID packageId,
            @Valid @RequestBody HandoverPackageRequest request,
            HttpServletRequest servletRequest) {
        return PlanResponse.from(service.handover(actor(principal, servletRequest), planId,
                packageId, request.version(), request.packageVersion(), request.commandId(),
                request.occurredAt(), request.carrierCode(),
                request.serviceCode(), request.trackingReference()));
    }

    @PostMapping("/plans/{planId}/packages/{packageId}/logistics-booking")
    @PreAuthorize("hasAuthority('" + FulfillmentPermissionCodes.SHIP + "')")
    public PlanResponse bookLogisticsShipment(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            @PathVariable UUID packageId,
            @Valid @RequestBody BookLogisticsShipmentRequest request,
            HttpServletRequest servletRequest) {
        return PlanResponse.from(logisticsShipments.book(
                actor(principal, servletRequest), planId, packageId,
                request.packageVersion(), request.authorizationId(),
                request.channelId(), request.idempotencyKey()));
    }

    @PostMapping("/plans/{planId}/packages/{packageId}/logistics-sync")
    @PreAuthorize("hasAuthority('" + FulfillmentPermissionCodes.SHIP + "')")
    public PlanResponse syncLogisticsShipment(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            @PathVariable UUID packageId,
            HttpServletRequest servletRequest) {
        return PlanResponse.from(logisticsShipments.sync(
                actor(principal, servletRequest), planId, packageId));
    }

    @PostMapping("/plans/{planId}/packages/{packageId}/logistics-handover")
    @PreAuthorize("hasAuthority('" + FulfillmentPermissionCodes.SHIP + "')")
    public PlanResponse handoverBookedLogisticsShipment(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            @PathVariable UUID packageId,
            @Valid @RequestBody HandoverBookedLogisticsRequest request,
            HttpServletRequest servletRequest) {
        return PlanResponse.from(logisticsShipments.handover(
                actor(principal, servletRequest), planId, packageId,
                request.version(), request.packageVersion(),
                request.commandId(), request.occurredAt()));
    }

    @PostMapping(
            "/plans/{planId}/packages/{packageId}/shopify-publication")
    @PreAuthorize("hasAuthority('"
            + FulfillmentPermissionCodes.SHIP + "')")
    public ShopifyFulfillmentPublishResponse publishShopifyFulfillment(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            @PathVariable UUID packageId,
            @Valid @RequestBody ShopifyFulfillmentPublishRequest request,
            HttpServletRequest servletRequest) {
        var result = shopifyPublications.publish(
                actor(principal, servletRequest), planId, packageId,
                new PublishCommand(
                        request.idempotencyKey(),
                        request.notifyCustomer(),
                        request.trackingUrl()));
        return new ShopifyFulfillmentPublishResponse(
                PlanResponse.from(result.plan()),
                result.externalFulfillmentRef(),
                result.recoveredFromShopify(),
                result.publishedAt(), result.replayed());
    }

    @PostMapping(
            "/plans/{planId}/packages/{packageId}/handover-corrections")
    @PreAuthorize("hasAuthority('"
            + FulfillmentPermissionCodes.CORRECT_SHIPMENT + "')")
    public PlanResponse correctHandover(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            @PathVariable UUID packageId,
            @Valid @RequestBody CorrectHandoverRequest request,
            HttpServletRequest servletRequest) {
        return PlanResponse.from(service.correctHandover(
                actor(principal, servletRequest), planId, packageId,
                request.version(), request.packageVersion(),
                request.commandId(), request.occurredAt(),
                request.reasonCode()));
    }

    @PostMapping("/plans/{planId}/pause")
    @PreAuthorize("hasAuthority('" + FulfillmentPermissionCodes.MANAGE_EXCEPTIONS + "')")
    public PlanResponse pause(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            @Valid @RequestBody ReasonedCommandRequest request,
            HttpServletRequest servletRequest) {
        return PlanResponse.from(service.pause(actor(principal, servletRequest), planId,
                request.version(), request.commandId(), request.reasonCode()));
    }

    @PostMapping("/plans/{planId}/resume")
    @PreAuthorize("hasAuthority('" + FulfillmentPermissionCodes.MANAGE_EXCEPTIONS + "')")
    public PlanResponse resume(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            @Valid @RequestBody VersionedCommandRequest request,
            HttpServletRequest servletRequest) {
        return PlanResponse.from(service.resume(actor(principal, servletRequest), planId,
                request.version(), request.commandId()));
    }

    @PostMapping("/plans/{planId}/cancel")
    @PreAuthorize("hasAuthority('" + FulfillmentPermissionCodes.CANCEL + "')")
    public PlanResponse cancel(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            @Valid @RequestBody ReasonedCommandRequest request,
            HttpServletRequest servletRequest) {
        return PlanResponse.from(service.cancelOpen(actor(principal, servletRequest), planId,
                request.version(), request.commandId(), request.reasonCode()));
    }

    private static Actor actor(ErpPrincipal principal, HttpServletRequest request) {
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
        return new Actor(principal.tenantId(), principal.userId(), principal.systemAdminId(),
                requestId, request.getRemoteAddr());
    }
}
