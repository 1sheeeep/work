package cn.xzkj.erp.platformadmin.web;

import cn.xzkj.erp.iam.domain.AccountStatus;
import cn.xzkj.erp.iam.domain.BusinessEmailAddress;
import cn.xzkj.erp.iam.domain.TenantStatus;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.PageEnvelope;
import cn.xzkj.erp.platformadmin.application.PlatformAdminActor;
import cn.xzkj.erp.platformadmin.application.PlatformAdminAuthService;
import cn.xzkj.erp.platformadmin.application.PlatformAdminAuthService.AdminView;
import cn.xzkj.erp.platformadmin.application.PlatformAdminCredentialService;
import cn.xzkj.erp.platformadmin.application.PlatformAdminManagementService;
import cn.xzkj.erp.platformadmin.application.PlatformAdminManagementService.CreatedSystemAdmin;
import cn.xzkj.erp.platformadmin.application.PlatformAdminManagementService.SystemAdminView;
import cn.xzkj.erp.platformadmin.application.PlatformTenantManagementService;
import cn.xzkj.erp.platformadmin.application.PlatformTenantManagementService.CreatedEnterpriseAdmin;
import cn.xzkj.erp.platformadmin.application.PlatformTenantManagementService.CreatedTenant;
import cn.xzkj.erp.platformadmin.application.PlatformTenantManagementService.EnterpriseAdminView;
import cn.xzkj.erp.platformadmin.application.PlatformTenantManagementService.TenantView;
import cn.xzkj.erp.platformadmin.application.PlatformTenantSessionService;
import cn.xzkj.erp.platformadmin.security.PlatformAdminPrincipal;
import cn.xzkj.erp.tenantaccess.TenantEntitlementService;
import cn.xzkj.erp.tenantaccess.TenantEntitlementService.ApplicationSelection;
import cn.xzkj.erp.tenantaccess.TenantEntitlementService.EntitlementView;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/platform-admin")
public class PlatformAdminController {

    private static final java.util.regex.Pattern REQUEST_ID =
            java.util.regex.Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");

    private final PlatformAdminAuthService authService;
    private final PlatformAdminCredentialService credentialService;
    private final PlatformAdminManagementService adminService;
    private final PlatformTenantManagementService tenantService;
    private final PlatformTenantSessionService tenantSessionService;
    private final TenantEntitlementService entitlementService;

    public PlatformAdminController(
            PlatformAdminAuthService authService,
            PlatformAdminCredentialService credentialService,
            PlatformAdminManagementService adminService,
            PlatformTenantManagementService tenantService,
            PlatformTenantSessionService tenantSessionService,
            TenantEntitlementService entitlementService) {
        this.authService = authService;
        this.credentialService = credentialService;
        this.adminService = adminService;
        this.tenantService = tenantService;
        this.tenantSessionService = tenantSessionService;
        this.entitlementService = entitlementService;
    }

    @PostMapping("/auth/login")
    public LoginResponse login(
            @Valid @RequestBody LoginRequest body,
            HttpServletRequest request) {
        PlatformAdminAuthService.LoginResult result = authService.login(
                body.loginIdentifier(),
                body.password(),
                requestId(request),
                request.getRemoteAddr());
        return new LoginResponse(
                "Bearer",
                result.accessToken(),
                result.expiresAt(),
                result.admin());
    }

    @GetMapping("/auth/me")
    public MeResponse me(
            @AuthenticationPrincipal PlatformAdminPrincipal principal) {
        return new MeResponse(
                new AdminView(
                        principal.id(),
                        principal.username(),
                        principal.email(),
                        principal.phoneNumber(),
                        principal.displayName(),
                        cn.xzkj.erp.platformadmin.domain.SystemAdminStatus.ACTIVE),
                principal.expiresAt());
    }

