package cn.xzkj.erp.iam.application;

import static cn.xzkj.erp.iam.domain.SecurityAuditActions.SESSION_REVOKED;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.persistence.AuthSessionEntity;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SessionManagementService {

    public static final int MAX_PAGE_SIZE = 100;
    public static final int MAX_PAGE_NUMBER = 1_000_000;

    private final AuthSessionRepository sessionRepository;
    private final SecurityAuditRecorder auditRecorder;
    private final Clock clock;

    public SessionManagementService(
            AuthSessionRepository sessionRepository,
            SecurityAuditRecorder auditRecorder,
            Clock clock) {
        this.sessionRepository = sessionRepository;
        this.auditRecorder = auditRecorder;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public PageResult<SessionView> listOwnSessions(
            ErpPrincipal principal,
            int page,
            int size) {
        validatePage(page, size);
        var result = sessionRepository.findAllByTenantIdAndUser_Id(
                principal.tenantId(),
                principal.userId(),
                PageRequest.of(
                        page,
                        size,
                        Sort.by("createdAt")
                                .descending()
                                .and(Sort.by("id").descending())));
        return PageResult.of(
                result.getContent().stream()
                        .map(session -> SessionView.from(
                                session,
                                principal.sessionId()))
                        .toList(),
                page,
                size,
                result.getTotalElements());
    }

    @Transactional
    public void revokeOwnSession(
            ErpPrincipal principal,
            UUID sessionId,
            String requestId,
            String sourceIp) {
        int revokedCount = sessionRepository.revokeScopedSessionIfOpen(
                sessionId,
                principal.tenantId(),
                principal.userId(),
                clock.instant());
        if (revokedCount == 0) {
            if (!sessionRepository.existsByIdAndTenantIdAndUser_Id(
                    sessionId,
                    principal.tenantId(),
                    principal.userId())) {
                throw new IamNotFoundException();
            }
            return;
        }
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                principal.tenantId(),
                principal.userId(),
                SESSION_REVOKED,
                "auth_session",
                sessionId.toString(),
                requestId,
                sourceIp,
                Map.of()));
    }

    private static void validatePage(int page, int size) {
        if (page < 0
                || page > MAX_PAGE_NUMBER
                || size < 1
                || size > MAX_PAGE_SIZE) {
            throw new IamValidationException();
        }
    }

    public record SessionView(
            UUID id,
            Instant createdAt,
            Instant expiresAt,
            Instant revokedAt,
            boolean current) {

        static SessionView from(
                AuthSessionEntity session,
                UUID currentSessionId) {
            return new SessionView(
                    session.getId(),
                    session.getCreatedAt(),
                    session.getExpiresAt(),
                    session.getRevokedAt(),
                    session.getId().equals(currentSessionId));
        }
    }

}
