package cn.xzkj.erp.platformadmin.application;

import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.TENANT_ENTERED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.TENANT_SESSION_REVOKED;

import cn.xzkj.erp.iam.application.IamNotFoundException;
import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.iam.domain.TenantStatus;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.persistence.TenantEntity;
import cn.xzkj.erp.iam.persistence.TenantRepository;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditEvent;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditRecorder;
import cn.xzkj.erp.platformadmin.domain.SystemAdminStatus;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminSessionEntity;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminSessionRepository;
import cn.xzkj.erp.platformadmin.persistence.PlatformTenantSessionEntity;
import cn.xzkj.erp.platformadmin.persistence.PlatformTenantSessionRepository;
import cn.xzkj.erp.platformadmin.security.PlatformAdminPrincipal;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PlatformTenantSessionService {

    private final PlatformAdminSessionRepository platformSessionRepository;
    private final PlatformTenantSessionRepository tenantSessionRepository;
    private final TenantRepository tenantRepository;
    private final PermissionRepository permissionRepository;
    private final SessionTokenService tokenService;
    private final PlatformAdminAuditRecorder auditRecorder;
    private final Clock clock;

    public PlatformTenantSessionService(
            PlatformAdminSessionRepository platformSessionRepository,
            PlatformTenantSessionRepository tenantSessionRepository,
            TenantRepository tenantRepository,
            PermissionRepository permissionRepository,
            SessionTokenService tokenService,
            PlatformAdminAuditRecorder auditRecorder,
            Clock clock) {
        this.platformSessionRepository = platformSessionRepository;
        this.tenantSessionRepository = tenantSessionRepository;
        this.tenantRepository = tenantRepository;
        this.permissionRepository = permissionRepository;
        this.tokenService = tokenService;
        this.auditRecorder = auditRecorder;
        this.clock = clock;
    }

    @Transactional
    public EnteredTenantSession enter(
            PlatformAdminPrincipal principal,
            UUID tenantId,
            String requestId,
            String sourceIp) {
        Instant now = clock.instant();
        PlatformAdminSessionEntity platformSession =
                platformSessionRepository.findActiveById(
                                principal.sessionId(),
                                principal.id(),
                                now)
                        .orElseThrow(IamNotFoundException::new);
        TenantEntity tenant = tenantRepository.findById(tenantId)
                .filter(value -> value.getStatus() == TenantStatus.ACTIVE)
                .orElseThrow(IamNotFoundException::new);
        SessionTokenService.IssuedToken token = tokenService.issue();
        Instant expiresAt = token.expiresAt().isBefore(
                        platformSession.getExpiresAt())
                ? token.expiresAt()
                : platformSession.getExpiresAt();
        PlatformTenantSessionEntity tenantSession =
                new PlatformTenantSessionEntity(
                        UUID.randomUUID(),
                        platformSession,
                        platformSession.getSystemAdmin(),
                        tenant,
                        token.hash(),
                        expiresAt,
                        now);
        tenantSessionRepository.save(tenantSession);
        List<String> permissions = permissionRepository.findAllCodes();
        auditRecorder.recordAtomically(new PlatformAdminAuditEvent(
                principal.id(),
                tenantId,
                TENANT_ENTERED,
                "platform_admin_tenant_session",
                tenantSession.getId().toString(),
                requestId,
                sourceIp,
                Map.of()));
        return new EnteredTenantSession(
                token.rawValue(),
                expiresAt,
                new TenantSessionTenant(
                        tenant.getId(),
                        tenant.getCode(),
                        tenant.getName(),
                        tenant.getStatus()),
                new TenantSessionAdmin(
                        principal.id(),
                        principal.username(),
                        principal.email(),
                        principal.phoneNumber(),
                        principal.displayName(),
                        SystemAdminStatus.ACTIVE),
                permissions);
    }

    @Transactional
    public void logout(
            ErpPrincipal principal,
            String requestId,
            String sourceIp) {
        if (principal.systemAdminId() == null) {
            throw new IamNotFoundException();
        }
        int revoked = tenantSessionRepository.revokeOne(
                principal.sessionId(),
                principal.systemAdminId(),
                clock.instant());
        if (revoked > 0) {
            auditRecorder.recordAtomically(new PlatformAdminAuditEvent(
                    principal.systemAdminId(),
                    principal.tenantId(),
                    TENANT_SESSION_REVOKED,
                    "platform_admin_tenant_session",
                    principal.sessionId().toString(),
                    requestId,
                    sourceIp,
                    Map.of()));
        }
    }

    public record EnteredTenantSession(
            String accessToken,
            Instant expiresAt,
            TenantSessionTenant tenant,
            TenantSessionAdmin platformAdmin,
            List<String> permissions) {

        public EnteredTenantSession {
            permissions = List.copyOf(permissions);
        }
    }

    public record TenantSessionTenant(
            UUID id,
            String code,
            String name,
            TenantStatus status) {
    }

    public record TenantSessionAdmin(
            UUID id,
            String username,
            String email,
            String phoneNumber,
            String displayName,
            SystemAdminStatus status) {
    }
}