    @DeleteMapping("/auth/session")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(
            @AuthenticationPrincipal PlatformAdminPrincipal principal,
            HttpServletRequest request) {
        authService.logout(
                principal,
                requestId(request),
                request.getRemoteAddr());
    }

    @PutMapping("/auth/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void changeOwnPassword(
            @AuthenticationPrincipal PlatformAdminPrincipal principal,
            @Valid @RequestBody ChangeOwnPasswordRequest body,
            HttpServletRequest request) {
        authService.changeOwnPassword(
                principal,
                body.currentPassword().toCharArray(),
                body.newPassword().toCharArray(),
                requestId(request),
                request.getRemoteAddr());
    }

    @PutMapping("/auth/password/reset")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void resetOwnPassword(
            @AuthenticationPrincipal PlatformAdminPrincipal principal,
            @Valid @RequestBody ResetOwnPasswordRequest body,
            HttpServletRequest request) {
        adminService.resetOwnPassword(
                actor(principal, request),
                body.newPassword().toCharArray());
    }

    @PostMapping("/auth/password-credentials/redeem")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void redeem(
            @Valid @RequestBody RedeemCredentialRequest body,
            HttpServletRequest request) {
        credentialService.redeem(
                body.token().toCharArray(),
                body.newPassword().toCharArray(),
                requestId(request),
                request.getRemoteAddr());
    }

    @GetMapping("/system-admins")
    public PageEnvelope<SystemAdminView> listSystemAdmins(
            @RequestParam(defaultValue = "0")
            @Min(0) @Max(PlatformAdminManagementService.MAX_PAGE_NUMBER)
            int page,
            @RequestParam(defaultValue = "20")
            @Min(1) @Max(PlatformAdminManagementService.MAX_PAGE_SIZE)
            int size) {
        return PageEnvelope.from(adminService.list(page, size), value -> value);
    }

    @PostMapping("/system-admins")
    @ResponseStatus(HttpStatus.CREATED)
    public CreatedSystemAdminResponse createSystemAdmin(
            @AuthenticationPrincipal PlatformAdminPrincipal principal,
            @Valid @RequestBody CreateSystemAdminRequest body,
            HttpServletRequest request) {
        CreatedSystemAdmin created = adminService.create(
                actor(principal, request),
                body.loginIdentifier(),
                body.displayName());
        return CreatedSystemAdminResponse.from(created);
    }

    @PutMapping("/system-admins/{adminId}")
    public SystemAdminView updateSystemAdmin(
            @AuthenticationPrincipal PlatformAdminPrincipal principal,
            @PathVariable UUID adminId,
            @Valid @RequestBody UpdateSystemAdminRequest body,
            HttpServletRequest request) {
        return adminService.update(
                actor(principal, request),
                adminId,
                body.loginIdentifier(),
                body.displayName(),
                body.version());
    }

    @PostMapping("/system-admins/{adminId}/activate")
    public SystemAdminView activateSystemAdmin(
            @AuthenticationPrincipal PlatformAdminPrincipal principal,
            @PathVariable UUID adminId,
            @Valid @RequestBody VersionRequest body,
            HttpServletRequest request) {
        return adminService.activate(
                actor(principal, request),
                adminId,
                body.version());
    }

    @PostMapping("/system-admins/{adminId}/disable")
    public SystemAdminView disableSystemAdmin(
            @AuthenticationPrincipal PlatformAdminPrincipal principal,
            @PathVariable UUID adminId,
            @Valid @RequestBody VersionRequest body,
            HttpServletRequest request) {
        return adminService.disable(
                actor(principal, request),
                adminId,
                body.version());
    }

    @PostMapping("/system-admins/{adminId}/delete")
    public SystemAdminView deleteSystemAdmin(
            @AuthenticationPrincipal PlatformAdminPrincipal principal,
            @PathVariable UUID adminId,
            @Valid @RequestBody VersionRequest body,
            HttpServletRequest request) {
        return adminService.delete(
                actor(principal, request),
                adminId,
                body.version());
    }

