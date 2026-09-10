package cn.xzkj.erp.settings.enterprise;

import java.time.Instant;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.settings.enterprise.EnterpriseProfileService.Actor;
import cn.xzkj.erp.settings.enterprise.EnterpriseProfileService.ProfileInput;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@RestController
@Validated
@RequestMapping("/api/v1/settings/enterprise-profile")
public class EnterpriseProfileController {
    private final EnterpriseProfileService service;

    public EnterpriseProfileController(EnterpriseProfileService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('settings.read')")
    public Response get(
            @AuthenticationPrincipal ErpPrincipal principal,
            HttpServletRequest request) {
        return Response.from(service.get(actor(principal, request, null)));
    }

    @PutMapping
    @PreAuthorize("hasAuthority('settings.enterprise.write')")
    public Response save(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$") String requestId,
            @Valid @RequestBody SaveRequest body,
            HttpServletRequest request) {
        return Response.from(service.save(actor(principal, request, requestId),
                body.expectedVersion(), body.profile().toInput()));
    }

    private static Actor actor(ErpPrincipal principal,
            HttpServletRequest request, String requestId) {
        return new Actor(principal.tenantId(), principal.userId(),
                principal.systemAdminId(), requestId, request.getRemoteAddr());
    }

    public record SaveRequest(
            @Min(0) long expectedVersion,
            @NotNull @Valid ProfileRequest profile) {
    }

    public record ProfileRequest(
            @NotBlank @Size(max = 160) String companyName,
            @Size(max = 100) String province,
            @Size(max = 100) String city,
            @Size(max = 100) String district,
            @Size(max = 500) String detailedAddress,
            @NotBlank @Size(max = 160) String contactName,
            @NotBlank @Email @Size(max = 254) String contactEmail,
            @Pattern(regexp = "^$|^[0-9]{5,20}$") String contactQq,
            @NotBlank @Size(max = 32)
            @Pattern(regexp = "^[+()0-9 .-]{6,32}$") String contactMobile,
            @Pattern(regexp = "^$|^[+()0-9 .-]{6,32}$") String contactTelephone) {
        ProfileInput toInput() {
            return new ProfileInput(companyName, province, city, district,
                    detailedAddress, contactName, contactEmail, contactQq,
                    contactMobile, contactTelephone);
        }
    }

    public record Response(
            String tenantCode,
            String tenantName,
            boolean configured,
            String companyName,
            String province,
            String city,
            String district,
            String detailedAddress,
            String contactName,
            String contactEmail,
            String contactQq,
            String contactMobile,
            String contactTelephone,
            long version,
            Instant createdAt,
            Instant updatedAt) {
        static Response from(EnterpriseProfileRecord source) {
            return new Response(source.tenantCode(), source.tenantName(),
                    source.configured(), source.companyName(), source.province(),
                    source.city(), source.district(), source.detailedAddress(),
                    source.contactName(), source.contactEmail(), source.contactQq(),
                    source.contactMobile(), source.contactTelephone(),
                    source.version(), source.createdAt(), source.updatedAt());
        }
    }
}
