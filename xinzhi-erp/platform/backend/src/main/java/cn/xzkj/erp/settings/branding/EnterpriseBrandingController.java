package cn.xzkj.erp.settings.branding;

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
import jakarta.validation.constraints.Min;

@RestController
@Validated
@RequestMapping("/api/v1/settings/enterprise-branding")
public class EnterpriseBrandingController {
    private final EnterpriseBrandingService service;

    public EnterpriseBrandingController(EnterpriseBrandingService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('settings.read')")
    public BrandingResponse get(@AuthenticationPrincipal ErpPrincipal principal,
            HttpServletRequest request) {
        return BrandingResponse.from(service.get(actor(principal, request, false)));
    }

    @PutMapping
    @PreAuthorize("hasAuthority('settings.enterprise.write')")
    public BrandingResponse save(@AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody BrandingRequest body, HttpServletRequest request) {
        return BrandingResponse.from(service.saveSettings(
                actor(principal, request, true), body.expectedVersion(),
                new EnterpriseBrandingService.SettingsInput(body.watermarkEnabled(),
                        body.watermarkUserName(), body.watermarkCompanyName(),
                        body.watermarkTime(), body.watermarkPhoneSuffix())));
    }

    private static EnterpriseBrandingService.Actor actor(ErpPrincipal principal,
            HttpServletRequest request, boolean requireRequest) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = requireRequest ? UUID.randomUUID().toString() : null;
        }
        return new EnterpriseBrandingService.Actor(principal.tenantId(),
                principal.userId(), principal.systemAdminId(), principal.displayName(),
                requestId, request.getRemoteAddr());
    }

    public record BrandingRequest(@Min(0) long expectedVersion,
            boolean watermarkEnabled, boolean watermarkUserName,
            boolean watermarkCompanyName, boolean watermarkTime,
            boolean watermarkPhoneSuffix) {
    }

    public record BrandingResponse(boolean configured, boolean watermarkEnabled,
            boolean watermarkUserName, boolean watermarkCompanyName,
            boolean watermarkTime, boolean watermarkPhoneSuffix, long version,
            String updatedByDisplayName, Instant updatedAt) {
        static BrandingResponse from(EnterpriseBrandingRecord source) {
            return new BrandingResponse(source.configured(), source.watermarkEnabled(),
                    source.watermarkUserName(), source.watermarkCompanyName(),
                    source.watermarkTime(), source.watermarkPhoneSuffix(),
                    source.version(), source.updatedByDisplayName(), source.updatedAt());
        }
    }
}