    @PostMapping("/system-admins/{adminId}/password-credentials")
    @ResponseStatus(HttpStatus.CREATED)
    public CredentialResponse issueResetCredential(
            @AuthenticationPrincipal PlatformAdminPrincipal principal,
            @PathVariable UUID adminId,
            HttpServletRequest request) {
        return CredentialResponse.from(adminService.issueReset(
                actor(principal, request),
                adminId));
    }

    @PutMapping("/system-admins/{adminId}/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void resetSystemAdminPassword(
            @AuthenticationPrincipal PlatformAdminPrincipal principal,
            @PathVariable UUID adminId,
            @Valid @RequestBody ResetPasswordRequest body,
            HttpServletRequest request) {
        adminService.resetPassword(
                actor(principal, request),
                adminId,
                body.newPassword().toCharArray(),
                body.version());
    }

    @GetMapping("/tenants")
    public PageEnvelope<TenantView> listTenants(
            @RequestParam(defaultValue = "0")
            @Min(0) @Max(PlatformTenantManagementService.MAX_PAGE_NUMBER)
            int page,
            @RequestParam(defaultValue = "20")
            @Min(1) @Max(PlatformTenantManagementService.MAX_PAGE_SIZE)
            int size) {
        return PageEnvelope.from(tenantService.list(page, size), value -> value);
    }

    @PostMapping("/tenants")
    @ResponseStatus(HttpStatus.CREATED)
    public CreatedTenantResponse createTenant(
            @AuthenticationPrincipal PlatformAdminPrincipal principal,
            @Valid @RequestBody CreateTenantRequest body,
            HttpServletRequest request) {
        return CreatedTenantResponse.from(tenantService.create(
                actor(principal, request),
                body.code(),
                body.name(),
                body.adminLoginIdentifier(),
                body.adminDisplayName(),
                body.adminInitialPassword().toCharArray()));
    }

    @GetMapping("/tenants/{tenantId}/enterprise-admins")
    public PageEnvelope<EnterpriseAdminView> listEnterpriseAdmins(
            @PathVariable UUID tenantId,
            @RequestParam(defaultValue = "0")
            @Min(0) @Max(PlatformTenantManagementService.MAX_PAGE_NUMBER)
            int page,
            @RequestParam(defaultValue = "20")
            @Min(1) @Max(PlatformTenantManagementService.MAX_PAGE_SIZE)
            int size) {
        return PageEnvelope.from(
                tenantService.listEnterpriseAdmins(tenantId, page, size),
                value -> value);
    }

    @PutMapping("/tenants/{tenantId}")
    public TenantView updateTenant(
            @AuthenticationPrincipal PlatformAdminPrincipal principal,
            @PathVariable UUID tenantId,
            @Valid @RequestBody UpdateTenantRequest body,
            HttpServletRequest request) {
        return tenantService.update(
                actor(principal, request),
                tenantId,
                body.name(),
                body.status(),
                body.version());
    }

    @GetMapping("/tenants/{tenantId}/entitlements")
    public EntitlementView getTenantEntitlements(
            @PathVariable UUID tenantId) {
        return entitlementService.view(tenantId);
    }

    @PutMapping("/tenants/{tenantId}/entitlements")
    public EntitlementView replaceTenantEntitlements(
            @AuthenticationPrincipal PlatformAdminPrincipal principal,
            @PathVariable UUID tenantId,
            @Valid @RequestBody UpdateTenantEntitlementsRequest body,
            HttpServletRequest request) {
        return entitlementService.replace(
                actor(principal, request),
                tenantId,
                body.version(),
                body.applications().stream()
                        .map(application -> new ApplicationSelection(
                                application.code(),
                                new LinkedHashSet<>(application.modules())))
                        .toList());
    }

