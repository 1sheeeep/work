package cn.xzkj.erp.iam.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.persistence.AuditLogQueryRepository;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.IamAssignmentStore;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.persistence.PasswordCredentialRepository;
import cn.xzkj.erp.iam.persistence.RoleRepository;
import cn.xzkj.erp.iam.persistence.TenantRepository;
import cn.xzkj.erp.iam.persistence.UserAccountEntity;
import cn.xzkj.erp.iam.persistence.UserAccountRepository;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeService;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class IamDirectPasswordServiceTest {

    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID ADMIN_ID = UUID.randomUUID();

    @Mock
    private TenantRepository tenantRepository;

    @Mock
    private UserAccountRepository userRepository;

    @Mock
    private RoleRepository roleRepository;

    @Mock
    private PermissionRepository permissionRepository;

    @Mock
    private IamAssignmentStore assignmentStore;

    @Mock
    private AuditLogQueryRepository auditLogQueryRepository;

    @Mock
    private SecurityAuditRecorder auditRecorder;

    @Mock
    private PasswordHashingService passwordHashingService;

    @Mock
    private PasswordCredentialRepository credentialRepository;

    @Mock
    private AuthSessionRepository sessionRepository;

    @Mock
    private WarehouseScopeService warehouseScopeService;

    private IamAdministrationService service;

    @BeforeEach
    void setUp() {
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
                Clock.fixed(
                        Instant.parse("2026-07-29T00:00:00Z"),
                        ZoneOffset.UTC));
    }

    @Test
    void clearsBothInputsWhenCurrentPasswordIsWrong() {
        UserAccountEntity user = org.mockito.Mockito.mock(
                UserAccountEntity.class);
        when(userRepository.findByIdAndTenantIdForUpdate(
                        ADMIN_ID,
                        TENANT_ID))
                .thenReturn(Optional.of(user));
        when(user.getPasswordHash()).thenReturn("{argon2id}stored");
        when(passwordHashingService.matches(
                        org.mockito.ArgumentMatchers.any(),
                        org.mockito.ArgumentMatchers.anyString()))
                .thenReturn(false);
        char[] currentPassword = "wrong-current-password".toCharArray();
        char[] newPassword = "new-password-value".toCharArray();

        assertThatThrownBy(() -> service.changeOwnPassword(
                        actor(),
                        currentPassword,
                        newPassword))
                .isInstanceOf(InvalidLoginException.class);

        assertThat(currentPassword).containsOnly('\0');
        assertThat(newPassword).containsOnly('\0');
    }

    @Test
    void clearsInitialPasswordWhenDuplicateCreateFailsBeforeHashing() {
        when(assignmentStore.existsUserWithSystemRoleCode(
                        TENANT_ID,
                        ADMIN_ID,
                        "tenant_admin"))
                .thenReturn(true);
        when(userRepository.existsByTenant_IdAndEmail(
                        TENANT_ID,
                        "duplicate@example.com"))
                .thenReturn(true);
        char[] initialPassword = "duplicate-password".toCharArray();

        assertThatThrownBy(() -> service.createMember(
                        actor(),
                        "duplicate@example.com",
                        "Duplicate",
                        initialPassword,
                        Set.of()))
                .isInstanceOf(IamConflictException.class);

        assertThat(initialPassword).containsOnly('\0');
    }

    private static IamActor actor() {
        return new IamActor(
                TENANT_ID,
                ADMIN_ID,
                null,
                "direct-password-test",
                "127.0.0.1");
    }
}
