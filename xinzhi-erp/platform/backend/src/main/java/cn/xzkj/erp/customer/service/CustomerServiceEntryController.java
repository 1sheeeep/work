package cn.xzkj.erp.customer.service;

import cn.xzkj.erp.customer.service.CustomerServiceEntryGrantService.IssuedEntryGrant;
import cn.xzkj.erp.customer.service.CustomerServiceEntryGrantService.RedeemedIdentity;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.http.HttpHeaders;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/v1")
public class CustomerServiceEntryController {

    private final CustomerServiceEntryGrantService service;

    public CustomerServiceEntryController(CustomerServiceEntryGrantService service) {
        this.service = service;
    }

    @PostMapping("/customer-service/entry-grants")
    @PreAuthorize("hasAuthority('customer_service.read')")
    public IssuedEntryGrant issue(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody IssueRequest body,
            HttpServletRequest request,
            HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        return service.issue(
                principal,
                body.targetOrigin(),
                requestId(request),
                request.getRemoteAddr());
    }

    @PostMapping("/internal/customer-service/entry-grants/redeem")
    @PreAuthorize("hasAuthority('internal.customer_service.entry_grant.redeem')")
    public RedeemedIdentity redeem(
            @Valid @RequestBody RedeemRequest body,
            HttpServletRequest request,
            HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        return service.redeem(
                body.grant(),
                body.tenantId(),
                body.userId(),
                body.targetOrigin(),
                requestId(request),
                request.getRemoteAddr());
    }

    @PostMapping("/internal/customer-service/session/validate")
    @PreAuthorize("hasAuthority('internal.customer_service.entry_grant.redeem')")
    public RedeemedIdentity validateSession(@Valid @RequestBody RedeemRequest body, HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        return service.validateSession(body.grant(), body.tenantId(), body.userId(), body.targetOrigin());
    }

    private static String requestId(HttpServletRequest request) {
        String value = request.getHeader("X-Request-Id");
        if (value == null || value.isBlank()) {
            return null;
        }
        value = value.strip();
        return value.matches("^[A-Za-z0-9._:-]{1,100}$") ? value : null;
    }

    public record IssueRequest(
            @NotBlank @Size(max = 512) String targetOrigin) {
    }

    public record RedeemRequest(
            @NotBlank @Size(max = 128) String grant,
            @NotNull UUID tenantId,
            @NotNull UUID userId,
            @NotBlank @Size(max = 512) String targetOrigin) {
    }
}