    @PostMapping("/tenants/{tenantId}/enterprise-admins")
    @ResponseStatus(HttpStatus.CREATED)
    public CreatedEnterpriseAdminResponse createEnterpriseAdmin(
            @AuthenticationPrincipal PlatformAdminPrincipal principal,
            @PathVariable UUID tenantId,
            @Valid @RequestBody CreateEnterpriseAdminRequest body,
            HttpServletRequest request) {
        return CreatedEnterpriseAdminResponse.from(
                tenantService.createEnterpriseAdmin(
                        actor(principal, request),
                        tenantId,
                        body.loginIdentifier(),
                        body.displayName(),
                        body.initialPassword().toCharArray()));
    }

    @PutMapping("/tenants/{tenantId}/enterprise-admins/{userId}")
    public EnterpriseAdminView updateEnterpriseAdmin(
            @AuthenticationPrincipal PlatformAdminPrincipal principal,
            @PathVariable UUID tenantId,
            @PathVariable UUID userId,
            @Valid @RequestBody UpdateEnterpriseAdminRequest body,
            HttpServletRequest request) {
        return tenantService.updateEnterpriseAdmin(
                actor(principal, request),
                tenantId,
                userId,
                body.displayName(),
                body.status(),
                body.version());
    }

    @PutMapping("/tenants/{tenantId}/enterprise-admins/{userId}/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void resetEnterpriseAdminPassword(
            @AuthenticationPrincipal PlatformAdminPrincipal principal,
            @PathVariable UUID tenantId,
            @PathVariable UUID userId,
            @Valid @RequestBody ResetPasswordRequest body,
            HttpServletRequest request) {
        tenantService.resetEnterpriseAdminPassword(
                actor(principal, request),
                tenantId,
                userId,
                body.newPassword().toCharArray(),
                body.version());
    }

    @PostMapping("/tenants/{tenantId}/enter")
    public EnterTenantResponse enterTenant(
            @AuthenticationPrincipal PlatformAdminPrincipal principal,
            @PathVariable UUID tenantId,
            HttpServletRequest request) {
        PlatformTenantSessionService.EnteredTenantSession session =
                tenantSessionService.enter(
                        principal,
                        tenantId,
                        requestId(request),
                        request.getRemoteAddr());
        return new EnterTenantResponse(
                "Bearer",
                session.accessToken(),
                session.expiresAt(),
                session.tenant(),
                session.platformAdmin(),
                session.permissions(),
                entitlementService.platformSessionAccess());
    }

    @PostMapping("/tenants/{tenantId}/delete")
    public TenantView deleteTenant(
            @AuthenticationPrincipal PlatformAdminPrincipal principal,
            @PathVariable UUID tenantId,
            @Valid @RequestBody VersionRequest body,
            HttpServletRequest request) {
        return tenantService.delete(
                actor(principal, request),
                tenantId,
                body.version());
    }

    @DeleteMapping("/tenant-session")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void leaveTenant(
            @AuthenticationPrincipal ErpPrincipal principal,
            HttpServletRequest request) {
        tenantSessionService.logout(
                principal,
                requestId(request),
                request.getRemoteAddr());
    }

    private static PlatformAdminActor actor(
            PlatformAdminPrincipal principal,
            HttpServletRequest request) {
        return new PlatformAdminActor(
                principal.id(),
                principal.sessionId(),
                requestId(request),
                request.getRemoteAddr());
    }

    private static String requestId(HttpServletRequest request) {
        String value = request.getHeader("X-Request-Id");
        if (value == null) {
            return null;
        }
        value = value.strip();
        return REQUEST_ID.matcher(value).matches() ? value : null;
    }

