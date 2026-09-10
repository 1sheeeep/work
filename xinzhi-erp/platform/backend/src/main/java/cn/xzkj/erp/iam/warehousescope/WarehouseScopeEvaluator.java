package cn.xzkj.erp.iam.warehousescope;

import cn.xzkj.erp.iam.persistence.IamAssignmentStore;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import java.util.Set;
import java.util.UUID;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WarehouseScopeEvaluator {

    private static final String TENANT_ADMIN_ROLE_CODE = "tenant_admin";

    private final WarehouseScopeRepository scopeRepository;
    private final WarehouseScopeItemStore itemStore;
    private final IamAssignmentStore assignmentStore;

    public WarehouseScopeEvaluator(
            WarehouseScopeRepository scopeRepository,
            WarehouseScopeItemStore itemStore,
            IamAssignmentStore assignmentStore) {
        this.scopeRepository = scopeRepository;
        this.itemStore = itemStore;
        this.assignmentStore = assignmentStore;
    }

    @Transactional(readOnly = true)
    public WarehouseScopeAccess evaluate(
            UUID tenantId, UUID userId, UUID systemAdminId) {
        requireIdentity(tenantId, userId, systemAdminId);
        if (systemAdminId != null || isTenantAdmin(tenantId, userId)) {
            return new WarehouseScopeAccess(WarehouseScopeMode.ALL, Set.of());
        }
        return scopeRepository.findById(new WarehouseScopeId(tenantId, userId))
                .map(scope -> new WarehouseScopeAccess(
                        scope.getMode(),
                        scope.getMode() == WarehouseScopeMode.ALL
                                ? Set.of()
                                : itemStore.findWarehouseIds(tenantId, userId)))
                .orElseGet(() -> new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED,
                        Set.of()));
    }

    public void requireAll(WarehouseScopeAccess access) {
        if (!access.allowsAll()) {
            throw new AccessDeniedException("ALL warehouse scope is required");
        }
    }

    public void requireVisible(
            WarehouseScopeAccess access, UUID warehouseId) {
        if (!access.allows(warehouseId)) {
            throw notFound();
        }
    }

    public void requireAllVisible(
            WarehouseScopeAccess access, Set<UUID> warehouseIds) {
        if (!access.allowsAll()
                && !access.warehouseIds().containsAll(warehouseIds)) {
            throw notFound();
        }
    }

    private boolean isTenantAdmin(UUID tenantId, UUID userId) {
        return userId != null
                && assignmentStore.existsUserWithSystemRoleCode(
                        tenantId, userId, TENANT_ADMIN_ROLE_CODE);
    }

    private static void requireIdentity(
            UUID tenantId, UUID userId, UUID systemAdminId) {
        if (tenantId == null || (userId == null) == (systemAdminId == null)) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }

    private static ResourceNotFoundException notFound() {
        return new ResourceNotFoundException("Warehouse was not found");
    }
}
