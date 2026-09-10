package cn.xzkj.erp.iam.bootstrap;

import static cn.xzkj.erp.iam.domain.SecurityAuditActions.BOOTSTRAP_ADMIN_PROVISIONED;

import cn.xzkj.erp.iam.application.PasswordCredentialTokenService;
import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.domain.AccountStatus;
import cn.xzkj.erp.iam.domain.PasswordCredentialPurpose;
import cn.xzkj.erp.iam.domain.TenantStatus;
import cn.xzkj.erp.iam.persistence.IamAssignmentStore;
import cn.xzkj.erp.iam.persistence.PasswordCredentialEntity;
import cn.xzkj.erp.iam.persistence.PasswordCredentialRepository;
import cn.xzkj.erp.iam.persistence.PermissionEntity;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.persistence.RoleEntity;
import cn.xzkj.erp.iam.persistence.RoleRepository;
import cn.xzkj.erp.iam.persistence.TenantEntity;
import cn.xzkj.erp.iam.persistence.TenantRepository;
import cn.xzkj.erp.iam.persistence.UserAccountEntity;
import cn.xzkj.erp.iam.persistence.UserAccountRepository;
import cn.xzkj.erp.iam.roles.PresetRoleCatalog;
import cn.xzkj.erp.iam.roles.PresetRoleProvisioningService;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
public class InitialAdminBootstrapService {

    public static final String TENANT_ADMIN_ROLE_CODE = "tenant_admin";

    private final InitialAdminBootstrapLock bootstrapLock;
    private final TenantRepository tenantRepository;
    private final UserAccountRepository userRepository;
    private final RoleRepository roleRepository;
    private final PermissionRepository permissionRepository;
    private final PasswordCredentialRepository credentialRepository;
    private final IamAssignmentStore assignmentStore;
    private final PasswordCredentialTokenService tokenService;
    private final BootstrapTokenFileStore tokenFileStore;
    private final SecurityAuditRecorder auditRecorder;
    private final PresetRoleProvisioningService presetRoleProvisioningService;
    private final Clock clock;

    public InitialAdminBootstrapService(
            InitialAdminBootstrapLock bootstrapLock,
            TenantRepository tenantRepository,
            UserAccountRepository userRepository,
            RoleRepository roleRepository,
            PermissionRepository permissionRepository,
            PasswordCredentialRepository credentialRepository,
            IamAssignmentStore assignmentStore,
            PasswordCredentialTokenService tokenService,
            BootstrapTokenFileStore tokenFileStore,
            SecurityAuditRecorder auditRecorder,
            PresetRoleProvisioningService presetRoleProvisioningService,
            Clock clock) {
        this.bootstrapLock = bootstrapLock;
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.permissionRepository = permissionRepository;
        this.credentialRepository = credentialRepository;
        this.assignmentStore = assignmentStore;
        this.tokenService = tokenService;
        this.tokenFileStore = tokenFileStore;
        this.auditRecorder = auditRecorder;
        this.presetRoleProvisioningService = presetRoleProvisioningService;
        this.clock = clock;
    }

    @Transactional
    public ProvisionedAdmin provision(InitialAdminBootstrapCommand command) {
        tokenFileStore.requireAvailable(command.tokenOutputPath());
        bootstrapLock.acquire(command.tenantCode());
        try {
            return provisionLocked(command);
        } catch (InitialAdminBootstrapException safeFailure) {
            throw safeFailure;
        } catch (DataIntegrityViolationException conflictingDatabaseState) {
            throw new InitialAdminBootstrapException();
        }
    }