    private static String onlyPresent(String... values) {
        String selected = null;
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                if (selected != null) {
                    return null;
                }
                selected = value;
            }
        }
        return selected;
    }

    public record LoginRequest(
            @Size(max = 254)
            String email,
            @Size(max = 120)
            String username,
            @NotBlank @Size(max = 128)
            String password) {

        public LoginRequest(String username, String password) {
            this(null, username, password);
        }

        @AssertTrue
        public boolean isLoginIdentifierValid() {
            boolean hasEmail = email != null && !email.isBlank();
            boolean hasUsername = username != null && !username.isBlank();
            return hasEmail != hasUsername
                    && (!hasEmail || BusinessEmailAddress.isValid(email));
        }

        String loginIdentifier() {
            return email == null || email.isBlank()
                    ? username
                    : BusinessEmailAddress.normalize(email);
        }
    }

    public record LoginResponse(
            String tokenType,
            String accessToken,
            Instant expiresAt,
            AdminView admin) {
    }

    public record MeResponse(AdminView admin, Instant expiresAt) {
    }

    public record ChangeOwnPasswordRequest(
            @NotBlank @Size(max = 128)
            String currentPassword,
            @NotBlank @Size(max = 128)
            String newPassword) {
    }

    public record ResetOwnPasswordRequest(
            @NotBlank @Size(max = 128)
            String newPassword) {
    }

    public record RedeemCredentialRequest(
            @NotBlank @Size(max = 128)
            String token,
            @NotBlank @Size(max = 128)
            String newPassword) {
    }

    public record CreateSystemAdminRequest(
            @Size(max = 254)
            String email,
            @Size(max = 16)
            String phoneNumber,
            @Size(max = 254)
            String username,
            @NotBlank @Size(max = 160)
            String displayName) {

        public CreateSystemAdminRequest(
                String username,
                String displayName) {
            this(null, null, username, displayName);
        }

        @AssertTrue
        public boolean isLoginIdentifierValid() {
            return onlyPresent(email, phoneNumber, username) != null;
        }

        String loginIdentifier() {
            return onlyPresent(email, phoneNumber, username);
        }
    }

    public record UpdateSystemAdminRequest(
            @NotBlank @Size(max = 254)
            String loginIdentifier,
            @NotBlank @Size(max = 160)
            String displayName,
            @NotNull @PositiveOrZero Long version) {
    }

    public record VersionRequest(
            @NotNull @PositiveOrZero Long version) {
    }

    public record CredentialResponse(String token, Instant expiresAt) {

        static CredentialResponse from(
                PlatformAdminCredentialService.IssuedCredential credential) {
            return new CredentialResponse(
                    credential.token(),
                    credential.expiresAt());
        }
    }

    public record CreatedSystemAdminResponse(
            UUID id,
            String username,
            String email,
            String phoneNumber,
            String displayName,
            cn.xzkj.erp.platformadmin.domain.SystemAdminStatus status,
            Instant createdAt,
            Instant updatedAt,
            long version,
            CredentialResponse activationCredential) {

        static CreatedSystemAdminResponse from(CreatedSystemAdmin created) {
            SystemAdminView admin = created.admin();
            return new CreatedSystemAdminResponse(
                    admin.id(),
                    admin.username(),
                    admin.email(),
                    admin.phoneNumber(),
                    admin.displayName(),
                    admin.status(),
                    admin.createdAt(),
                    admin.updatedAt(),
                    admin.version(),
                    CredentialResponse.from(created.credential()));
        }
    }

    public record CreateTenantRequest(
            @NotBlank
            @Pattern(regexp = "^[a-z0-9][a-z0-9_-]{0,63}$")
            String code,
            @NotBlank @Size(max = 160)
            String name,
            @Size(max = 254)
            String adminEmail,
            @Size(max = 16)
            String adminPhoneNumber,
            @Size(max = 254)
            String adminUsername,
            @NotBlank @Size(max = 160)
            String adminDisplayName,
            @NotBlank @Size(max = 128)
            String adminInitialPassword) {

        public CreateTenantRequest(
                String code,
                String name,
                String adminUsername,
                String adminDisplayName,
                String adminInitialPassword) {
            this(
                    code,
                    name,
                    null,
                    null,
                    adminUsername,
                    adminDisplayName,
                    adminInitialPassword);
        }

        @AssertTrue
        public boolean isLoginIdentifierValid() {
            return onlyPresent(
                    adminEmail,
                    adminPhoneNumber,
                    adminUsername) != null;
        }

        String adminLoginIdentifier() {
            return onlyPresent(
                    adminEmail,
                    adminPhoneNumber,
                    adminUsername);
        }
    }

    public record UpdateTenantRequest(
            @NotBlank @Size(max = 160)
            String name,
            @NotNull TenantStatus status,
            @NotNull @PositiveOrZero Long version) {
    }

    public record UpdateTenantEntitlementsRequest(
            @NotNull @PositiveOrZero Long version,
            @NotNull @Size(max = 4)
            List<@Valid TenantApplicationSelectionRequest> applications) {

        public UpdateTenantEntitlementsRequest {
            applications = applications == null
                    ? null
                    : List.copyOf(applications);
        }
    }

    public record TenantApplicationSelectionRequest(
            @NotBlank @Size(max = 40)
            String code,
            @NotNull @Size(min = 1, max = 12)
            List<@NotBlank @Size(max = 64) String> modules) {

        public TenantApplicationSelectionRequest {
            modules = modules == null ? null : List.copyOf(modules);
        }
    }

    public record CreateEnterpriseAdminRequest(
            @Size(max = 254)
            String email,
            @Size(max = 16)
            String phoneNumber,
            @Size(max = 254)
            String username,
            @NotBlank @Size(max = 160)
            String displayName,
            @NotBlank @Size(max = 128)
            String initialPassword) {

        public CreateEnterpriseAdminRequest(
                String username,
                String displayName,
                String initialPassword) {
            this(null, null, username, displayName, initialPassword);
        }

        @AssertTrue
        public boolean isLoginIdentifierValid() {
            return onlyPresent(email, phoneNumber, username) != null;
        }

        String loginIdentifier() {
            return onlyPresent(email, phoneNumber, username);
        }
    }

    public static final class UpdateEnterpriseAdminRequest {

        @NotBlank
        @Size(max = 160)
        private String displayName;

        @NotNull
        private AccountStatus status;

        @NotNull
        @PositiveOrZero
        private Long version;

        private boolean unexpectedField;

        public String displayName() {
            return displayName;
        }

        public void setDisplayName(String displayName) {
            this.displayName = displayName;
        }

        public AccountStatus status() {
            return status;
        }

        public void setStatus(AccountStatus status) {
            this.status = status;
        }

        public Long version() {
            return version;
        }

        public void setVersion(Long version) {
            this.version = version;
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

    public record ResetPasswordRequest(
            @NotBlank @Size(max = 128)
            String newPassword,
            @NotNull @PositiveOrZero Long version) {
    }

    public record CreatedEnterpriseAdminResponse(
            EnterpriseAdminView admin) {

        static CreatedEnterpriseAdminResponse from(
                CreatedEnterpriseAdmin created) {
            return new CreatedEnterpriseAdminResponse(created.admin());
        }
    }

    public record CreatedTenantResponse(
            TenantView tenant,
            EnterpriseAdminView enterpriseAdmin) {

        static CreatedTenantResponse from(CreatedTenant created) {
            return new CreatedTenantResponse(
                    created.tenant(),
                    created.enterpriseAdmin().admin());
        }
    }

    public record EnterTenantResponse(
            String tokenType,
            String accessToken,
            Instant expiresAt,
            PlatformTenantSessionService.TenantSessionTenant tenant,
            PlatformTenantSessionService.TenantSessionAdmin platformAdmin,
            List<String> permissions,
            List<TenantEntitlementService.ApplicationAccess> applications) {

        public EnterTenantResponse {
            permissions = List.copyOf(permissions);
            applications = List.copyOf(applications);
        }
    }
}
