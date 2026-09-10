package cn.xzkj.erp.iam.web;

import cn.xzkj.erp.iam.application.IamActor;
import cn.xzkj.erp.iam.application.IamAdministrationService;
import cn.xzkj.erp.iam.application.IamAdministrationService.AssignmentView;
import cn.xzkj.erp.iam.application.IamAdministrationService.MemberView;
import cn.xzkj.erp.iam.application.IamAdministrationService.PermissionView;
import cn.xzkj.erp.iam.application.IamAdministrationService.RoleView;
import cn.xzkj.erp.iam.application.PageResult;
import cn.xzkj.erp.iam.domain.AccountStatus;
import cn.xzkj.erp.iam.domain.IamPermissionCodes;
import cn.xzkj.erp.iam.persistence.AuditLogRecord;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeMode;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeService;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeService.WarehouseScopeView;
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
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
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
@RequestMapping("/api/v1/iam")
public class IamAdminController {

    private static final java.util.regex.Pattern REQUEST_ID_FORMAT =
            java.util.regex.Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");

    private final IamAdministrationService service;
    private final WarehouseScopeService warehouseScopeService;

    public IamAdminController(
            IamAdministrationService service,
            WarehouseScopeService warehouseScopeService) {
        this.service = service;
        this.warehouseScopeService = warehouseScopeService;
    }