    private ProvisionedAdmin provisionLocked(
            InitialAdminBootstrapCommand command) {
        Instant now = clock.instant();
        TenantEntity tenant = tenantRepository.findByCode(command.tenantCode())
                .map(existing -> requireEligibleTenant(existing, command))
                .orElseGet(() -> tenantRepository.saveAndFlush(new TenantEntity(
                        UUID.randomUUID(),
                        command.tenantCode(),
                        command.tenantName(),
                        TenantStatus.ACTIVE)));

        RoleEntity role = roleRepository
                .findByTenant_IdAndCode(
                        tenant.getId(),
                        TENANT_ADMIN_ROLE_CODE)
                .map(existing -> requireUnassignedSystemRole(tenant, existing))
                .orElseGet(() -> roleRepository.saveAndFlush(RoleEntity.systemRole(
                        UUID.randomUUID(),
                        tenant,
                        TENANT_ADMIN_ROLE_CODE,
                        PresetRoleCatalog.ENTERPRISE_ADMIN_NAME,
                        PresetRoleCatalog.ENTERPRISE_ADMIN_DESCRIPTION,
                        now)));

        if (userRepository.existsByTenant_IdAndEmail(
                tenant.getId(),
                command.email())) {
            throw new InitialAdminBootstrapException();
        }

        Set<UUID> permissionIds = exactPermissionIds();
        UserAccountEntity user = userRepository.saveAndFlush(
                new UserAccountEntity(
                        UUID.randomUUID(),
                        tenant,
                        command.email(),
                        null,
                        command.displayName(),
                        AccountStatus.DISABLED,
                        now));
        assignmentStore.replaceRolePermissions(
                tenant.getId(),
                role.getId(),
                permissionIds);
        presetRoleProvisioningService.provision(tenant, now);
        assignmentStore.replaceUserRoles(
                tenant.getId(),
                user.getId(),
                Set.of(role.getId()));

        PasswordCredentialTokenService.GeneratedToken token =
                tokenService.generate();
        Instant expiresAt = now.plus(Duration.ofMinutes(command.ttlMinutes()));
        credentialRepository.saveAndFlush(new PasswordCredentialEntity(
                UUID.randomUUID(),
                tenant.getId(),
                user,
                PasswordCredentialPurpose.ACTIVATION,
                token.tokenHash(),
                expiresAt,
                user.getId(),
                now));
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                tenant.getId(),
                user.getId(),
                BOOTSTRAP_ADMIN_PROVISIONED,
                "user",
                user.getId().toString(),
                null,
                null,
                Map.of(
                        "roleCode", TENANT_ADMIN_ROLE_CODE,
                        "roleId", role.getId().toString(),
                        "ttlMinutes", Integer.toString(command.ttlMinutes()))));
        writeTokenWithRollbackCleanup(
                command.tokenOutputPath(),
                token.rawToken());
        return new ProvisionedAdmin(
                tenant.getId(),
                user.getId(),
                role.getId(),
                expiresAt);
    }

    private TenantEntity requireEligibleTenant(
            TenantEntity tenant,
            InitialAdminBootstrapCommand command) {
        if (tenant.getStatus() != TenantStatus.ACTIVE
                || !tenant.getName().equals(command.tenantName())) {
            throw new InitialAdminBootstrapException();
        }
        return tenant;
    }

    private RoleEntity requireUnassignedSystemRole(
            TenantEntity tenant,
            RoleEntity role) {
        if (!role.isSystemRole()
                || assignmentStore.existsUserWithRole(
                        tenant.getId(),
                        role.getId())) {
            throw new InitialAdminBootstrapException();
        }
        return role;
    }

    private Set<UUID> exactPermissionIds() {
        List<PermissionEntity> permissions = permissionRepository
                .findAllByCodeIn(TenantAdminPermissionCodes.EXACT_CODES);
        Map<String, PermissionEntity> byCode = permissions.stream()
                .collect(Collectors.toMap(
                        PermissionEntity::getCode,
                        Function.identity()));
        if (!byCode.keySet().equals(
                new LinkedHashSet<>(TenantAdminPermissionCodes.EXACT_CODES))) {
            throw new InitialAdminBootstrapException();
        }
        return TenantAdminPermissionCodes.EXACT_CODES.stream()
                .map(code -> byCode.get(code).getId())
                .collect(Collectors.toCollection(LinkedHashSet::new));
    }

    private void writeTokenWithRollbackCleanup(
            Path outputPath,
            String rawToken) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            throw new InitialAdminBootstrapException();
        }
        AtomicBoolean created = new AtomicBoolean();
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCompletion(int status) {
                        if (status != STATUS_COMMITTED && created.get()) {
                            tokenFileStore.deleteQuietly(outputPath);
                        }
                    }
                });
        tokenFileStore.createNew(outputPath, rawToken);
        created.set(true);
    }

    public record ProvisionedAdmin(
            UUID tenantId,
            UUID userId,
            UUID roleId,
            Instant credentialExpiresAt) {
    }
}
