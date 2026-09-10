package cn.xzkj.erp.iam.web;

import cn.xzkj.erp.iam.application.IamActor;
import cn.xzkj.erp.iam.application.IamAdministrationService;
import cn.xzkj.erp.iam.application.LoginCommand;
import cn.xzkj.erp.iam.application.LoginResult;
import cn.xzkj.erp.iam.application.LoginService;
import cn.xzkj.erp.iam.application.IamValidationException;
import cn.xzkj.erp.iam.domain.BusinessEmailAddress;
import cn.xzkj.erp.iam.domain.LoginIdentifier;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platformadmin.domain.SystemAdminStatus;
import cn.xzkj.erp.tenantaccess.TenantEntitlementService;
import cn.xzkj.erp.tenantaccess.TenantEntitlementService.ApplicationAccess;
import cn.xzkj.erp.tenantaccess.UserApplicationAccessService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final LoginService loginService;
    private final IamAdministrationService administrationService;
    private final TenantEntitlementService entitlementService;
    private final UserApplicationAccessService userApplicationAccessService;

    @Autowired
    public AuthController(
            LoginService loginService,
            IamAdministrationService administrationService,
            TenantEntitlementService entitlementService,
            UserApplicationAccessService userApplicationAccessService) {
        this.loginService = loginService;
        this.administrationService = administrationService;
        this.entitlementService = entitlementService;
        this.userApplicationAccessService = userApplicationAccessService;
    }

    AuthController(
            LoginService loginService,
            IamAdministrationService administrationService) {
        this(loginService, administrationService, null, null);
    }

    @PostMapping("/login")
    public LoginResponse login(
            @Valid @RequestBody LoginRequest body,
            HttpServletRequest request) {
        LoginResult result = loginService.login(new LoginCommand(
                body.tenantCode(),
                body.normalizedLoginIdentifier(),
                body.password(),
                requestId(request),
                request.getRemoteAddr()));
        return new LoginResponse(
                "Bearer",
                result.accessToken(),
                result.expiresAt(),
                new TenantResponse(
                        result.tenantId(),
                        result.tenantCode(),
                        result.tenantName()),
                new UserResponse(
                        result.userId(),
                        result.username(),
                        result.email(),
                        LoginIdentifier.normalizePhone(result.username()),
                        result.displayName()),
                effectivePermissions(result.tenantId(), result.permissions()),
                applicationAccess(result.tenantId(), result.userId(), false));
    }

    @GetMapping("/me")
    public CurrentUserResponse me(
            @AuthenticationPrincipal ErpPrincipal principal,
            Authentication authentication) {
        boolean platformTenantSession =
                principal.systemAdminId() != null;
        return new CurrentUserResponse(
                new TenantResponse(
                        principal.tenantId(),
                        principal.tenantCode(),
                        principal.tenantName()),
                platformTenantSession
                        ? null
                        : new UserResponse(
                                principal.userId(),
                                principal.username(),
                                principal.email(),
                                LoginIdentifier.normalizePhone(principal.username()),
                                principal.displayName()),
                platformTenantSession
                        ? new PlatformAdminResponse(
                                principal.systemAdminId(),
                                principal.username(),
                                principal.email(),
                                LoginIdentifier.normalizePhone(principal.username()),
                                principal.displayName(),
                                SystemAdminStatus.ACTIVE)
                        : null,
                authentication.getAuthorities().stream()
                        .map(authority -> authority.getAuthority())
                        .sorted()
                        .toList(),
                applicationAccess(
                        principal.tenantId(),
                        principal.userId(),
                        platformTenantSession),
                principal.expiresAt());
    }

    @PutMapping("/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void changePassword(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ChangePasswordRequest body,
            HttpServletRequest request) {
        administrationService.changeOwnPassword(
                new IamActor(
                        principal.tenantId(),
                        principal.userId(),
                        principal.systemAdminId(),
                        requestId(request),
                        request.getRemoteAddr()),
                body.currentPassword().toCharArray(),
                body.newPassword().toCharArray());
    }

    @DeleteMapping("/session")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(
            @AuthenticationPrincipal ErpPrincipal principal,
            HttpServletRequest request) {
        loginService.logout(
                principal,
                requestId(request),
                request.getRemoteAddr());
    }

    private static String requestId(HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || requestId.isBlank()) {
            return null;
        }
        return requestId.substring(0, Math.min(requestId.length(), 100));
    }

    private List<String> effectivePermissions(
            UUID tenantId,
            List<String> permissions) {
        return entitlementService == null
                ? permissions
                : entitlementService.filterPermissionCodes(tenantId, permissions);
    }

    private List<ApplicationAccess> applicationAccess(
            UUID tenantId,
            UUID userId,
            boolean platformTenantSession) {
        if (entitlementService == null) {
            return List.of();
        }
        return platformTenantSession
                ? entitlementService.platformSessionAccess()
                : userApplicationAccessService == null
                        ? entitlementService.sessionAccess(tenantId)
                        : userApplicationAccessService.sessionAccess(tenantId, userId);
    }

    public record LoginRequest(
            @NotBlank
            @Pattern(regexp = "^[a-z0-9][a-z0-9_-]{0,63}$")
            String tenantCode,
            @Size(max = 254)
            String email,
            @Size(max = 120)
            String username,
            @NotBlank
            @Size(max = 128)
            String password) {

        public LoginRequest(
                String tenantCode,
                String username,
                String password) {
            this(tenantCode, null, username, password);
        }

        @AssertTrue
        public boolean isLoginIdentifierValid() {
            boolean hasEmail = email != null && !email.isBlank();
            boolean hasUsername = username != null && !username.isBlank();
            return hasEmail != hasUsername
                    && (!hasEmail || BusinessEmailAddress.isValid(email));
        }

        String normalizedLoginIdentifier() {
            if (email == null || email.isBlank()) {
                return username;
            }
            try {
                return BusinessEmailAddress.normalize(email);
            } catch (IllegalArgumentException invalidEmail) {
                throw new IamValidationException();
            }
        }
    }

    public record ChangePasswordRequest(
            @NotBlank @Size(max = 128)
            String currentPassword,
            @NotBlank @Size(max = 128)
            String newPassword) {
    }

    public record LoginResponse(
            String tokenType,
            String accessToken,
            Instant expiresAt,
            TenantResponse tenant,
            UserResponse user,
            List<String> permissions,
            List<ApplicationAccess> applications) {

        public LoginResponse {
            permissions = List.copyOf(permissions);
            applications = List.copyOf(applications);
        }
    }

    public record CurrentUserResponse(
            TenantResponse tenant,
            UserResponse user,
            PlatformAdminResponse platformAdmin,
            List<String> permissions,
            List<ApplicationAccess> applications,
            Instant expiresAt) {

        public CurrentUserResponse {
            if ((user == null) == (platformAdmin == null)) {
                throw new IllegalArgumentException(
                        "Exactly one authenticated identity is required");
            }
            permissions = List.copyOf(permissions);
            applications = List.copyOf(applications);
        }
    }

    public record TenantResponse(UUID id, String code, String name) {
    }

    public record UserResponse(
            UUID id,
            String username,
            String email,
            String phoneNumber,
            String displayName) {
    }

    public record PlatformAdminResponse(
            UUID id,
            String username,
            String email,
            String phoneNumber,
            String displayName,
            SystemAdminStatus status) {
    }
}
