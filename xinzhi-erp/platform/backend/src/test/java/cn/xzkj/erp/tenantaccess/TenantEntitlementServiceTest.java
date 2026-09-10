package cn.xzkj.erp.tenantaccess;

import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.TENANT_ENTITLEMENTS_UPDATED;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.application.IamValidationException;
import cn.xzkj.erp.iam.persistence.PermissionEntity;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.persistence.TenantEntity;
import cn.xzkj.erp.iam.persistence.TenantRepository;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditRecorder;
import cn.xzkj.erp.platformadmin.application.PlatformAdminActor;
import cn.xzkj.erp.tenantaccess.TenantApplicationCatalog.EnabledModule;
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

class TenantEntitlementServiceTest {

    private static final UUID TENANT_ID = UUID.fromString(
            "10000000-0000-4000-8000-000000000001");
    private final TenantEntitlementStore store = mock(TenantEntitlementStore.class);
    private final TenantRepository tenants = mock(TenantRepository.class);
    private final PermissionRepository permissions = mock(PermissionRepository.class);
    private final PlatformAdminAuditRecorder audit = mock(PlatformAdminAuditRecorder.class);
    private TenantEntitlementService service;

    @BeforeEach
    void setUp() {
        service = new TenantEntitlementService(
                store,
                tenants,
                permissions,
                audit,
                Clock.fixed(Instant.parse("2026-08-28T08:00:00Z"), ZoneOffset.UTC));
    }

    @Test
    void filtersRoleUnionThroughEnabledModulesAndKeepsCorePermissions() {
        when(store.read(TENANT_ID)).thenReturn(new TenantEntitlementStore.Snapshot(
                3,
                Set.of(new EnabledModule("ERP", "ORDERS"))));
        PermissionEntity orders = permission(
                "20000000-0000-4000-8000-000000000001",
                "orders.read",
                "orders");
        PermissionEntity products = permission(
                "20000000-0000-4000-8000-000000000002",
                "products.read",
                "products");
        PermissionEntity iam = permission(
                "20000000-0000-4000-8000-000000000003",
                "iam:user:read",
                "iam");
        when(permissions.findAllByCodeIn(List.of(
                "orders.read", "products.read", "iam:user:read")))
                .thenReturn(List.of(orders, products, iam));

        assertThat(service.filterPermissionCodes(
                TENANT_ID,
                List.of("orders.read", "products.read", "iam:user:read")))
                .containsExactly("orders.read", "iam:user:read");
    }

    @Test
    void rejectsNewPermissionFromDisabledModuleButPreservesExistingAssignment() {
        when(store.read(TENANT_ID)).thenReturn(new TenantEntitlementStore.Snapshot(
                1,
                Set.of(new EnabledModule("ERP", "ORDERS"))));
        PermissionEntity products = permission(
                "20000000-0000-4000-8000-000000000002",
                "products.read",
                "products");
        when(permissions.findAllByIdIn(Set.of(products.getId())))
                .thenReturn(List.of(products));

        assertThatThrownBy(() -> service.requireAssignablePermissions(
                TENANT_ID,
                Set.of(products.getId()),
                Set.of()))
                .isInstanceOf(IamValidationException.class);

        service.requireAssignablePermissions(
                TENANT_ID,
                Set.of(products.getId()),
                Set.of(products.getId()));
    }

    @Test
    void viewSeparatesAllIntegratedApplications() {
        TenantEntity tenant = mock(TenantEntity.class);
        when(tenant.isDeleted()).thenReturn(false);
        when(tenants.findById(TENANT_ID)).thenReturn(Optional.of(tenant));
        when(store.read(TENANT_ID)).thenReturn(new TenantEntitlementStore.Snapshot(
                2,
                Set.of(
                        new EnabledModule("ERP", "ORDERS"),
                        new EnabledModule("CHAT", "WORKSPACE"))));

        TenantEntitlementService.EntitlementView view = service.view(TENANT_ID);

        assertThat(view.version()).isEqualTo(2);
        assertThat(view.applications()).extracting("code")
                .containsExactly("ERP", "CHAT", "ZHAOYAOJING", "ASSET_REGISTRY");
        assertThat(view.applications().stream()
                .filter(application -> application.code().equals("ZHAOYAOJING"))
                .findFirst().orElseThrow().integrationStatus())
                .isEqualTo(TenantApplicationCatalog.AVAILABLE);
        assertThat(view.applications().stream()
                .filter(application -> application.code().equals("ASSET_REGISTRY"))
                .findFirst().orElseThrow().integrationStatus())
                .isEqualTo(TenantApplicationCatalog.AVAILABLE);
    }

    @Test
    void replacingEntitlementsUsesOptimisticVersionAndWritesPlatformAudit() {
        TenantEntity tenant = mock(TenantEntity.class);
        when(tenant.isDeleted()).thenReturn(false);
        when(tenants.findById(TENANT_ID)).thenReturn(Optional.of(tenant));
        when(store.replace(
                TENANT_ID,
                4,
                Set.of(new EnabledModule("ERP", "ORDERS")),
                UUID.fromString("30000000-0000-4000-8000-000000000001"),
                Instant.parse("2026-08-28T08:00:00Z")))
                .thenReturn(5L);

        TenantEntitlementService.EntitlementView result = service.replace(
                new PlatformAdminActor(
                        UUID.fromString("30000000-0000-4000-8000-000000000001"),
                        UUID.fromString("30000000-0000-4000-8000-000000000002"),
                        "request-1",
                        "127.0.0.1"),
                TENANT_ID,
                4,
                List.of(new TenantEntitlementService.ApplicationSelection(
                        "ERP", Set.of("ORDERS"))));

        assertThat(result.version()).isEqualTo(5);
        verify(audit).recordAtomically(org.mockito.ArgumentMatchers.argThat(event ->
                event.tenantId().equals(TENANT_ID)
                        && event.action().equals(TENANT_ENTITLEMENTS_UPDATED)
                        && event.resourceType().equals("tenant_entitlements")
                        && event.details().equals(Map.of(
                                "applicationCount", "1",
                                "moduleCount", "1"))));
    }

    private static PermissionEntity permission(
            String id,
            String code,
            String module) {
        PermissionEntity permission = mock(PermissionEntity.class);
        when(permission.getId()).thenReturn(UUID.fromString(id));
        when(permission.getCode()).thenReturn(code);
        when(permission.getModule()).thenReturn(module);
        return permission;
    }
}