    @GetMapping("/members")
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.USER_READ + "')")
    public PageResult<MemberView> listMembers(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @RequestParam(required = false)
            String query,
            @RequestParam(required = false)
            AccountStatus status,
            @RequestParam(required = false)
            UUID roleId,
            @RequestParam(defaultValue = "0")
            @Min(0) @Max(IamAdministrationService.MAX_PAGE_NUMBER)
            int page,
            @RequestParam(defaultValue = "20")
            @Min(1) @Max(IamAdministrationService.MAX_PAGE_SIZE)
            int size) {
        return service.listMembers(
                tenantId,
                query,
                status,
                roleId,
                page,
                size);
    }

    @PostMapping("/members")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.USER_WRITE + "')")
    public MemberView createMember(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody CreateMemberRequest body,
            HttpServletRequest request) {
        return service.createMember(
                actor(principal, request),
                body.loginEmail(),
                body.phoneNumber(),
                body.displayName(),
                body.initialPassword().toCharArray(),
                new LinkedHashSet<>(body.roleIds()));
    }

    @PatchMapping("/members/{userId}")
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.USER_WRITE + "')")
    public MemberView updateMember(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID userId,
            @Valid @RequestBody UpdateMemberRequest body,
            HttpServletRequest request) {
        return service.updateMember(
                actor(principal, request),
                userId,
                body.displayName(),
                body.phoneNumber(),
                body.phoneNumberSpecified(),
                body.version());
    }

    @PutMapping("/members/{userId}/status")
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.USER_WRITE + "')")
    public MemberView changeMemberStatus(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID userId,
            @Valid @RequestBody ChangeMemberStatusRequest body,
            HttpServletRequest request) {
        return service.changeMemberStatus(
                actor(principal, request),
                userId,
                body.status(),
                body.version());
    }

    @PutMapping("/members/{userId}/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.USER_WRITE + "')")
    public void resetMemberPassword(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID userId,
            @Valid @RequestBody ResetMemberPasswordRequest body,
            HttpServletRequest request) {
        service.resetMemberPassword(
                actor(principal, request),
                userId,
                body.newPassword().toCharArray(),
                body.version());
    }

    @PutMapping("/members/{userId}/roles")
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.ROLE_WRITE + "')")
    public AssignmentView replaceMemberRoles(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID userId,
            @Valid @RequestBody ReplaceAssignmentsRequest body,
            HttpServletRequest request) {
        return service.replaceMemberRoles(
                actor(principal, request),
                userId,
                new LinkedHashSet<>(body.ids()),
                body.version());
    }

    @GetMapping("/members/{userId}/roles")
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.ROLE_READ + "')")
    public AssignmentView getMemberRoles(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @PathVariable UUID userId) {
        return service.getMemberRoles(tenantId, userId);
    }

    @GetMapping("/members/{userId}/warehouse-scope")
    @PreAuthorize("hasAuthority('"
            + IamPermissionCodes.WAREHOUSE_SCOPE_READ + "')")
    public WarehouseScopeView getWarehouseScope(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID userId,
            HttpServletRequest request) {
        return warehouseScopeService.get(actor(principal, request), userId);
    }

    @PutMapping("/members/{userId}/warehouse-scope")
    @PreAuthorize("hasAuthority('"
            + IamPermissionCodes.WAREHOUSE_SCOPE_WRITE + "')")
    public WarehouseScopeView replaceWarehouseScope(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID userId,
            @Valid @RequestBody ReplaceWarehouseScopeRequest body,
            HttpServletRequest request) {
        return warehouseScopeService.replace(
                actor(principal, request),
                userId,
                body.version(),
                body.mode(),
                body.warehouseIds());
    }

    @GetMapping("/roles")
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.ROLE_READ + "')")
    public PageResult<RoleView> listRoles(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @RequestParam(defaultValue = "0")
            @Min(0) @Max(IamAdministrationService.MAX_PAGE_NUMBER)
            int page,
            @RequestParam(defaultValue = "20")
            @Min(1) @Max(IamAdministrationService.MAX_PAGE_SIZE)
            int size) {
        return service.listRoles(tenantId, page, size);
    }

    @PostMapping("/roles")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.ROLE_WRITE + "')")
    public RoleView createRole(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody CreateRoleRequest body,
            HttpServletRequest request) {
        return service.createRole(
                actor(principal, request),
                body.code(),
                body.name(),
                body.description());
    }

    @PatchMapping("/roles/{roleId}")
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.ROLE_WRITE + "')")
    public RoleView updateRole(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID roleId,
            @Valid @RequestBody UpdateRoleRequest body,
            HttpServletRequest request) {
        return service.updateRole(
                actor(principal, request),
                roleId,
                body.name(),
                body.description(),
                body.version());
    }

    @PutMapping("/roles/{roleId}/permissions")
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.PERMISSION_ASSIGN + "')")
    public AssignmentView replaceRolePermissions(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID roleId,
            @Valid @RequestBody ReplaceAssignmentsRequest body,
            HttpServletRequest request) {
        return service.replaceRolePermissions(
                actor(principal, request),
                roleId,
                new LinkedHashSet<>(body.ids()),
                body.version());
    }

    @GetMapping("/roles/{roleId}/permissions")
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.PERMISSION_READ + "')")
    public AssignmentView getRolePermissions(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @PathVariable UUID roleId) {
        return service.getRolePermissions(tenantId, roleId);
    }

    @GetMapping("/permissions")
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.PERMISSION_READ + "')")
    public PageResult<PermissionView> listPermissions(
            @RequestParam(defaultValue = "0")
            @Min(0) @Max(IamAdministrationService.MAX_PAGE_NUMBER)
            int page,
            @RequestParam(defaultValue = "20")
            @Min(1) @Max(IamAdministrationService.MAX_PAGE_SIZE)
            int size) {
        return service.listPermissions(page, size);
    }

    @GetMapping("/audit-logs")
    @PreAuthorize("hasAuthority('" + IamPermissionCodes.AUDIT_READ + "')")
    public PageResult<AuditLogRecord> listAuditLogs(
            @AuthenticationPrincipal(expression = "tenantId") UUID tenantId,
            @RequestParam(required = false)
            @Size(max = 160)
            @Pattern(regexp = "^[a-z][a-z0-9_.-]{1,159}$")
            String action,
            @RequestParam(required = false)
            @Size(max = 100)
            @Pattern(regexp = "^[a-z][a-z0-9_-]{0,99}$")
            String resourceType,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant from,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant to,
            @RequestParam(defaultValue = "0")
            @Min(0) @Max(IamAdministrationService.MAX_PAGE_NUMBER)
            int page,
            @RequestParam(defaultValue = "20")
            @Min(1) @Max(IamAdministrationService.MAX_PAGE_SIZE)
            int size) {
        return service.listAuditLogs(
                tenantId,
                action,
                resourceType,
                from,
                to,
                page,
                size);
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

    public static final class CreateMemberRequest {

        @Size(max = 254)
        private String email;

        @Size(max = 254)
        private String username;

        @Size(max = 16)
        private String phoneNumber;

        @NotBlank
        @Size(max = 160)
        private String displayName;

        @NotBlank
        @Size(max = 128)
        private String initialPassword;

        @NotNull
        @Size(max = 200)
        private List<@NotNull UUID> roleIds;

        private boolean unexpectedField;

        public String email() {
            return email;
        }

        public void setEmail(String email) {
            this.email = email;
        }

        public String username() {
            return username;
        }

        public void setUsername(String username) {
            this.username = username;
        }

        public String loginEmail() {
            return email == null || email.isBlank() ? username : email;
        }

        public String phoneNumber() {
            return phoneNumber;
        }

        public void setPhoneNumber(String phoneNumber) {
            this.phoneNumber = phoneNumber;
        }

        public String displayName() {
            return displayName;
        }

        public void setDisplayName(String displayName) {
            this.displayName = displayName;
        }

        public String initialPassword() {
            return initialPassword;
        }

        public void setInitialPassword(String initialPassword) {
            this.initialPassword = initialPassword;
        }

        public List<UUID> roleIds() {
            return roleIds;
        }

        public void setRoleIds(List<UUID> roleIds) {
            this.roleIds = roleIds;
        }

        @JsonAnySetter
        public void rejectUnexpectedField(String name, Object ignoredValue) {
            unexpectedField = true;
        }

        @AssertTrue
        public boolean isSchemaValid() {
            boolean hasEmail = email != null && !email.isBlank();
            boolean hasUsername = username != null && !username.isBlank();
            boolean hasPhone = phoneNumber != null && !phoneNumber.isBlank();
            return !unexpectedField
                    && !(hasEmail && hasUsername)
                    && (hasEmail || hasUsername || hasPhone);
        }
    }

    public static final class UpdateMemberRequest {

        private static final String OMITTED_PHONE_NUMBER =
                new String(new char[] {'\0'});

        @NotBlank
        @Size(max = 160)
        private String displayName;

        @Size(max = 16)
        private String phoneNumber = OMITTED_PHONE_NUMBER;

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

        public String phoneNumber() {
            return phoneNumber;
        }

        public void setPhoneNumber(String phoneNumber) {
            this.phoneNumber = phoneNumber;
        }

        public boolean phoneNumberSpecified() {
            return phoneNumber != OMITTED_PHONE_NUMBER;
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

    public record ChangeMemberStatusRequest(
            @NotNull
            AccountStatus status,
            @NotNull @PositiveOrZero
            Long version) {
    }

    public record ResetMemberPasswordRequest(
            @NotBlank @Size(max = 128)
            String newPassword,
            @NotNull @PositiveOrZero
            Long version) {
    }

    public record CreateRoleRequest(
            @NotBlank
            @Pattern(regexp = "^[a-z][a-z0-9_-]{0,99}$")
            String code,
            @NotBlank @Size(max = 160)
            String name,
            @Size(max = 500)
            String description) {
    }

    public record UpdateRoleRequest(
            @NotBlank @Size(max = 160)
            String name,
            @Size(max = 500)
            String description,
            @NotNull @PositiveOrZero
            Long version) {
    }

    public record ReplaceAssignmentsRequest(
            @NotNull @Size(max = 200)
            List<@NotNull UUID> ids,
            @NotNull @PositiveOrZero
            Long version) {
    }

    public static final class ReplaceWarehouseScopeRequest {

        @NotNull
        @PositiveOrZero
        private Long version;

        @NotNull
        private WarehouseScopeMode mode;

        @NotNull
        private List<@NotNull UUID> warehouseIds;

        private boolean unexpectedField;

        public Long version() {
            return version;
        }

        public void setVersion(Long version) {
            this.version = version;
        }

        public WarehouseScopeMode mode() {
            return mode;
        }

        public void setMode(WarehouseScopeMode mode) {
            this.mode = mode;
        }

        public List<UUID> warehouseIds() {
            return warehouseIds;
        }

        public void setWarehouseIds(List<UUID> warehouseIds) {
            this.warehouseIds = warehouseIds;
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
