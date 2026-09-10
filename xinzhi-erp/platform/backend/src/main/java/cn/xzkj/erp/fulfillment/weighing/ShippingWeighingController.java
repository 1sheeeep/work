package cn.xzkj.erp.fulfillment.weighing;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.fulfillment.weighing.ShippingWeighingRecords.PackageWeighing;
import cn.xzkj.erp.fulfillment.weighing.ShippingWeighingRecords.WeighingEvent;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

@RestController
@RequestMapping("/api/v1/fulfillment-center/plans/{planId}/packages/{packageId}")
public class ShippingWeighingController {
    private final ShippingWeighingService service;

    public ShippingWeighingController(ShippingWeighingService service) {
        this.service = service;
    }

    @GetMapping("/weighing")
    @PreAuthorize("hasAuthority('fulfillments.read')")
    public PackageWeighing get(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @PathVariable UUID planId,
            @PathVariable UUID packageId) {
        return service.get(tenantId, planId, packageId);
    }

    @PutMapping("/packaging")
    @PreAuthorize("hasAuthority('fulfillments.pack.write')")
    public PackageWeighing assignPackaging(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            @PathVariable UUID packageId,
            @Valid @RequestBody AssignPackagingRequest request,
            HttpServletRequest httpRequest) {
        return service.assignPackaging(actor(principal, httpRequest), planId,
                packageId, request.packageVersion(), request.packagingTemplateId());
    }

    @PostMapping("/weighings")
    @PreAuthorize("hasAuthority('fulfillments.ship.write')")
    public WeighingEvent weigh(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            @PathVariable UUID packageId,
            @Valid @RequestBody WeighRequest request,
            HttpServletRequest httpRequest) {
        return service.weigh(actor(principal, httpRequest), planId, packageId,
                request.packageVersion(), request.commandId(), request.scaleId(),
                request.actualWeightGrams(), request.occurredAt());
    }

    @PostMapping("/weighing-overrides")
    @PreAuthorize("hasAuthority('fulfillments.weigh.override')")
    public WeighingEvent override(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID planId,
            @PathVariable UUID packageId,
            @Valid @RequestBody OverrideRequest request,
            HttpServletRequest httpRequest) {
        return service.override(actor(principal, httpRequest), planId, packageId,
                request.packageVersion(), request.commandId(),
                request.actualWeightGrams(), request.occurredAt(), request.reason());
    }

    @GetMapping("/weighings")
    @PreAuthorize("hasAuthority('fulfillments.read')")
    public WeighingEventListResponse events(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @PathVariable UUID planId,
            @PathVariable UUID packageId) {
        return new WeighingEventListResponse(service.events(tenantId, planId, packageId));
    }

    private static ShippingWeighingService.Actor actor(
            ErpPrincipal principal, HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null
                || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new ShippingWeighingService.Actor(
                principal.tenantId(), principal.userId(), principal.systemAdminId(),
                requestId, request.getRemoteAddr());
    }

    public record AssignPackagingRequest(
            @Min(0) long packageVersion,
            @NotNull UUID packagingTemplateId) {
    }

    public record WeighRequest(
            @Min(0) long packageVersion,
            @NotNull UUID commandId,
            @NotNull UUID scaleId,
            @Min(1) @Max(999999999) long actualWeightGrams,
            @NotNull Instant occurredAt) {
    }

    public record OverrideRequest(
            @Min(0) long packageVersion,
            @NotNull UUID commandId,
            @Min(1) @Max(999999999) long actualWeightGrams,
            @NotNull Instant occurredAt,
            @NotBlank @Size(max = 500) String reason) {
    }

    public record WeighingEventListResponse(List<WeighingEvent> items) {
    }
}
