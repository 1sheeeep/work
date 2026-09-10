package cn.xzkj.erp.platformadmin.application;

import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.ENTERPRISE_ADMIN_CREATED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.ENTERPRISE_ADMIN_PASSWORD_RESET;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.ENTERPRISE_ADMIN_UPDATED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.TENANT_CREATED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.TENANT_DELETED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.TENANT_UPDATED;

import cn.xzkj.erp.iam.application.IamConflictException;
import cn.xzkj.erp.iam.application.IamNotFoundException;
import cn.xzkj.erp.iam.application.IamOptimisticLockException;
import cn.xzkj.erp.iam.application.IamValidationException;
import cn.xzkj.erp.iam.application.PasswordHashingService;
import cn.xzkj.erp.iam.domain.AccountStatus;
import cn.xzkj.erp.iam.domain.LoginIdentifier;
import cn.xzkj.erp.iam.domain.TenantStatus;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.IamAssignmentStore;
import cn.xzkj.erp.iam.persistence.PermissionEntity;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.persistence.PasswordCredentialRepository;
import cn.xzkj.erp.iam.persistence.RoleEntity;
import cn.xzkj.erp.iam.persistence.RoleRepository;
import cn.xzkj.erp.iam.persistence.TenantEntity;
import cn.xzkj.erp.iam.persistence.TenantRepository;
import cn.xzkj.erp.iam.persistence.UserAccountEntity;
import cn.xzkj.erp.iam.persistence.UserAccountRepository;
import cn.xzkj.erp.iam.roles.PresetRoleCatalog;
import cn.xzkj.erp.iam.roles.PresetRoleProvisioningService;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditEvent;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditRecorder;
import cn.xzkj.erp.platformadmin.persistence.PlatformTenantSessionRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PlatformTenantManagementService {

    public static final String ENTERPRISE_ADMIN_ROLE_CODE = "tenant_admin";
    public static final int MAX_PAGE_SIZE = 200;
    public static final int MAX_PAGE_NUMBER = 1_000_000;

    private static final Pattern TENANT_CODE =
            Pattern.compile("^[a-z0-9][a-z0-9_-]{0,63}$");
    private final TenantRepository tenantRepository;
    private final UserAccountRepository userRepository;
    private final RoleRepository roleRepository;
    private final PermissionRepository permissionRepository;
    private final IamAssignmentStore assignmentStore;
    private final PasswordHashingService passwordHashingService;
    private final AuthSessionRepository authSessionRepository;
    private final PlatformTenantSessionRepository tenantSessionRepository;
    private final PasswordCredentialRepository credentialRepository;
    private final PlatformAdminAuditRecorder auditRecorder;
    private final PresetRoleProvisioningService presetRoleProvisioningService;
    private final Clock clock;

    public PlatformTenantManagementService(
            TenantRepository tenantRepository,
            UserAccountRepository userRepository,
            RoleRepository roleRepository,
            PermissionRepository permissionRepository,
            IamAssignmentStore assignmentStore,
            PasswordHashingService passwordHashingService,
            AuthSessionRepository authSessionRepository,
            PlatformTenantSessionRepository tenantSessionRepository,
            PasswordCredentialRepository credentialRepository,
            PlatformAdminAuditRecorder auditRecorder,
            PresetRoleProvisioningService presetRoleProvisioningService,
            Clock clock) {
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.permissionRepository = permissionRepository;
        this.assignmentStore = assignmentStore;
        this.passwordHashingService = passwordHashingService;
        this.authSessionRepository = authSessionRepository;
        this.tenantSessionRepository = tenantSessionRepository;
        this.credentialRepository = credentialRepository;
        this.auditRecorder = auditRecorder;
        this.presetRoleProvisioningService = presetRoleProvisioningService;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public Page<TenantView> list(int page, int size) {
        requirePage(page, size);
        return tenantRepository.findAllByDeletedAtIsNull(PageRequest.of(
                        page,
                        size,
                        Sort.by("code").ascending()))
                .map(this::view);
    }

    @Transactional(readOnly = true)
    public Page<EnterpriseAdminView> listEnterpriseAdmins(
            UUID tenantId,
            int page,
            int size) {
        requirePage(page, size);
        tenantRepository.findById(tenantId)
                .orElseThrow(IamNotFoundException::new);
        return userRepository.findEnterpriseAdmins(
                        tenantId,
                        ENTERPRISE_ADMIN_ROLE_CODE,
                        PageRequest.of(page, size))
                .map(PlatformTenantManagementService::enterpriseAdminView);
    }

    @Transactional
    public CreatedTenant create(
            PlatformAdminActor actor,
            String code,
            String name,
            String adminLoginIdentifier,
            String adminDisplayName,
            char[] adminInitialPassword) {
        try {
            String normalizedCode = requireCode(code);
            String normalizedName = requireText(name, 160);
            LoginIdentifier.Normalized adminIdentity =
                    requireLoginIdentifier(adminLoginIdentifier);
            String normalizedDisplayName = requireText(adminDisplayName, 160);
            if (tenantRepository.existsByCode(normalizedCode)) {
                throw new IamConflictException();
            }
            Instant now = clock.instant();
            TenantEntity tenant;
            try {
                tenant = tenantRepository.saveAndFlush(new TenantEntity(
                        UUID.randomUUID(),
                        normalizedCode,
                        normalizedName,
                        TenantStatus.ACTIVE,
                        now));
            } catch (DataIntegrityViolationException concurrentCode) {
                throw new IamConflictException();
            }
            RoleEntity role = roleRepository.saveAndFlush(RoleEntity.systemRole(
                    UUID.randomUUID(),
                    tenant,
                    ENTERPRISE_ADMIN_ROLE_CODE,
                    PresetRoleCatalog.ENTERPRISE_ADMIN_NAME,
                    PresetRoleCatalog.ENTERPRISE_ADMIN_DESCRIPTION,
                    now));
            assignmentStore.replaceRolePermissions(
                    tenant.getId(),
                    role.getId(),
                    allPermissionIds());
            presetRoleProvisioningService.provision(tenant, now);
            CreatedEnterpriseAdmin enterpriseAdmin =
                    createEnterpriseAdminDirect(
                            actor,
                            tenant,
                            role,
                            adminIdentity,
                            normalizedDisplayName,
                            adminInitialPassword,
                            false);
            audit(
                    actor,
                    tenant.getId(),
                    TENANT_CREATED,
                    "tenant",
                    tenant.getId(),
                    Map.of());
            return new CreatedTenant(view(tenant), enterpriseAdmin);
        } finally {
            clear(adminInitialPassword);
        }
    }

    @Transactional
    public TenantView update(
            PlatformAdminActor actor,
            UUID tenantId,
            String name,
            TenantStatus status,
            long expectedVersion) {
        TenantEntity tenant = tenantRepository.findByIdForUpdate(tenantId)
                .orElseThrow(IamNotFoundException::new);
        requireNotDeleted(tenant);
        if (tenant.getVersion() != expectedVersion) {
            throw new IamOptimisticLockException();
        }
        TenantStatus previousStatus = tenant.getStatus();
        tenant.update(requireText(name, 160), status, clock.instant());
        TenantEntity saved = tenantRepository.saveAndFlush(tenant);
        if (status != TenantStatus.ACTIVE
                && previousStatus == TenantStatus.ACTIVE) {
            Instant now = clock.instant();
            tenantSessionRepository.revokeAllForTenant(tenantId, now);
            authSessionRepository.revokeActiveForTenant(tenantId, now);
        }
        audit(
                actor,
                tenantId,
                TENANT_UPDATED,
                "tenant",
                tenantId,
                Map.of(
                        "previousStatus",
                        previousStatus.name(),
                        "status",
                        status.name()));
        return view(saved);
    }

    @Transactional
    public TenantView delete(
            PlatformAdminActor actor,
            UUID tenantId,
            long expectedVersion) {
        TenantEntity tenant = tenantRepository.findByIdForUpdate(tenantId)
                .orElseThrow(IamNotFoundException::new);
        requireNotDeleted(tenant);
        if (tenant.getVersion() != expectedVersion) {
            throw new IamOptimisticLockException();
        }
        Instant now = clock.instant();
        TenantStatus previousStatus = tenant.getStatus();
        tenant.softDelete(now);
        TenantEntity saved = tenantRepository.saveAndFlush(tenant);
        tenantSessionRepository.revokeAllForTenant(tenantId, now);
        authSessionRepository.revokeActiveForTenant(tenantId, now);
        audit(
                actor,
                tenantId,
                TENANT_DELETED,
                "tenant",
                tenantId,
                Map.of("previousStatus", previousStatus.name()));
        return view(saved);
    }

    @Transactional
    public CreatedEnterpriseAdmin createEnterpriseAdmin(
            PlatformAdminActor actor,
            UUID tenantId,
            String loginIdentifier,
            String displayName,
            char[] initialPassword) {
        try {
            TenantEntity tenant = tenantRepository.findByIdForUpdate(tenantId)
                    .orElseThrow(IamNotFoundException::new);
            if (tenant.getStatus() != TenantStatus.ACTIVE) {
                throw new IamConflictException();
            }
            RoleEntity role = requireEnterpriseAdminRole(tenantId);
            return createEnterpriseAdminDirect(
                    actor,
                    tenant,
                    role,
                    requireLoginIdentifier(loginIdentifier),
                    requireText(displayName, 160),
                    initialPassword,
                    true);
        } finally {
            clear(initialPassword);
        }
    }

    @Transactional
    public EnterpriseAdminView updateEnterpriseAdmin(
            PlatformAdminActor actor,
            UUID tenantId,
            UUID userId,
            String displayName,
            AccountStatus status,
            long expectedVersion) {
        UserAccountEntity user = requireEnterpriseAdminForUpdate(
                tenantId,
                userId);
        requireVersion(user, expectedVersion);
        if (user.getStatus() == AccountStatus.ACTIVE
                && status == AccountStatus.DISABLED) {
            RoleEntity role = requireEnterpriseAdminRole(tenantId);
            if (assignmentStore.countActiveUsersWithRole(
                    tenantId,
                    role.getId()) <= 1) {
                throw new IamConflictException();
            }
        }
        user.rename(requireText(displayName, 160), clock.instant());
        user.changeStatus(status, clock.instant());
        UserAccountEntity saved = userRepository.saveAndFlush(user);
        audit(
                actor,
                tenantId,
                ENTERPRISE_ADMIN_UPDATED,
                "user",
                userId,
                Map.of("status", status.name()));
        return enterpriseAdminView(saved);
    }

    @Transactional
    public void resetEnterpriseAdminPassword(
            PlatformAdminActor actor,
            UUID tenantId,
            UUID userId,
            char[] newPassword,
            long expectedVersion) {
        try {
            UserAccountEntity user = requireEnterpriseAdminForUpdate(
                    tenantId,
                    userId);
            requireVersion(user, expectedVersion);
            Instant now = clock.instant();
            user.changePassword(hash(newPassword), now);
            userRepository.saveAndFlush(user);
            credentialRepository.revokeAllOpenForUser(
                    tenantId,
                    userId,
                    now);
            audit(
                    actor,
                    tenantId,
                    ENTERPRISE_ADMIN_PASSWORD_RESET,
                    "user",
                    userId,
                    Map.of());
        } finally {
            clear(newPassword);
        }
    }

    private CreatedEnterpriseAdmin createEnterpriseAdminDirect(
            PlatformAdminActor actor,
            TenantEntity tenant,
            RoleEntity role,
            LoginIdentifier.Normalized identity,
            String displayName,
            char[] initialPassword,
            boolean auditCreation) {
        if (identity.email() != null
                && userRepository.existsByTenant_IdAndEmail(
                        tenant.getId(),
                        identity.email())
                || identity.phoneNumber() != null
                && userRepository.existsByTenant_IdAndPhoneNumber(
                        tenant.getId(),
                        identity.phoneNumber())) {
            throw new IamConflictException();
        }
        Instant now = clock.instant();
        UserAccountEntity user = new UserAccountEntity(
                UUID.randomUUID(),
                tenant,
                identity.email(),
                identity.phoneNumber(),
                displayName,
                AccountStatus.ACTIVE,
                now);
        user.initializePassword(
                hash(initialPassword),
                AccountStatus.ACTIVE,
                now);
        try {
            user = userRepository.saveAndFlush(user);
        } catch (DataIntegrityViolationException concurrentUsername) {
            throw new IamConflictException();
        }
        assignmentStore.replaceUserRoles(
                tenant.getId(),
                user.getId(),
                Set.of(role.getId()));
        if (auditCreation) {
            audit(
                    actor,
                    tenant.getId(),
                    ENTERPRISE_ADMIN_CREATED,
                    "user",
                    user.getId(),
                    Map.of("roleCode", ENTERPRISE_ADMIN_ROLE_CODE));
        }
        return new CreatedEnterpriseAdmin(enterpriseAdminView(user));
    }

    private UserAccountEntity requireEnterpriseAdminForUpdate(
            UUID tenantId,
            UUID userId) {
        UserAccountEntity user = userRepository
                .findByIdAndTenantIdForUpdate(userId, tenantId)
                .orElseThrow(IamNotFoundException::new);
        RoleEntity role = requireEnterpriseAdminRole(tenantId);
        if (!assignmentStore.findRoleIds(tenantId, userId)
                .contains(role.getId())) {
            throw new IamNotFoundException();
        }
        return user;
    }

    private RoleEntity requireEnterpriseAdminRole(UUID tenantId) {
        return roleRepository.findByTenant_IdAndCode(
                        tenantId,
                        ENTERPRISE_ADMIN_ROLE_CODE)
                .filter(RoleEntity::isSystemRole)
                .orElseThrow(IamNotFoundException::new);
    }

    private static void requireNotDeleted(TenantEntity tenant) {
        if (tenant.isDeleted()) {
            throw new IamNotFoundException();
        }
    }

    private static void requireVersion(
            UserAccountEntity user,
            long expectedVersion) {
        if (user.getVersion() != expectedVersion) {
            throw new IamOptimisticLockException();
        }
    }

    private static void requirePage(int page, int size) {
        if (page < 0 || page > MAX_PAGE_NUMBER
                || size < 1 || size > MAX_PAGE_SIZE) {
            throw new IamValidationException();
        }
    }

    private String hash(char[] password) {
        try {
            return passwordHashingService.hashForStorage(password);
        } catch (IllegalArgumentException invalidPassword) {
            throw new IamValidationException();
        }
    }

    private static void clear(char[] value) {
        if (value != null) {
            Arrays.fill(value, '\0');
        }
    }

    private Set<UUID> allPermissionIds() {
        return permissionRepository.findAllByOrderByCodeAsc().stream()
                .map(PermissionEntity::getId)
                .collect(Collectors.toCollection(LinkedHashSet::new));
    }

    private TenantView view(TenantEntity tenant) {
        RoleEntity adminRole = roleRepository.findByTenant_IdAndCode(
                        tenant.getId(),
                        ENTERPRISE_ADMIN_ROLE_CODE)
                .orElse(null);
        long adminCount = adminRole == null
                ? 0
                : assignmentStore.countUsersWithRole(
                        tenant.getId(),
                        adminRole.getId());
        return new TenantView(
                tenant.getId(),
                tenant.getCode(),
                tenant.getName(),
                tenant.getStatus(),
                tenant.getCreatedAt(),
                tenant.getUpdatedAt(),
                tenant.getVersion(),
                adminCount,
                userRepository.countByTenant_Id(tenant.getId()));
    }

    private void audit(
            PlatformAdminActor actor,
            UUID tenantId,
            String action,
            String resourceType,
            UUID resourceId,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new PlatformAdminAuditEvent(
                actor.adminId(),
                tenantId,
                action,
                resourceType,
                resourceId.toString(),
                actor.requestId(),
                actor.sourceIp(),
                details));
    }

    private static String requireCode(String value) {
        if (value == null || !TENANT_CODE.matcher(value).matches()) {
            throw new IamValidationException();
        }
        return value;
    }

    private static LoginIdentifier.Normalized requireLoginIdentifier(
            String value) {
        try {
            return LoginIdentifier.normalizeRequired(value);
        } catch (IllegalArgumentException invalidIdentifier) {
            throw new IamValidationException();
        }
    }

    private static String requireText(String value, int maximum) {
        if (value == null) {
            throw new IamValidationException();
        }
        String normalized = value.strip();
        if (normalized.isEmpty() || normalized.length() > maximum) {
            throw new IamValidationException();
        }
        return normalized;
    }

    public record TenantView(
            UUID id,
            String code,
            String name,
            TenantStatus status,
            Instant createdAt,
            Instant updatedAt,
            long version,
            long adminCount,
            long memberCount) {
    }

    public record EnterpriseAdminView(
            UUID id,
            String username,
            String email,
            String phoneNumber,
            String displayName,
            AccountStatus status,
            long version) {
    }

    public record CreatedEnterpriseAdmin(
            EnterpriseAdminView admin) {
    }

    public record CreatedTenant(
            TenantView tenant,
            CreatedEnterpriseAdmin enterpriseAdmin) {
    }

    private static EnterpriseAdminView enterpriseAdminView(
            UserAccountEntity user) {
        return new EnterpriseAdminView(
                user.getId(),
                user.getUsername(),
                user.getEmail(),
                user.getPhoneNumber(),
                user.getDisplayName(),
                user.getStatus(),
                user.getVersion());
    }
}
