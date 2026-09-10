package cn.xzkj.erp.platformadmin.application;

import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.LOGIN_FAILED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.LOGIN_SUCCEEDED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.PASSWORD_CHANGED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.SESSION_REVOKED;

import cn.xzkj.erp.iam.application.IamNotFoundException;
import cn.xzkj.erp.iam.application.IamValidationException;
import cn.xzkj.erp.iam.application.LoginRateLimitedException;
import cn.xzkj.erp.iam.application.PasswordHashingService;
import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.iam.domain.BusinessEmailAddress;
import cn.xzkj.erp.iam.domain.LoginIdentifier;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditEvent;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditRecorder;
import cn.xzkj.erp.platformadmin.domain.SystemAdminStatus;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminCredentialRepository;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminSessionEntity;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminSessionRepository;
import cn.xzkj.erp.platformadmin.persistence.SystemAdminEntity;
import cn.xzkj.erp.platformadmin.persistence.SystemAdminRepository;
import cn.xzkj.erp.platformadmin.security.PlatformAdminPrincipal;
import java.time.Clock;
import java.time.Instant;
import java.util.Arrays;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PlatformAdminAuthService {

    private final SystemAdminRepository adminRepository;
    private final PlatformAdminSessionRepository sessionRepository;
    private final cn.xzkj.erp.platformadmin.persistence.PlatformTenantSessionRepository
            tenantSessionRepository;
    private final PasswordHashingService passwordHashingService;
    private final SessionTokenService tokenService;
    private final PlatformAdminLoginThrottleService throttleService;
    private final PlatformAdminAuditRecorder auditRecorder;
    private final PlatformAdminCredentialRepository credentialRepository;
    private final Clock clock;
    private final String dummyPasswordHash;

    public PlatformAdminAuthService(
            SystemAdminRepository adminRepository,
            PlatformAdminSessionRepository sessionRepository,
            cn.xzkj.erp.platformadmin.persistence.PlatformTenantSessionRepository
                    tenantSessionRepository,
            PasswordHashingService passwordHashingService,
            SessionTokenService tokenService,
            PlatformAdminLoginThrottleService throttleService,
            PlatformAdminAuditRecorder auditRecorder,
            PlatformAdminCredentialRepository credentialRepository,
            Clock clock) {
        this.adminRepository = adminRepository;
        this.sessionRepository = sessionRepository;
        this.tenantSessionRepository = tenantSessionRepository;
        this.passwordHashingService = passwordHashingService;
        this.tokenService = tokenService;
        this.throttleService = throttleService;
        this.auditRecorder = auditRecorder;
        this.credentialRepository = credentialRepository;
        this.clock = clock;
        this.dummyPasswordHash = passwordHashingService.hashForStorage(
                UUID.randomUUID().toString().toCharArray());
    }

    @Transactional
    public LoginResult login(
            String username,
            CharSequence password,
            String requestId,
            String sourceIp) {
        Optional<SystemAdminEntity> candidate;
        if (BusinessEmailAddress.isValid(username)) {
            candidate = adminRepository.findByEmail(
                    BusinessEmailAddress.normalize(username));
        } else {
            String phoneNumber = LoginIdentifier.normalizePhone(username);
            candidate = phoneNumber == null
                    ? adminRepository.findByUsernameIgnoreCase(username)
                    : adminRepository.findByPhoneNumber(phoneNumber);
        }
        SystemAdminEntity admin = candidate.orElse(null);
        String storedHash = admin == null || admin.getPasswordHash() == null
                ? dummyPasswordHash
                : admin.getPasswordHash();
        Optional<LoginRateLimitedException> currentLock = admin == null
                ? Optional.empty()
                : throttleService.currentLock(admin.getId());
        boolean passwordMatches =
                passwordHashingService.matches(password, storedHash);

        boolean validActiveAdmin = admin != null
                && admin.getStatus() == SystemAdminStatus.ACTIVE
                && admin.getPasswordHash() != null
                && passwordMatches;
        if (!validActiveAdmin) {
            if (currentLock.isPresent()) {
                recordFailure(admin == null ? null : admin.getId(), requestId, sourceIp);
                throw currentLock.orElseThrow();
            }
            PlatformAdminLoginThrottleService.FailureDecision decision =
                    admin == null
                            ? null
                            : throttleService.recordFailure(
                                    admin.getId(),
                                    requestId);
            recordFailure(
                    admin == null ? null : admin.getId(),
                    requestId,
                    sourceIp);
            if (decision != null && decision.rateLimited()) {
                throw decision.exception();
            }
            throw new InvalidPlatformAdminLoginException();
        }

        throttleService.clearForVerifiedLogin(admin.getId());

        Instant now = clock.instant();
        SessionTokenService.IssuedToken token = tokenService.issue();
        PlatformAdminSessionEntity session = new PlatformAdminSessionEntity(
                UUID.randomUUID(),
                admin,
                token.hash(),
                token.expiresAt(),
                now);
        sessionRepository.save(session);
        auditRecorder.recordAtomically(new PlatformAdminAuditEvent(
                admin.getId(),
                null,
                LOGIN_SUCCEEDED,
                "platform_admin_session",
                session.getId().toString(),
                requestId,
                sourceIp,
                Map.of()));
        return new LoginResult(
                token.rawValue(),
                token.expiresAt(),
                view(admin));
    }

    @Transactional
    public void logout(
            PlatformAdminPrincipal principal,
            String requestId,
            String sourceIp) {
        Instant now = clock.instant();
        int revoked = sessionRepository.revokeOne(
                principal.sessionId(),
                principal.id(),
                now);
        if (revoked > 0) {
            tenantSessionRepository.revokeAllForPlatformSession(
                    principal.sessionId(),
                    now);
            auditRecorder.recordAtomically(new PlatformAdminAuditEvent(
                    principal.id(),
                    null,
                    SESSION_REVOKED,
                    "platform_admin_session",
                    principal.sessionId().toString(),
                    requestId,
                    sourceIp,
                    Map.of()));
        }
    }

    @Transactional
    public void changeOwnPassword(
            PlatformAdminPrincipal principal,
            char[] currentPassword,
            char[] newPassword,
            String requestId,
            String sourceIp) {
        try {
            SystemAdminEntity admin = adminRepository
                    .findByIdForUpdate(principal.id())
                    .orElseThrow(IamNotFoundException::new);
            if (admin.getStatus() != SystemAdminStatus.ACTIVE
                    || currentPassword == null
                    || !passwordHashingService.matches(
                            java.nio.CharBuffer.wrap(currentPassword),
                            admin.getPasswordHash())) {
                throw new InvalidPlatformAdminLoginException();
            }
            String passwordHash;
            try {
                passwordHash =
                        passwordHashingService.hashForStorage(newPassword);
            } catch (IllegalArgumentException invalidPassword) {
                throw new IamValidationException();
            }
            Instant now = clock.instant();
            admin.changePassword(passwordHash, now);
            adminRepository.saveAndFlush(admin);
            credentialRepository.revokeAllOpen(admin.getId(), now);
            auditRecorder.recordAtomically(new PlatformAdminAuditEvent(
                    admin.getId(),
                    null,
                    PASSWORD_CHANGED,
                    "system_admin",
                    admin.getId().toString(),
                    requestId,
                    sourceIp,
                    Map.of()));
        } finally {
            clear(currentPassword);
            clear(newPassword);
        }
    }

    public static AdminView view(SystemAdminEntity admin) {
        return new AdminView(
                admin.getId(),
                admin.getUsername(),
                admin.getEmail(),
                admin.getPhoneNumber(),
                admin.getDisplayName(),
                admin.getStatus());
    }

    private void recordFailure(
            UUID adminId,
            String requestId,
            String sourceIp) {
        auditRecorder.record(new PlatformAdminAuditEvent(
                null,
                null,
                LOGIN_FAILED,
                "system_admin",
                adminId == null ? "unknown" : adminId.toString(),
                requestId,
                sourceIp,
                Map.of("reason", "invalid_credentials_or_status")));
    }

    private static void clear(char[] value) {
        if (value != null) {
            Arrays.fill(value, '\0');
        }
    }

    public record LoginResult(
            String accessToken,
            Instant expiresAt,
            AdminView admin) {
    }

    public record AdminView(
            UUID id,
            String username,
            String email,
            String phoneNumber,
            String displayName,
            SystemAdminStatus status) {
    }
}
