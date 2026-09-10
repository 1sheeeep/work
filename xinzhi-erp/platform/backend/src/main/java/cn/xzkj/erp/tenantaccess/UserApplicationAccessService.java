package cn.xzkj.erp.tenantaccess;

import static cn.xzkj.erp.iam.domain.SecurityAuditActions.USER_APPLICATIONS_REPLACED;

import cn.xzkj.erp.iam.application.IamActor;
import cn.xzkj.erp.iam.application.IamNotFoundException;
import cn.xzkj.erp.iam.application.IamValidationException;
import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.persistence.IamAssignmentStore;
import cn.xzkj.erp.iam.persistence.UserAccountRepository;
import cn.xzkj.erp.tenantaccess.TenantEntitlementService.ApplicationAccess;
import java.time.Clock;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserApplicationAccessService {

    private static final String ENTERPRISE_ADMIN_ROLE_CODE = "tenant_admin";

    private final UserApplicationAccessStore store;
    private final TenantEntitlementService entitlementService;
    private final UserAccountRepository userRepository;
    private final IamAssignmentStore assignmentStore;
    private final SecurityAuditRecorder auditRecorder;
    private final Clock clock;

    public UserApplicationAccessService(
            UserApplicationAccessStore store,
            TenantEntitlementService entitlementService,
            UserAccountRepository userRepository,
            IamAssignmentStore assignmentStore,
            SecurityAuditRecorder auditRecorder,
            Clock clock) {
        this.store = store;
        this.entitlementService = entitlementService;
        this.userRepository = userRepository;
        this.assignmentStore = assignmentStore;
        this.auditRecorder = auditRecorder;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<ApplicationAccess> sessionAccess(UUID tenantId, UUID userId) {
        List<ApplicationAccess> tenantAccess = entitlementService.sessionAccess(tenantId);
        if (isEnterpriseAdministrator(tenantId, userId)) {
            return tenantAccess;
        }
        Set<String> assigned = store.read(tenantId, userId).applications();
        return tenantAccess.stream()
                .filter(application -> assigned.contains(application.code()))
                .toList();
    }

    @Transactional(readOnly = true)
    public boolean applicationAccessible(
            UUID tenantId,
            UUID userId,
            String applicationCode) {
        return sessionAccess(tenantId, userId).stream()
                .anyMatch(application -> application.code().equals(applicationCode));
    }

    @Transactional(readOnly = true)
    public AccessView view(UUID tenantId, UUID userId) {
        requireUser(tenantId, userId);
        boolean enterpriseAdministrator = isEnterpriseAdministrator(tenantId, userId);
        UserApplicationAccessStore.Snapshot snapshot = store.read(tenantId, userId);
        List<String> applications = entitlementService.sessionAccess(tenantId).stream()
                .map(ApplicationAccess::code)
                .filter(code -> enterpriseAdministrator || snapshot.applications().contains(code))
                .toList();
        return new AccessView(
                userId,
                snapshot.version(),
                enterpriseAdministrator,
                applications);
    }

    @Transactional
    public AccessView replace(
            IamActor actor,
            UUID userId,
            long expectedVersion,
            Set<String> requestedApplications) {
        requireAdministrator(actor);
        requireUser(actor.tenantId(), userId);
        if (isEnterpriseAdministrator(actor.tenantId(), userId)) {
            throw new IamValidationException();
        }
        Set<String> available = entitlementService.sessionAccess(actor.tenantId()).stream()
                .map(ApplicationAccess::code)
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
        if (requestedApplications == null
                || requestedApplications.stream().anyMatch(code -> !available.contains(code))) {
            throw new IamValidationException();
        }
        Set<String> normalized = new LinkedHashSet<>(requestedApplications);
        long version = store.replace(
                actor.tenantId(),
                userId,
                expectedVersion,
                normalized,
                actor.userId(),
                actor.systemAdminId(),
                clock.instant());
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                USER_APPLICATIONS_REPLACED,
                "user_application_access",
                userId.toString(),
                actor.requestId(),
                actor.sourceIp(),
                Map.of("applicationCount", Integer.toString(normalized.size()))));
        return new AccessView(
                userId,
                version,
                false,
                entitlementService.sessionAccess(actor.tenantId()).stream()
                        .map(ApplicationAccess::code)
                        .filter(normalized::contains)
                        .toList());
    }

    @Transactional(readOnly = true)
    public AccessView administratorView(IamActor actor, UUID userId) {
        requireAdministrator(actor);
        return view(actor.tenantId(), userId);
    }

    private void requireAdministrator(IamActor actor) {
        if (actor.systemAdminId() != null) {
            return;
        }
        if (actor.userId() == null
                || !isEnterpriseAdministrator(actor.tenantId(), actor.userId())) {
            throw new AccessDeniedException("Enterprise administrator required");
        }
    }

    private boolean isEnterpriseAdministrator(UUID tenantId, UUID userId) {
        return assignmentStore.existsUserWithSystemRoleCode(
                tenantId,
                userId,
                ENTERPRISE_ADMIN_ROLE_CODE);
    }

    private void requireUser(UUID tenantId, UUID userId) {
        userRepository.findByIdAndTenant_Id(userId, tenantId)
                .orElseThrow(IamNotFoundException::new);
    }

    public record AccessView(
            UUID userId,
            long version,
            boolean enterpriseAdministrator,
            List<String> applications) {

        public AccessView {
            applications = List.copyOf(applications);
        }
    }
}
