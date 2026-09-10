package cn.xzkj.erp.iam.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.domain.AccountStatus;
import cn.xzkj.erp.iam.domain.TenantStatus;
import cn.xzkj.erp.iam.persistence.AuditLogQueryRepository;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.IamAssignmentStore;
import cn.xzkj.erp.iam.persistence.PasswordCredentialRepository;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.persistence.RoleEntity;
import cn.xzkj.erp.iam.persistence.RoleRepository;
import cn.xzkj.erp.iam.persistence.TenantEntity;
import cn.xzkj.erp.iam.persistence.TenantRepository;
import cn.xzkj.erp.iam.persistence.UserAccountEntity;
import cn.xzkj.erp.iam.persistence.UserAccountRepository;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeService;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.access.AccessDeniedException;

@ExtendWith(MockitoExtension.class)
class IamAdministrationServiceTest {

    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID ADMIN_ID = UUID.randomUUID();
    private static final UUID TARGET_ID = UUID.randomUUID();
    private static final UUID ENTERPRISE_ADMIN_ROLE_ID = UUID.randomUUID();
    private static final UUID ORDINARY_ROLE_ID = UUID.randomUUID();
    private static final UUID OTHER_SYSTEM_ROLE_ID = UUID.randomUUID();
    private static final Instant NOW = Instant.parse("2026-08-27T15:00:00Z");

    @Mock private TenantRepository tenantRepository;
    @Mock private UserAccountRepository userRepository;
    @Mock private RoleRepository roleRepository;
    @Mock private PermissionRepository permissionRepository;
    @Mock private IamAssignmentStore assignmentStore;
    @Mock private AuditLogQueryRepository auditLogQueryRepository;
    @Mock private SecurityAuditRecorder auditRecorder;
    @Mock private PasswordHashingService passwordHashingService;
    @Mock private PasswordCredentialRepository credentialRepository;
    @Mock private AuthSessionRepository sessionRepository;
    @Mock private WarehouseScopeService warehouseScopeService;

    private IamAdministrationService service;
    private IamActor actor;
    private UserAccountEntity target;
    private RoleEntity enterpriseAdministratorRole;
    private RoleEntity ordinaryRole;
    private RoleEntity otherSystemRole;

    @BeforeEach
    void setUp() {
        TenantEntity tenant = new TenantEntity(
                TENANT_ID,
                "tenant",
                "Tenant",
                TenantStatus.ACTIVE,
                NOW);
        target = new UserAccountEntity(
                TARGET_ID,
                tenant,
                "target@example.com",
                null,
                "Target",
                AccountStatus.ACTIVE,
                NOW);
        enterpriseAdministratorRole = RoleEntity.systemRole(
                ENTERPRISE_ADMIN_ROLE_ID,
                tenant,
                "tenant_admin",
                "Enterprise Administrator",
                null,
                NOW);
        ordinaryRole = new RoleEntity(
                ORDINARY_ROLE_ID,
                tenant,
                "operator",
                "Operator",
                null,
                NOW);
        otherSystemRole = RoleEntity.systemRole(
                OTHER_SYSTEM_ROLE_ID,
                tenant,
                "system_owner",
                "System Owner",
                null,
                NOW);
        actor = new IamActor(TENANT_ID, ADMIN_ID, "request", "127.0.0.1");
        service = new IamAdministrationService(
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
                Clock.fixed(NOW, ZoneOffset.UTC));
        when(assignmentStore.existsUserWithSystemRoleCode(
                TENANT_ID,
                ADMIN_ID,
                "tenant_admin")).thenReturn(true);
    }

    @Test
    void enterpriseAdministratorCanPromoteAnotherMember() {
        arrangeTarget();
        when(userRepository.saveAndFlush(target)).thenReturn(target);
        when(assignmentStore.findRoleIds(TENANT_ID, TARGET_ID))
                .thenReturn(Set.of());
        when(roleRepository.findAllByTenant_IdAndIdIn(
                TENANT_ID,
                Set.of(ENTERPRISE_ADMIN_ROLE_ID)))
                .thenReturn(List.of(enterpriseAdministratorRole));

        var result = service.replaceMemberRoles(
                actor,
                TARGET_ID,
                Set.of(ENTERPRISE_ADMIN_ROLE_ID),
                0);

        assertThat(result.assignmentIds())
                .containsExactly(ENTERPRISE_ADMIN_ROLE_ID);
        verify(assignmentStore).replaceUserRoles(
                TENANT_ID,
                TARGET_ID,
                Set.of(ENTERPRISE_ADMIN_ROLE_ID));
    }

    @Test
    void enterpriseAdministratorCanDemoteAnotherEnterpriseAdministrator() {
        arrangeTarget();
        when(userRepository.saveAndFlush(target)).thenReturn(target);
        when(assignmentStore.findRoleIds(TENANT_ID, TARGET_ID))
                .thenReturn(Set.of(ENTERPRISE_ADMIN_ROLE_ID));
        when(roleRepository.findAllByTenant_IdAndIdIn(
                TENANT_ID,
                Set.of(ENTERPRISE_ADMIN_ROLE_ID)))
                .thenReturn(List.of(enterpriseAdministratorRole));
        when(roleRepository.findAllByTenant_IdAndIdIn(
                TENANT_ID,
                Set.of(ORDINARY_ROLE_ID)))
                .thenReturn(List.of(ordinaryRole));

        var result = service.replaceMemberRoles(
                actor,
                TARGET_ID,
                Set.of(ORDINARY_ROLE_ID),
                0);

        assertThat(result.assignmentIds()).containsExactly(ORDINARY_ROLE_ID);
        verify(assignmentStore).replaceUserRoles(
                TENANT_ID,
                TARGET_ID,
                Set.of(ORDINARY_ROLE_ID));
    }

    @Test
    void enterpriseAdministratorCannotDelegateAnotherSystemRole() {
        arrangeTarget();
        when(assignmentStore.findRoleIds(TENANT_ID, TARGET_ID))
                .thenReturn(Set.of());
        when(roleRepository.findAllByTenant_IdAndIdIn(
                TENANT_ID,
                Set.of(OTHER_SYSTEM_ROLE_ID)))
                .thenReturn(List.of(otherSystemRole));

        assertThatThrownBy(() -> service.replaceMemberRoles(
                actor,
                TARGET_ID,
                Set.of(OTHER_SYSTEM_ROLE_ID),
                0))
                .isInstanceOf(AccessDeniedException.class);
    }

    @Test
    void enterpriseAdministratorCannotChangeOwnRoles() {
        UserAccountEntity administrator = new UserAccountEntity(
                ADMIN_ID,
                target.getTenant(),
                "admin@example.com",
                null,
                "Administrator",
                AccountStatus.ACTIVE,
                NOW);
        when(userRepository.findByIdAndTenant_Id(ADMIN_ID, TENANT_ID))
                .thenReturn(Optional.of(administrator));

        assertThatThrownBy(() -> service.replaceMemberRoles(
                actor,
                ADMIN_ID,
                Set.of(),
                0))
                .isInstanceOf(SelfServiceNotAllowedException.class);
    }

    private void arrangeTarget() {
        when(userRepository.findByIdAndTenant_Id(TARGET_ID, TENANT_ID))
                .thenReturn(Optional.of(target));
    }
}
