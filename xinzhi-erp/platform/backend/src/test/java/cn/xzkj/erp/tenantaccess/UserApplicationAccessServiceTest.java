package cn.xzkj.erp.tenantaccess;

import static cn.xzkj.erp.iam.domain.SecurityAuditActions.USER_APPLICATIONS_REPLACED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.application.IamActor;
import cn.xzkj.erp.iam.application.IamValidationException;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.persistence.IamAssignmentStore;
import cn.xzkj.erp.iam.persistence.UserAccountEntity;
import cn.xzkj.erp.iam.persistence.UserAccountRepository;
import cn.xzkj.erp.tenantaccess.TenantEntitlementService.ApplicationAccess;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;

class UserApplicationAccessServiceTest {

    private static final UUID TENANT_ID = UUID.fromString(
            "10000000-0000-4000-8000-000000000001");
    private static final UUID USER_ID = UUID.fromString(
            "20000000-0000-4000-8000-000000000001");
    private static final UUID ADMIN_ID = UUID.fromString(
            "20000000-0000-4000-8000-000000000002");
    private static final Instant NOW = Instant.parse("2026-08-28T10:00:00Z");

    private final UserApplicationAccessStore store = mock(UserApplicationAccessStore.class);
    private final TenantEntitlementService entitlements = mock(TenantEntitlementService.class);
    private final UserAccountRepository users = mock(UserAccountRepository.class);
    private final IamAssignmentStore assignments = mock(IamAssignmentStore.class);
    private final SecurityAuditRecorder audit = mock(SecurityAuditRecorder.class);
    private UserApplicationAccessService service;

    @BeforeEach
    void setUp() {
        service = new UserApplicationAccessService(
                store,
                entitlements,
                users,
                assignments,
                audit,
                Clock.fixed(NOW, ZoneOffset.UTC));
        when(entitlements.sessionAccess(TENANT_ID)).thenReturn(List.of(
                new ApplicationAccess("ERP", List.of("ORDERS")),
                new ApplicationAccess("CHAT", List.of("WORKSPACE"))));
        when(users.findByIdAndTenant_Id(USER_ID, TENANT_ID))
                .thenReturn(Optional.of(mock(UserAccountEntity.class)));
    }

    @Test
    void ordinaryEmployeeReceivesOnlyExplicitApplicationsWithinTenantEntitlements() {
        when(store.read(TENANT_ID, USER_ID)).thenReturn(
                new UserApplicationAccessStore.Snapshot(3, Set.of("ERP", "ASSET_REGISTRY")));

        assertThat(service.sessionAccess(TENANT_ID, USER_ID))
                .extracting(ApplicationAccess::code)
                .containsExactly("ERP");
    }

    @Test
    void enterpriseAdministratorAutomaticallyReceivesEveryEnabledApplication() {
        when(assignments.existsUserWithSystemRoleCode(
                TENANT_ID, USER_ID, "tenant_admin")).thenReturn(true);

        assertThat(service.sessionAccess(TENANT_ID, USER_ID))
                .extracting(ApplicationAccess::code)
                .containsExactly("ERP", "CHAT");
    }

    @Test
    void onlyEnterpriseOrPlatformAdministratorCanReplaceEmployeeApplications() {
        IamActor ordinaryActor = new IamActor(
                TENANT_ID, ADMIN_ID, null, "request-1", "127.0.0.1");

        assertThatThrownBy(() -> service.replace(
                ordinaryActor, USER_ID, 0, Set.of("ERP")))
                .isInstanceOf(AccessDeniedException.class);
    }

    @Test
    void replacementIsVersionedLimitedToTenantEntitlementsAndAudited() {
        when(assignments.existsUserWithSystemRoleCode(
                TENANT_ID, ADMIN_ID, "tenant_admin")).thenReturn(true);
        when(store.replace(
                TENANT_ID, USER_ID, 4, Set.of("ERP"), ADMIN_ID, null, NOW))
                .thenReturn(5L);
        IamActor actor = new IamActor(
                TENANT_ID, ADMIN_ID, null, "request-2", "127.0.0.1");

        var result = service.replace(actor, USER_ID, 4, Set.of("ERP"));

        assertThat(result.version()).isEqualTo(5);
        assertThat(result.applications()).containsExactly("ERP");
        verify(audit).recordAtomically(org.mockito.ArgumentMatchers.argThat(event ->
                event.action().equals(USER_APPLICATIONS_REPLACED)
                        && event.resourceId().equals(USER_ID.toString())
                        && event.details().equals(Map.of("applicationCount", "1"))));

        assertThatThrownBy(() -> service.replace(
                actor, USER_ID, 5, Set.of("ASSET_REGISTRY")))
                .isInstanceOf(IamValidationException.class);
    }
}
