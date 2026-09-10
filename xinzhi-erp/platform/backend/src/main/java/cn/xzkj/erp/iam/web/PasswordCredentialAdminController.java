package cn.xzkj.erp.iam.web;

import cn.xzkj.erp.iam.application.IamActor;
import cn.xzkj.erp.iam.application.PageResult;
import cn.xzkj.erp.iam.application.PasswordCredentialService;
import cn.xzkj.erp.iam.application.PasswordCredentialService.CredentialMetadataView;
import cn.xzkj.erp.iam.application.PasswordCredentialService.IssuedCredential;
import cn.xzkj.erp.iam.domain.IamPermissionCodes;
import cn.xzkj.erp.iam.domain.PasswordCredentialPurpose;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/iam/members/{userId}/password-credentials")
public class PasswordCredentialAdminController {

    private static final java.util.regex.Pattern REQUEST_ID_FORMAT =
            java.util.regex.Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");

    private final PasswordCredentialService service;

    public PasswordCredentialAdminController(PasswordCredentialService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.USER_READ + "')")
    public PageResult<CredentialMetadataView> list(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @PathVariable UUID userId,
            @RequestParam(defaultValue = "0")
            @Min(0) @Max(PasswordCredentialService.MAX_PAGE_NUMBER)
            int page,
            @RequestParam(defaultValue = "20")
            @Min(1) @Max(PasswordCredentialService.MAX_PAGE_SIZE)
            int size) {
        return service.listMetadata(tenantId, userId, page, size);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.USER_WRITE + "')")
    public IssuedCredential issue(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID userId,
            @Valid @RequestBody IssueCredentialRequest body,
            HttpServletRequest request) {
        return service.issue(
                actor(principal, request),
                userId,
                body.purpose(),
                body.expiresInMinutes());
    }

    @DeleteMapping("/{credentialId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.USER_WRITE + "')")
    public void revoke(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID userId,
            @PathVariable UUID credentialId,
            HttpServletRequest request) {
        service.revoke(
                actor(principal, request),
                userId,
                credentialId);
    }

    private static IamActor actor(
            ErpPrincipal principal,
            HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId != null) {
            requestId = requestId.strip();
            if (requestId.isEmpty()) {
                requestId = null;
            } else {
                requestId = requestId.substring(0, Math.min(100, requestId.length()));
                if (!REQUEST_ID_FORMAT.matcher(requestId).matches()) {
                    requestId = null;
                }
            }
        }
        return new IamActor(
                principal.tenantId(),
                principal.userId(),
                principal.systemAdminId(),
                requestId,
                request.getRemoteAddr());
    }

    public static final class IssueCredentialRequest {

        @NotNull
        private PasswordCredentialPurpose purpose;

        @Min(PasswordCredentialService.MINIMUM_TTL_MINUTES)
        @Max(PasswordCredentialService.MAXIMUM_TTL_MINUTES)
        private Integer expiresInMinutes;

        private boolean unexpectedField;

        public PasswordCredentialPurpose purpose() {
            return purpose;
        }

        public void setPurpose(PasswordCredentialPurpose purpose) {
            this.purpose = purpose;
        }

        public Integer expiresInMinutes() {
            return expiresInMinutes;
        }

        public void setExpiresInMinutes(Integer expiresInMinutes) {
            this.expiresInMinutes = expiresInMinutes;
        }

        @JsonAnySetter
        public void rejectUnexpectedField(String name, Object ignoredValue) {
            unexpectedField = true;
        }

        @AssertTrue
        public boolean isSchemaValid() {
            return !unexpectedField;
        }
    }
}
