package cn.xzkj.erp.iam.application;

import static cn.xzkj.erp.iam.domain.SecurityAuditActions.ROLE_CREATED;
import static cn.xzkj.erp.iam.domain.SecurityAuditActions.ROLE_PERMISSIONS_REPLACED;
import static cn.xzkj.erp.iam.domain.SecurityAuditActions.ROLE_UPDATED;
import static cn.xzkj.erp.iam.domain.SecurityAuditActions.USER_CREATED;
import static cn.xzkj.erp.iam.domain.SecurityAuditActions.USER_PASSWORD_CHANGED;
import static cn.xzkj.erp.iam.domain.SecurityAuditActions.USER_PASSWORD_RESET_BY_ADMIN;
import static cn.xzkj.erp.iam.domain.SecurityAuditActions.USER_ROLES_REPLACED;
import static cn.xzkj.erp.iam.domain.SecurityAuditActions.USER_STATUS_CHANGED;
import static cn.xzkj.erp.iam.domain.SecurityAuditActions.USER_UPDATED;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.domain.AccountStatus;
import cn.xzkj.erp.iam.domain.BusinessEmailAddress;
import cn.xzkj.erp.iam.domain.LoginIdentifier;
import cn.xzkj.erp.iam.persistence.AuditLogQueryRepository;
import cn.xzkj.erp.iam.persistence.AuditLogRecord;
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
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeService;
import cn.xzkj.erp.tenantaccess.TenantEntitlementService;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IamAdministrationService {
    private cn.xzkj.erp.iam.preparation.NativeCustomerServiceIdentity nativeIdentity;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    public void setNativeIdentity(cn.xzkj.erp.iam.preparation.NativeCustomerServiceIdentity identity){this.nativeIdentity=identity;}

    public static final int MAX_PAGE_SIZE = 100;
    public static final int MAX_PAGE_NUMBER = 1_000_000;
    private static final String ENTERPRISE_ADMIN_ROLE_CODE = "tenant_admin";
    public static final Duration MAX_AUDIT_WINDOW = Duration.ofDays(90);

    private final TenantRepository tenantRepository;
    private final UserAccountRepository userRepository;
    private final RoleRepository roleRepository;
    private final PermissionRepository permissionRepository;
    private final IamAssignmentStore assignmentStore;
    private final AuditLogQueryRepository auditLogQueryRepository;
    private final SecurityAuditRecorder auditRecorder;
    private final PasswordHashingService passwordHashingService;
    private final PasswordCredentialRepository credentialRepository;
    private final AuthSessionRepository sessionRepository;
    private final WarehouseScopeService warehouseScopeService;
    private final TenantEntitlementService entitlementService;
    private final Clock clock;

    @Autowired
    public IamAdministrationService(
            TenantRepository tenantRepository,
            UserAccountRepository userRepository,
            RoleRepository roleRepository,
            PermissionRepository permissionRepository,
            IamAssignmentStore assignmentStore,
            AuditLogQueryRepository auditLogQueryRepository,
            SecurityAuditRecorder auditRecorder,
            PasswordHashingService passwordHashingService,
            PasswordCredentialRepository credentialRepository,
            AuthSessionRepository sessionRepository,
            WarehouseScopeService warehouseScopeService,
            TenantEntitlementService entitlementService,
            Clock clock) {
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.permissionRepository = permissionRepository;
        this.assignmentStore = assignmentStore;
        this.auditLogQueryRepository = auditLogQueryRepository;
        this.auditRecorder = auditRecorder;
        this.passwordHashingService = passwordHashingService;
        this.credentialRepository = credentialRepository;
        this.sessionRepository = sessionRepository;
        this.warehouseScopeService = warehouseScopeService;
        this.entitlementService = entitlementService;
        this.clock = clock;
    }

    public IamAdministrationService(
            TenantRepository tenantRepository,
            UserAccountRepository userRepository,
            RoleRepository roleRepository,
            PermissionRepository permissionRepository,
            IamAssignmentStore assignmentStore,
            AuditLogQueryRepository auditLogQueryRepository,
            SecurityAuditRecorder auditRecorder,
            PasswordHashingService passwordHashingService,
            PasswordCredentialRepository credentialRepository,
            AuthSessionRepository sessionRepository,
            WarehouseScopeService warehouseScopeService,
            Clock clock) {
        this(
                tenantRepository,
                userRepository,
                roleRepository,
                permissionRepository,
                assignmentStore,
                auditLogQueryRepository,
                auditRecorder,
                passwordHashingService,
                credentialRepository,
                sessionRepository,
                warehouseScopeService,
                null,
                clock);
    }

    @Transactional(readOnly = true)
    public PageResult<MemberView> listMembers(
            UUID tenantId,
            String query,
            AccountStatus status,
            UUID roleId,
            int page,
            int size) {
        validatePage(page, size);
        String queryPattern = memberQueryPattern(query);
        if (roleId != null) {
            roleRepository.findByIdAndTenant_Id(roleId, tenantId)
                    .orElseThrow(IamNotFoundException::new);
        }
        var result = userRepository.findFilteredMembers(
                tenantId,
                queryPattern,
                status == null ? null : status.name(),
                roleId,
                PageRequest.of(page, size));
        return PageResult.of(
                result.getContent().stream().map(MemberView::from).toList(),
                page,
                size,
                result.getTotalElements());
    }

    public PageResult<MemberView> listMembers(UUID tenantId, int page, int size) {
        return listMembers(tenantId, null, null, null, page, size);
    }

    @Transactional(readOnly = true)
    public AssignmentView getMemberRoles(UUID tenantId, UUID userId) {
        UserAccountEntity user = requireUser(tenantId, userId);
        return new AssignmentView(
                user.getId(),
                sortedIds(assignmentStore.findRoleIds(tenantId, userId)),
                user.getVersion());
    }

    @Transactional
    public MemberView createMember(
            IamActor actor,
            String email,
            String phoneNumber,
            String displayName,
            char[] initialPassword,
            Set<UUID> requestedRoleIds) {
        try {
            requireAdministrator(actor);
            String normalizedEmail = normalizeOptionalEmail(email);
            String normalizedPhone = normalizePhone(phoneNumber);
            if (normalizedEmail == null && normalizedPhone == null) {
                throw new IamValidationException();
            }
            if ((normalizedEmail != null
                    && userRepository.existsByTenant_IdAndEmail(
                            actor.tenantId(),
                            normalizedEmail))
                    || (normalizedPhone != null
                    && userRepository.existsByTenant_IdAndPhoneNumber(
                            actor.tenantId(),
                            normalizedPhone))) {
                throw new IamConflictException();
            }
            Set<UUID> roleIds = requireAssignableRoles(
                    actor,
                    requestedRoleIds,
                    false);
            TenantEntity tenant = tenantRepository.findById(actor.tenantId())
                    .orElseThrow(IamNotFoundException::new);
            Instant now = clock.instant();
            String passwordHash = hash(initialPassword);
            UserAccountEntity user = new UserAccountEntity(
                    UUID.randomUUID(),
                    tenant,
                    normalizedEmail,
                    normalizedPhone,
                    displayName.strip(),
                    AccountStatus.ACTIVE,
                    now);
            user.initializePassword(passwordHash, AccountStatus.ACTIVE, now);
            try {
                userRepository.saveAndFlush(user);
                assignmentStore.replaceUserRoles(
                        actor.tenantId(),
                        user.getId(),
                        roleIds);
                warehouseScopeService.initializeSelectedEmpty(
                        actor.tenantId(),
                        user.getId());
            } catch (DataIntegrityViolationException conflictingCreate) {
                throw new IamConflictException();
            }
            audit(actor, USER_CREATED, "user", user.getId(), Map.of(
                    "initialStatus", AccountStatus.ACTIVE.name(),
                    "assignmentCount", Integer.toString(roleIds.size())));
            return MemberView.from(user);
        } finally {
            clear(initialPassword);
        }
    }

    public MemberView createMember(
            IamActor actor,
            String email,
            String displayName,
            char[] initialPassword,
            Set<UUID> requestedRoleIds) {
        return createMember(
                actor,
                email,
                null,
                displayName,
                initialPassword,
                requestedRoleIds);
    }

    @Transactional
    public MemberView updateMember(
            IamActor actor,
            UUID userId,
            String displayName,
            String phoneNumber,
            boolean phoneNumberSpecified,
            long expectedVersion) {
        requireAdministrator(actor);
        UserAccountEntity user = requireUser(actor.tenantId(), userId);
        requireManageableUser(actor, user);
        ensureVersion(user.getVersion(), expectedVersion);
        String normalized = displayName.strip();
        String normalizedPhone = phoneNumberSpecified
                ? normalizePhone(phoneNumber)
                : user.getPhoneNumber();
        boolean phoneChanged = !java.util.Objects.equals(
                user.getPhoneNumber(),
                normalizedPhone);
        if (phoneChanged && user.getEmail() == null) {
            throw new IamConflictException();
        }
        if (phoneChanged
                && normalizedPhone != null
                && userRepository.existsByTenant_IdAndPhoneNumber(
                        actor.tenantId(),
                        normalizedPhone)) {
            throw new IamConflictException();
        }
        if (!user.getDisplayName().equals(normalized)
                || phoneChanged) {
            java.util.ArrayList<String> changedFields =
                    new java.util.ArrayList<>();
            if (!user.getDisplayName().equals(normalized)) {
                changedFields.add("displayName");
            }
            if (phoneChanged) {
                changedFields.add("phoneNumber");
            }
            user.updateProfile(normalized, normalizedPhone, clock.instant());
            try {
                userRepository.saveAndFlush(user);
            } catch (DataIntegrityViolationException concurrentIdentityChange) {
                throw new IamConflictException();
            }
            audit(actor, USER_UPDATED, "user", user.getId(), Map.of(
                    "changedFields", String.join(",", changedFields)));
        }
        return MemberView.from(user);
    }

    @Transactional
    public MemberView updateMember(
            IamActor actor,
            UUID userId,
            String displayName,
            long expectedVersion) {
        return updateMember(
                actor,
                userId,
                displayName,
                null,
                false,
                expectedVersion);
    }

    @Transactional
    public MemberView changeMemberStatus(
            IamActor actor,
            UUID userId,
            AccountStatus status,
            long expectedVersion) {
        requireAdministrator(actor);
        UserAccountEntity user = requireUser(actor.tenantId(), userId);
        requireManageableUser(actor, user);
        ensureVersion(user.getVersion(), expectedVersion);
        if (user.getStatus() != status) {
            AccountStatus previous = user.getStatus();
            Instant now = clock.instant();
            user.changeStatus(status, now);
            userRepository.saveAndFlush(user);
            int revokedSessions = status == AccountStatus.DISABLED
                    ? sessionRepository.revokeActiveForUser(
                            actor.tenantId(), user.getId(), now)
                    : 0;
            audit(actor, USER_STATUS_CHANGED, "user", user.getId(), Map.of(
                    "fromStatus", previous.name(),
                    "toStatus", status.name(),
                    "revokedSessions", Integer.toString(revokedSessions)));
        }
        return MemberView.from(user);
    }

    @Transactional(readOnly = true)
    public PageResult<RoleView> listRoles(UUID tenantId, int page, int size) {
        validatePage(page, size);
        var result = roleRepository.findAllByTenant_Id(
                tenantId,
                PageRequest.of(
                        page,
                        size,
                        Sort.by("code").ascending().and(Sort.by("id"))));
        return PageResult.of(
                result.getContent().stream().map(RoleView::from).toList(),
                page,
                size,
                result.getTotalElements());
    }

    @Transactional(readOnly = true)
    public AssignmentView getRolePermissions(UUID tenantId, UUID roleId) {
        RoleEntity role = requireRole(tenantId, roleId);
        return new AssignmentView(
                role.getId(),
                sortedIds(assignmentStore.findPermissionIds(tenantId, roleId)),
                role.getVersion());
    }

    @Transactional
    public RoleView createRole(
            IamActor actor,
            String code,
            String name,
            String description) {
        requireAdministrator(actor);
        if (roleRepository.existsByTenant_IdAndCode(actor.tenantId(), code)) {
            throw new IamConflictException();
        }
        TenantEntity tenant = tenantRepository.findById(actor.tenantId())
                .orElseThrow(IamNotFoundException::new);
        Instant now = clock.instant();
        RoleEntity role = new RoleEntity(
                UUID.randomUUID(),
                tenant,
                code,
                name.strip(),
                normalizeDescription(description),
                now);
        try {
            roleRepository.saveAndFlush(role);
        } catch (DataIntegrityViolationException conflictingRoleCode) {
            throw new IamConflictException();
        }
        audit(actor, ROLE_CREATED, "role", role.getId(), Map.of(
                "roleCode", role.getCode()));
        return RoleView.from(role);
    }

    @Transactional
    public RoleView updateRole(
            IamActor actor,
            UUID roleId,
            String name,
            String description,
            long expectedVersion) {
        requireAdministrator(actor);
        RoleEntity role = requireRole(actor.tenantId(), roleId);
        protectManagedRole(role);
        ensureVersion(role.getVersion(), expectedVersion);
        String normalizedName = name.strip();
        String normalizedDescription = normalizeDescription(description);
        if (!role.getName().equals(normalizedName)
                || !java.util.Objects.equals(
                        role.getDescription(),
                        normalizedDescription)) {
            role.update(normalizedName, normalizedDescription, clock.instant());
            roleRepository.saveAndFlush(role);
            audit(actor, ROLE_UPDATED, "role", role.getId(), Map.of(
                    "changedFields", "name,description"));
        }
        return RoleView.from(role);
    }

    @Transactional(readOnly = true)
    public PageResult<PermissionView> listPermissions(int page, int size) {
        validatePage(page, size);
        var result = permissionRepository.findAll(PageRequest.of(
                page,
                size,
                Sort.by("code").ascending().and(Sort.by("id"))));
        return PageResult.of(
                result.getContent().stream().map(PermissionView::from).toList(),
                page,
                size,
                result.getTotalElements());
    }

    @Transactional
    public AssignmentView replaceMemberRoles(
            IamActor actor,
            UUID userId,
            Set<UUID> requestedRoleIds,
            long expectedVersion) {
        requireAdministrator(actor);
        UserAccountEntity user = requireUser(actor.tenantId(), userId);
        requireManageableUser(actor, user);
        ensureVersion(user.getVersion(), expectedVersion);
        Set<UUID> roleIds = requireAssignableRoles(
                actor,
                requestedRoleIds,
                true);
        Set<UUID> current = assignmentStore.findRoleIds(actor.tenantId(), userId);
        if (!current.equals(roleIds)) {
            try {
                assignmentStore.replaceUserRoles(actor.tenantId(), userId, roleIds);
                user.touch(clock.instant());
                userRepository.saveAndFlush(user);
            } catch (DataIntegrityViolationException concurrentAssignmentChange) {
                throw new IamConflictException();
            }
            audit(actor, USER_ROLES_REPLACED, "user", user.getId(), Map.of(
                    "assignmentCount", Integer.toString(roleIds.size())));
        }
        return new AssignmentView(user.getId(), sortedIds(roleIds), user.getVersion());
    }

    @Transactional
    public AssignmentView replaceRolePermissions(
            IamActor actor,
            UUID roleId,
            Set<UUID> requestedPermissionIds,
            long expectedVersion) {
        requireAdministrator(actor);
        RoleEntity role = requireRole(actor.tenantId(), roleId);
        protectManagedRole(role);
        ensureVersion(role.getVersion(), expectedVersion);
        Set<UUID> permissionIds = orderedIds(requestedPermissionIds);
        Set<UUID> current =
                assignmentStore.findPermissionIds(actor.tenantId(), roleId);
        if (entitlementService != null) {
            entitlementService.requireAssignablePermissions(
                    actor.tenantId(), permissionIds, current);
        } else if (!permissionIds.isEmpty()
                && permissionRepository.findAllByIdIn(permissionIds).size()
                        != permissionIds.size()) {
            throw new IamNotFoundException();
        }
        if (!current.equals(permissionIds)) {
            try {
                assignmentStore.replaceRolePermissions(
                        actor.tenantId(),
                        roleId,
                        permissionIds);
                role.touch(clock.instant());
                roleRepository.saveAndFlush(role);
            } catch (DataIntegrityViolationException concurrentAssignmentChange) {
                throw new IamConflictException();
            }
            audit(actor, ROLE_PERMISSIONS_REPLACED, "role", role.getId(), Map.of(
                    "assignmentCount", Integer.toString(permissionIds.size())));
        }
        return new AssignmentView(role.getId(), sortedIds(permissionIds), role.getVersion());
    }

    @Transactional(readOnly = true)
    public PageResult<AuditLogRecord> listAuditLogs(
            UUID tenantId,
            String action,
            String resourceType,
            Instant from,
            Instant to,
            int page,
            int size) {
        validatePage(page, size);
        Instant effectiveFrom = from;
        Instant effectiveTo = to;
        if (from != null || to != null) {
            effectiveTo = to == null ? clock.instant() : to;
            effectiveFrom = from == null
                    ? effectiveTo.minus(MAX_AUDIT_WINDOW)
                    : from;
            if (!effectiveFrom.isBefore(effectiveTo)
                    || Duration.between(effectiveFrom, effectiveTo)
                            .compareTo(MAX_AUDIT_WINDOW) > 0) {
                throw new IamValidationException();
            }
        }
        var result = auditLogQueryRepository.find(
                tenantId,
                action,
                resourceType,
                effectiveFrom,
                effectiveTo,
                page,
                size);
        return PageResult.of(
                result.items(),
                page,
                size,
                result.totalElements());
    }

    @Transactional
    public void changeOwnPassword(
            IamActor actor,
            char[] currentPassword,
            char[] newPassword) {
        try {
            if(nativeIdentity!=null)nativeIdentity.requireLocalPasswordAllowed(actor.tenantId(),actor.userId());
            if (actor.userId() == null || actor.systemAdminId() != null) {
                throw new AccessDeniedException("Tenant user required");
            }
            UserAccountEntity user = userRepository
                    .findByIdAndTenantIdForUpdate(
                            actor.userId(),
                            actor.tenantId())
                    .orElseThrow(IamNotFoundException::new);
            if (currentPassword == null
                    || !passwordHashingService.matches(
                    java.nio.CharBuffer.wrap(currentPassword),
                    user.getPasswordHash())) {
                throw new InvalidLoginException();
            }
            Instant now = clock.instant();
            user.changePassword(hash(newPassword), now);
            userRepository.saveAndFlush(user);
            credentialRepository.revokeAllOpenForUser(
                    actor.tenantId(),
                    user.getId(),
                    now);
            audit(
                    actor,
                    USER_PASSWORD_CHANGED,
                    "user",
                    user.getId(),
                    Map.of());
        } finally {
            clear(currentPassword);
            clear(newPassword);
        }
    }

    @Transactional
    public void resetMemberPassword(
            IamActor actor,
            UUID userId,
            char[] newPassword,
            long expectedVersion) {
        try {
            if(nativeIdentity!=null)nativeIdentity.requireLocalPasswordAllowed(actor.tenantId(),userId);
            requireAdministrator(actor);
            UserAccountEntity user = requireUser(actor.tenantId(), userId);
            requireManageableUser(actor, user);
            ensureVersion(user.getVersion(), expectedVersion);
            Instant now = clock.instant();
            user.changePassword(hash(newPassword), now);
            userRepository.saveAndFlush(user);
            credentialRepository.revokeAllOpenForUser(
                    actor.tenantId(),
                    user.getId(),
                    now);
            int revokedSessions = sessionRepository.revokeActiveForUser(
                    actor.tenantId(),
                    user.getId(),
                    now);
            audit(
                    actor,
                    USER_PASSWORD_RESET_BY_ADMIN,
                    "user",
                    user.getId(),
                    Map.of("revokedSessions", Integer.toString(revokedSessions)));
        } finally {
            clear(newPassword);
        }
    }

    private UserAccountEntity requireUser(UUID tenantId, UUID userId) {
        return userRepository.findByIdAndTenant_Id(userId, tenantId)
                .orElseThrow(IamNotFoundException::new);
    }

    private RoleEntity requireRole(UUID tenantId, UUID roleId) {
        return roleRepository.findByIdAndTenant_Id(roleId, tenantId)
                .orElseThrow(IamNotFoundException::new);
    }

    private void requireAdministrator(IamActor actor) {
        if (actor.systemAdminId() != null) {
            return;
        }
        if (actor.userId() == null
                || !assignmentStore.existsUserWithSystemRoleCode(
                        actor.tenantId(),
                        actor.userId(),
                        ENTERPRISE_ADMIN_ROLE_CODE)) {
            throw new AccessDeniedException(
                    "System or enterprise administrator required");
        }
    }

    private void requireManageableUser(
            IamActor actor,
            UserAccountEntity user) {
        if (actor.userId() != null && actor.userId().equals(user.getId())) {
            throw new SelfServiceNotAllowedException();
        }
        if (actor.systemAdminId() == null
                && hasNonDelegableSystemRole(
                        actor.tenantId(),
                        user.getId())) {
            throw new AccessDeniedException(
                    "System administrator required");
        }
    }

    private Set<UUID> requireAssignableRoles(
            IamActor actor,
            Set<UUID> requestedRoleIds,
            boolean allowEnterpriseAdministratorRole) {
        if (requestedRoleIds == null) {
            throw new IamValidationException();
        }
        Set<UUID> roleIds = orderedIds(requestedRoleIds);
        List<RoleEntity> roles = roleIds.isEmpty()
                ? List.of()
                : roleRepository.findAllByTenant_IdAndIdIn(
                        actor.tenantId(),
                        roleIds);
        if (roles.size() != roleIds.size()) {
            throw new IamNotFoundException();
        }
        if (actor.systemAdminId() == null
                && roles.stream().anyMatch(role -> role.isSystemRole()
                        && !(allowEnterpriseAdministratorRole
                        && ENTERPRISE_ADMIN_ROLE_CODE.equals(role.getCode())))) {
            throw new AccessDeniedException(
                    "System administrator required");
        }
        return roleIds;
    }

    private boolean hasNonDelegableSystemRole(
            UUID tenantId,
            UUID userId) {
        Set<UUID> assignedRoleIds = assignmentStore.findRoleIds(
                tenantId,
                userId);
        if (assignedRoleIds.isEmpty()) {
            return false;
        }
        return roleRepository.findAllByTenant_IdAndIdIn(
                        tenantId,
                        assignedRoleIds)
                .stream()
                .anyMatch(role -> role.isSystemRole()
                        && !ENTERPRISE_ADMIN_ROLE_CODE.equals(role.getCode()));
    }

    private static void protectManagedRole(RoleEntity role) {
        if (role.isSystemRole() || role.isPresetRole()) {
            throw new SystemRoleProtectedException();
        }
    }

    private static void ensureVersion(long actual, long expected) {
        if (actual != expected) {
            throw new IamOptimisticLockException();
        }
    }

    private static void validatePage(int page, int size) {
        if (page < 0
                || page > MAX_PAGE_NUMBER
                || size < 1
                || size > MAX_PAGE_SIZE) {
            throw new IamValidationException();
        }
    }

    private static String normalizeDescription(String description) {
        if (description == null || description.isBlank()) {
            return null;
        }
        return description.strip();
    }

    private static String memberQueryPattern(String query) {
        if (query == null) {
            return null;
        }
        String normalized = query.strip();
        if (normalized.isEmpty() || normalized.length() > 100) {
            throw new IamValidationException();
        }
        return "%" + normalized
                .toLowerCase(Locale.ROOT)
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_") + "%";
    }

    private static String normalizeOptionalEmail(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return BusinessEmailAddress.normalize(value);
        } catch (IllegalArgumentException invalidEmail) {
            throw new IamValidationException();
        }
    }

    private static String normalizePhone(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String normalized = LoginIdentifier.normalizePhone(value);
        if (normalized == null) {
            throw new IamValidationException();
        }
        return normalized;
    }

    private static Set<UUID> orderedIds(Set<UUID> ids) {
        return new LinkedHashSet<>(sortedIds(ids));
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

    private static List<UUID> sortedIds(Set<UUID> ids) {
        List<UUID> sorted = new ArrayList<>(ids);
        sorted.sort(Comparator.comparing(UUID::toString));
        return List.copyOf(sorted);
    }

    private void audit(
            IamActor actor,
            String action,
            String resourceType,
            UUID resourceId,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                action,
                resourceType,
                resourceId.toString(),
                actor.requestId(),
                actor.sourceIp(),
                details));
    }

    public record MemberView(
            UUID id,
            String username,
            String email,
            String phoneNumber,
            String displayName,
            AccountStatus status,
            long version,
            Instant createdAt,
            Instant updatedAt) {

        static MemberView from(UserAccountEntity user) {
            return new MemberView(
                    user.getId(),
                    user.getUsername(),
                    user.getEmail(),
                    user.getPhoneNumber(),
                    user.getDisplayName(),
                    user.getStatus(),
                    user.getVersion(),
                    user.getCreatedAt(),
                    user.getUpdatedAt());
        }
    }

    public record RoleView(
            UUID id,
            String code,
            String name,
            String description,
            boolean systemRole,
            boolean presetRole,
            long version,
            Instant createdAt,
            Instant updatedAt) {

        static RoleView from(RoleEntity role) {
            return new RoleView(
                    role.getId(),
                    role.getCode(),
                    role.getName(),
                    role.getDescription(),
                    role.isSystemRole(),
                    role.isPresetRole(),
                    role.getVersion(),
                    role.getCreatedAt(),
                    role.getUpdatedAt());
        }
    }

    public record PermissionView(
            UUID id,
            String code,
            String module,
            String name,
            String description,
            Instant createdAt) {

        static PermissionView from(PermissionEntity permission) {
            return new PermissionView(
                    permission.getId(),
                    permission.getCode(),
                    permission.getModule(),
                    permission.getName(),
                    permission.getDescription(),
                    permission.getCreatedAt());
        }
    }

    public record AssignmentView(
            UUID resourceId,
            List<UUID> assignmentIds,
            long version) {

        public AssignmentView {
            assignmentIds = List.copyOf(assignmentIds);
        }
    }
}
