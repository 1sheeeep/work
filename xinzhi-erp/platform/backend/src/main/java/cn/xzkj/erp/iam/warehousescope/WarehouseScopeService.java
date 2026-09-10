package cn.xzkj.erp.iam.warehousescope;

import static cn.xzkj.erp.iam.domain.SecurityAuditActions.WAREHOUSE_SCOPE_UPDATED;

import cn.xzkj.erp.iam.application.IamActor;
import cn.xzkj.erp.iam.application.IamConflictException;
import cn.xzkj.erp.iam.application.IamNotFoundException;
import cn.xzkj.erp.iam.application.IamOptimisticLockException;
import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.persistence.IamAssignmentStore;
import cn.xzkj.erp.iam.persistence.UserAccountRepository;
import java.time.Clock;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WarehouseScopeService {

    private static final String TENANT_ADMIN_ROLE_CODE = "tenant_admin";

    private final WarehouseScopeRepository scopeRepository;
    private final WarehouseScopeItemStore itemStore;
    private final UserAccountRepository userRepository;
    private final IamAssignmentStore assignmentStore;
    private final SecurityAuditRecorder auditRecorder;
    private final Clock clock;

    public WarehouseScopeService(
            WarehouseScopeRepository scopeRepository,
            WarehouseScopeItemStore itemStore,
            UserAccountRepository userRepository,
            IamAssignmentStore assignmentStore,
            SecurityAuditRecorder auditRecorder,
            Clock clock) {
        this.scopeRepository = scopeRepository;
        this.itemStore = itemStore;
        this.userRepository = userRepository;
        this.assignmentStore = assignmentStore;
        this.auditRecorder = auditRecorder;
        this.clock = clock;
    }

    @Transactional
    public void initializeSelectedEmpty(UUID tenantId, UUID userId) {
        scopeRepository.saveAndFlush(new WarehouseScopeEntity(
                new WarehouseScopeId(tenantId, userId),
                WarehouseScopeMode.SELECTED,
                clock.instant()));
    }

    @Transactional(readOnly = true)
    public WarehouseScopeView get(IamActor actor, UUID targetUserId) {
        requireScopeAdministrator(actor);
        requireTarget(actor.tenantId(), targetUserId);
        if (isTenantAdmin(actor.tenantId(), targetUserId)) {
            return new WarehouseScopeView(
                    targetUserId, WarehouseScopeMode.ALL, List.of(), 0);
        }
        WarehouseScopeEntity scope = scopeRepository
                .findById(new WarehouseScopeId(actor.tenantId(), targetUserId))
                .orElseThrow(IamConflictException::new);
        return view(scope);
    }

    @Transactional
    public WarehouseScopeView replace(
            IamActor actor,
            UUID targetUserId,
            long expectedVersion,
            WarehouseScopeMode mode,
            List<UUID> requestedWarehouseIds) {
        requireScopeAdministrator(actor);
        requireTarget(actor.tenantId(), targetUserId);
        if (isTenantAdmin(actor.tenantId(), targetUserId)) {
            throw new ProtectedWarehouseScopeException();
        }

        Set<UUID> warehouseIds = new LinkedHashSet<>(requestedWarehouseIds);
        if (mode == WarehouseScopeMode.ALL && !warehouseIds.isEmpty()) {
            throw new cn.xzkj.erp.iam.application.IamValidationException();
        }

        WarehouseScopeEntity scope = scopeRepository
                .findForUpdateById(
                        new WarehouseScopeId(actor.tenantId(), targetUserId))
                .orElseThrow(IamConflictException::new);
        if (scope.getVersion() != expectedVersion) {
            throw new IamOptimisticLockException();
        }
        Set<UUID> beforeIds = scope.getMode() == WarehouseScopeMode.ALL
                ? Set.of()
                : itemStore.findWarehouseIds(actor.tenantId(), targetUserId);
        Set<UUID> added = new LinkedHashSet<>(warehouseIds);
        added.removeAll(beforeIds);
        Map<UUID, String> lockedWarehouses =
                itemStore.lockWarehouses(actor.tenantId(), added);
        if (mode == WarehouseScopeMode.SELECTED
                && (lockedWarehouses.size() != added.size()
                || added.stream().anyMatch(warehouseId ->
                        "ARCHIVED".equals(
                                lockedWarehouses.get(warehouseId))))) {
            throw new IamNotFoundException();
        }
        if (scope.getMode() == mode && beforeIds.equals(warehouseIds)) {
            return view(scope, beforeIds);
        }

        WarehouseScopeMode beforeMode = scope.getMode();
        itemStore.deleteWarehouseIds(actor.tenantId(), targetUserId);
        scope.replace(mode, clock.instant());
        WarehouseScopeEntity saved;
        try {
            saved = scopeRepository.saveAndFlush(scope);
            if (mode == WarehouseScopeMode.SELECTED) {
                itemStore.insertWarehouseIds(
                        actor.tenantId(), targetUserId, warehouseIds);
            }
        } catch (DataIntegrityViolationException concurrentChange) {
            throw new IamConflictException();
        }

        Set<UUID> removed = new LinkedHashSet<>(beforeIds);
        removed.removeAll(warehouseIds);
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                WAREHOUSE_SCOPE_UPDATED,
                "user_warehouse_scope",
                targetUserId.toString(),
                actor.requestId(),
                actor.sourceIp(),
                Map.of(
                        "beforeMode", beforeMode.name(),
                        "afterMode", mode.name(),
                        "beforeCount", Integer.toString(beforeIds.size()),
                        "afterCount", Integer.toString(warehouseIds.size()),
                        "addedCount", Integer.toString(added.size()),
                        "removedCount", Integer.toString(removed.size()),
                        "scopeVersion", Long.toString(saved.getVersion()))));
        return view(saved, warehouseIds);
    }

    private WarehouseScopeView view(WarehouseScopeEntity scope) {
        Set<UUID> warehouseIds =
                scope.getMode() == WarehouseScopeMode.ALL
                        ? Set.of()
                        : itemStore.findWarehouseIds(
                                scope.getId().tenantId(),
                                scope.getId().userId());
        return view(scope, warehouseIds);
    }

    private static WarehouseScopeView view(
            WarehouseScopeEntity scope, Set<UUID> warehouseIds) {
        List<UUID> sortedIds = new ArrayList<>(warehouseIds);
        sortedIds.sort(UUID::compareTo);
        return new WarehouseScopeView(
                scope.getId().userId(),
                scope.getMode(),
                List.copyOf(sortedIds),
                scope.getVersion());
    }

    private void requireScopeAdministrator(IamActor actor) {
        if (actor == null || actor.tenantId() == null) {
            throw new AccessDeniedException("Tenant actor is required");
        }
        if (actor.systemAdminId() != null) {
            if (actor.userId() != null) {
                throw new AccessDeniedException("Invalid actor");
            }
            return;
        }
        if (actor.userId() == null
                || !isTenantAdmin(actor.tenantId(), actor.userId())) {
            throw new AccessDeniedException(
                    "Enterprise administrator required");
        }
    }

    private void requireTarget(UUID tenantId, UUID targetUserId) {
        userRepository.findByIdAndTenant_Id(targetUserId, tenantId)
                .orElseThrow(IamNotFoundException::new);
    }

    private boolean isTenantAdmin(UUID tenantId, UUID userId) {
        return assignmentStore.existsUserWithSystemRoleCode(
                tenantId, userId, TENANT_ADMIN_ROLE_CODE);
    }

    public record WarehouseScopeView(
            UUID userId,
            WarehouseScopeMode mode,
            List<UUID> warehouseIds,
            long version) {
    }
}
