package cn.xzkj.erp.tenantaccess;

import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.TENANT_ENTITLEMENTS_UPDATED;

import cn.xzkj.erp.iam.application.IamNotFoundException;
import cn.xzkj.erp.iam.application.IamValidationException;
import cn.xzkj.erp.iam.persistence.PermissionEntity;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.persistence.TenantRepository;
import cn.xzkj.erp.platformadmin.application.PlatformAdminActor;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditEvent;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditRecorder;
import cn.xzkj.erp.tenantaccess.TenantApplicationCatalog.ApplicationDefinition;
import cn.xzkj.erp.tenantaccess.TenantApplicationCatalog.EnabledModule;
import java.time.Clock;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TenantEntitlementService {

    private final TenantEntitlementStore store;
    private final TenantRepository tenantRepository;
    private final PermissionRepository permissionRepository;
    private final PlatformAdminAuditRecorder auditRecorder;
    private final Clock clock;

    public TenantEntitlementService(
            TenantEntitlementStore store,
            TenantRepository tenantRepository,
            PermissionRepository permissionRepository,
            PlatformAdminAuditRecorder auditRecorder,
            Clock clock) {
        this.store = store;
        this.tenantRepository = tenantRepository;
        this.permissionRepository = permissionRepository;
        this.auditRecorder = auditRecorder;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public EntitlementView view(UUID tenantId) {
        requireTenant(tenantId);
        TenantEntitlementStore.Snapshot snapshot = store.read(tenantId);
        return view(snapshot);
    }

    @Transactional
    public EntitlementView replace(
            PlatformAdminActor actor,
            UUID tenantId,
            long expectedVersion,
            List<ApplicationSelection> applications) {
        requireTenant(tenantId);
        Set<EnabledModule> enabled = validate(applications);
        long version = store.replace(
                tenantId,
                expectedVersion,
                enabled,
                actor.adminId(),
                clock.instant());
        auditRecorder.recordAtomically(new PlatformAdminAuditEvent(
                actor.adminId(),
                tenantId,
                TENANT_ENTITLEMENTS_UPDATED,
                "tenant_entitlements",
                tenantId.toString(),
                actor.requestId(),
                actor.sourceIp(),
                Map.of(
                        "applicationCount", Long.toString(enabled.stream()
                                .map(EnabledModule::applicationCode)
                                .distinct()
                                .count()),
                        "moduleCount", Integer.toString(enabled.size()))));
        return view(new TenantEntitlementStore.Snapshot(version, enabled));
    }

    @Transactional(readOnly = true)
    public List<ApplicationAccess> sessionAccess(UUID tenantId) {
        Set<EnabledModule> enabled = store.read(tenantId).enabledModules();
        return toSessionAccess(enabled);
    }

    public List<ApplicationAccess> platformSessionAccess() {
        Set<EnabledModule> enabled = TenantApplicationCatalog.applications().stream()
                .filter(application -> TenantApplicationCatalog.AVAILABLE.equals(
                        application.integrationStatus()))
                .flatMap(application -> application.modules().stream()
                        .map(module -> new EnabledModule(
                                application.code(), module.code())))
                .collect(Collectors.toCollection(LinkedHashSet::new));
        return toSessionAccess(enabled);
    }

    @Transactional(readOnly = true)
    public List<String> filterPermissionCodes(
            UUID tenantId,
            List<String> permissionCodes) {
        if (permissionCodes.isEmpty()) {
            return List.of();
        }
        Set<EnabledModule> enabled = store.read(tenantId).enabledModules();
        Map<String, PermissionEntity> permissions = permissionRepository
                .findAllByCodeIn(permissionCodes).stream()
                .collect(Collectors.toMap(PermissionEntity::getCode, value -> value));
        return permissionCodes.stream()
                .filter(code -> {
                    PermissionEntity permission = permissions.get(code);
                    return permission != null
                            && TenantApplicationCatalog.permissionAllowed(permission, enabled);
                })
                .toList();
    }

    @Transactional(readOnly = true)
    public void requireAssignablePermissions(
            UUID tenantId,
            Set<UUID> permissionIds,
            Set<UUID> currentPermissionIds) {
        if (permissionIds.isEmpty()) {
            return;
        }
        List<PermissionEntity> permissions = permissionRepository
                .findAllByIdIn(permissionIds);
        if (permissions.size() != permissionIds.size()) {
            throw new IamNotFoundException();
        }
        Set<EnabledModule> enabled = store.read(tenantId).enabledModules();
        if (permissions.stream().anyMatch(permission ->
                !TenantApplicationCatalog.permissionAllowed(permission, enabled)
                        && !currentPermissionIds.contains(permission.getId()))) {
            throw new IamValidationException();
        }
    }

    @Transactional(readOnly = true)
    public boolean moduleEnabled(
            UUID tenantId,
            String applicationCode,
            String moduleCode) {
        return store.read(tenantId).enabledModules()
                .contains(new EnabledModule(applicationCode, moduleCode));
    }

    @Transactional(readOnly = true)
    public boolean applicationEnabled(
            UUID tenantId,
            String applicationCode) {
        return store.read(tenantId).enabledModules().stream()
                .anyMatch(module -> module.applicationCode()
                        .equals(applicationCode));
    }

    private void requireTenant(UUID tenantId) {
        tenantRepository.findById(tenantId)
                .filter(tenant -> !tenant.isDeleted())
                .orElseThrow(IamNotFoundException::new);
    }

    private static Set<EnabledModule> validate(
            List<ApplicationSelection> applications) {
        if (applications == null) {
            throw new IamValidationException();
        }
        Set<String> applicationCodes = new LinkedHashSet<>();
        Set<EnabledModule> enabled = new LinkedHashSet<>();
        for (ApplicationSelection selection : applications) {
            if (selection == null
                    || !applicationCodes.add(selection.code())
                    || !TenantApplicationCatalog.isAvailable(selection.code())
                    || selection.modules() == null
                    || selection.modules().isEmpty()) {
                throw new IamValidationException();
            }
            Set<String> moduleCodes = new LinkedHashSet<>();
            for (String moduleCode : selection.modules()) {
                if (!moduleCodes.add(moduleCode)
                        || !TenantApplicationCatalog.containsModule(
                                selection.code(), moduleCode)) {
                    throw new IamValidationException();
                }
                enabled.add(new EnabledModule(selection.code(), moduleCode));
            }
        }
        return enabled;
    }

    private static EntitlementView view(
            TenantEntitlementStore.Snapshot snapshot) {
        List<ApplicationEntitlement> applications = new ArrayList<>();
        for (ApplicationDefinition definition
                : TenantApplicationCatalog.applications()) {
            Set<String> enabledModules = snapshot.enabledModules().stream()
                    .filter(module -> module.applicationCode()
                            .equals(definition.code()))
                    .map(EnabledModule::moduleCode)
                    .collect(Collectors.toCollection(LinkedHashSet::new));
            applications.add(new ApplicationEntitlement(
                    definition.code(),
                    definition.name(),
                    definition.description(),
                    definition.integrationStatus(),
                    !enabledModules.isEmpty(),
                    definition.modules().stream()
                            .map(module -> new ModuleEntitlement(
                                    module.code(),
                                    module.name(),
                                    enabledModules.contains(module.code())))
                            .toList()));
        }
        return new EntitlementView(snapshot.version(), applications);
    }

    private static List<ApplicationAccess> toSessionAccess(
            Set<EnabledModule> enabled) {
        Map<String, List<String>> modules = new LinkedHashMap<>();
        for (ApplicationDefinition application
                : TenantApplicationCatalog.applications()) {
            List<String> enabledCodes = application.modules().stream()
                    .map(TenantApplicationCatalog.ModuleDefinition::code)
                    .filter(code -> enabled.contains(
                            new EnabledModule(application.code(), code)))
                    .toList();
            if (!enabledCodes.isEmpty()) {
                modules.put(application.code(), enabledCodes);
            }
        }
        return modules.entrySet().stream()
                .map(entry -> new ApplicationAccess(
                        entry.getKey(), entry.getValue()))
                .toList();
    }

    public record ApplicationSelection(String code, Set<String> modules) {

        public ApplicationSelection {
            modules = modules == null ? null : Set.copyOf(modules);
        }
    }

    public record EntitlementView(
            long version,
            List<ApplicationEntitlement> applications) {

        public EntitlementView {
            applications = List.copyOf(applications);
        }
    }

    public record ApplicationEntitlement(
            String code,
            String name,
            String description,
            String integrationStatus,
            boolean enabled,
            List<ModuleEntitlement> modules) {

        public ApplicationEntitlement {
            modules = List.copyOf(modules);
        }
    }

    public record ModuleEntitlement(
            String code,
            String name,
            boolean enabled) {
    }

    public record ApplicationAccess(String code, List<String> modules) {

        public ApplicationAccess {
            modules = List.copyOf(modules);
        }
    }
}
