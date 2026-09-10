package cn.xzkj.erp.settings.deadline;

import java.time.Instant;
import java.util.UUID;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

@RestController
@Validated
@RequestMapping("/api/v1/settings/order-shipping-deadline")
public class ShippingDeadlineSettingController {
    private final ShippingDeadlineSettingService service;

    public ShippingDeadlineSettingController(
            ShippingDeadlineSettingService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('settings.read')")
    public Response get(@AuthenticationPrincipal ErpPrincipal principal,
            HttpServletRequest request) {
        return Response.from(service.get(actor(principal, request)));
    }

    @PutMapping
    @PreAuthorize("hasAuthority('settings.parameter.write')")
    public Response save(@AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody SaveRequest body,
            HttpServletRequest request) {
        return Response.from(service.save(actor(principal, request),
                body.expectedVersion(), body.deadlineDays()));
    }

    private static ShippingDeadlineSettingService.Actor actor(
            ErpPrincipal principal, HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new ShippingDeadlineSettingService.Actor(
                principal.tenantId(), principal.userId(),
                principal.systemAdminId(), principal.displayName(), requestId,
                request.getRemoteAddr());
    }

    public record SaveRequest(@Min(0) long expectedVersion,
            @Min(1) @Max(365) int deadlineDays) {
    }

    public record Response(boolean configured, int deadlineDays, long version,
            String updatedByDisplayName, Instant createdAt, Instant updatedAt) {
        static Response from(ShippingDeadlineSettingRecord source) {
            return new Response(source.configured(), source.deadlineDays(),
                    source.version(), source.updatedByDisplayName(),
                    source.createdAt(), source.updatedAt());
        }
    }
}
