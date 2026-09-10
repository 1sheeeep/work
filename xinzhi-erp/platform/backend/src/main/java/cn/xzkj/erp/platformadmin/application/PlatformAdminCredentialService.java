package cn.xzkj.erp.platformadmin.application;

import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.CREDENTIAL_ISSUED;
import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.CREDENTIAL_REDEEMED;

import cn.xzkj.erp.iam.application.IamConflictException;
import cn.xzkj.erp.iam.application.IamValidationException;
import cn.xzkj.erp.iam.application.PasswordCredentialTokenService;
import cn.xzkj.erp.iam.application.PasswordHashingService;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditEvent;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditRecorder;
import cn.xzkj.erp.platformadmin.domain.PlatformAdminCredentialPurpose;
import cn.xzkj.erp.platformadmin.domain.SystemAdminStatus;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminCredentialEntity;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminCredentialRepository;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminSessionRepository;
import cn.xzkj.erp.platformadmin.persistence.PlatformTenantSessionRepository;
import cn.xzkj.erp.platformadmin.persistence.SystemAdminEntity;
import cn.xzkj.erp.platformadmin.persistence.SystemAdminRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PlatformAdminCredentialService {

    private static final Duration MINIMUM_TTL = Duration.ofMinutes(5);
    private static final Duration MAXIMUM_TTL = Duration.ofMinutes(120);

    private final PlatformAdminCredentialRepository credentialRepository;
    private final SystemAdminRepository adminRepository;
    private final PlatformAdminSessionRepository sessionRepository;
    private final PlatformTenantSessionRepository tenantSessionRepository;
    private final PasswordCredentialTokenService tokenService;
    private final PasswordHashingService passwordHashingService;
    private final PlatformAdminAuditRecorder auditRecorder;
    private final Clock clock;
    private final Duration defaultTtl;

    public PlatformAdminCredentialService(
            PlatformAdminCredentialRepository credentialRepository,
            SystemAdminRepository adminRepository,
            PlatformAdminSessionRepository sessionRepository,
            PlatformTenantSessionRepository tenantSessionRepository,
            PasswordCredentialTokenService tokenService,
            PasswordHashingService passwordHashingService,
            PlatformAdminAuditRecorder auditRecorder,
            Clock clock,
            @Value("${erp.security.password-credential-ttl:PT30M}")
            Duration defaultTtl) {
        this.credentialRepository = credentialRepository;
        this.adminRepository = adminRepository;
        this.sessionRepository = sessionRepository;
        this.tenantSessionRepository = tenantSessionRepository;
        this.tokenService = tokenService;
        this.passwordHashingService = passwordHashingService;
        this.auditRecorder = auditRecorder;
        this.clock = clock;
        this.defaultTtl = requireTtl(defaultTtl);
    }

    @Transactional
    public IssuedCredential issue(
            SystemAdminEntity target,
            PlatformAdminCredentialPurpose purpose,
            UUID createdByAdminId) {
        return issue(target, purpose, createdByAdminId, defaultTtl);
    }

    @Transactional
    public IssuedCredential issue(
            SystemAdminEntity target,
            PlatformAdminCredentialPurpose purpose,
            UUID createdByAdminId,
            Duration ttl) {
        Duration boundedTtl = requireTtl(ttl);
        if (target.getStatus() == SystemAdminStatus.DELETED) {
            throw new IamConflictException();
        }
        if (purpose == PlatformAdminCredentialPurpose.ACTIVATION
                && target.getStatus()
                        != SystemAdminStatus.PENDING_ACTIVATION) {
            throw new IamConflictException();
        }
        if (purpose == PlatformAdminCredentialPurpose.RESET
                && target.getStatus() != SystemAdminStatus.ACTIVE
                && target.getStatus() != SystemAdminStatus.DISABLED) {
            throw new IamConflictException();
        }
        Instant now = clock.instant();
        credentialRepository.revokeOpenForPurpose(
                target.getId(),
                purpose,
                now);
        PasswordCredentialTokenService.GeneratedToken token =
                tokenService.generate();
        PlatformAdminCredentialEntity credential =
                new PlatformAdminCredentialEntity(
                        UUID.randomUUID(),
                        target,
                        purpose,
                        token.tokenHash(),
                        now.plus(boundedTtl),
                        createdByAdminId,
                        now);
        try {
            credentialRepository.saveAndFlush(credential);
        } catch (DataIntegrityViolationException concurrentIssue) {
            throw new IamConflictException();
        }
        auditRecorder.recordAtomically(new PlatformAdminAuditEvent(
                createdByAdminId,
                null,
                CREDENTIAL_ISSUED,
                "system_admin",
                target.getId().toString(),
                null,
                null,
                Map.of("purpose", purpose.name())));
        return new IssuedCredential(
                token.rawToken(),
                credential.getExpiresAt());
    }

    @Transactional
    public void redeem(
            char[] rawToken,
            char[] newPassword,
            String requestId,
            String sourceIp) {
        String tokenHash = tokenService.hashPresented(rawToken);
        try {
            PlatformAdminCredentialEntity credential = credentialRepository
                    .findByTokenHashForUpdate(tokenHash)
                    .orElseThrow(InvalidPlatformAdminCredentialException::new);
            Instant now = clock.instant();
            SystemAdminEntity admin = credential.getSystemAdmin();
            if (!credential.isUsableAt(now)
                    || !statusAllowsRedemption(
                            credential.getPurpose(),
                            admin.getStatus())) {
                throw new InvalidPlatformAdminCredentialException();
            }

            String passwordHash;
            try {
                passwordHash =
                        passwordHashingService.hashForStorage(newPassword);
            } catch (IllegalArgumentException invalidPassword) {
                throw new IamValidationException();
            }
            SystemAdminStatus resultingStatus =
                    credential.getPurpose()
                                    == PlatformAdminCredentialPurpose.ACTIVATION
                            ? SystemAdminStatus.ACTIVE
                            : admin.getStatus();
            admin.initializePassword(passwordHash, resultingStatus, now);
            adminRepository.saveAndFlush(admin);
            credential.consume(now);
            credentialRepository.saveAndFlush(credential);
            credentialRepository.revokeOtherOpen(
                    admin.getId(),
                    credential.getId(),
                    now);
            tenantSessionRepository.revokeAllForAdmin(admin.getId(), now);
            sessionRepository.revokeAllForAdmin(admin.getId(), now);
            auditRecorder.recordAtomically(new PlatformAdminAuditEvent(
                    admin.getId(),
                    null,
                    CREDENTIAL_REDEEMED,
                    "system_admin",
                    admin.getId().toString(),
                    requestId,
                    sourceIp,
                    Map.of("purpose", credential.getPurpose().name())));
        } finally {
            if (newPassword != null) {
                Arrays.fill(newPassword, '\0');
            }
        }
    }

    private static boolean statusAllowsRedemption(
            PlatformAdminCredentialPurpose purpose,
            SystemAdminStatus status) {
        if (purpose == PlatformAdminCredentialPurpose.ACTIVATION) {
            return status == SystemAdminStatus.PENDING_ACTIVATION;
        }
        return status == SystemAdminStatus.ACTIVE
                || status == SystemAdminStatus.DISABLED;
    }

    private static Duration requireTtl(Duration value) {
        if (value == null
                || value.compareTo(MINIMUM_TTL) < 0
                || value.compareTo(MAXIMUM_TTL) > 0) {
            throw new IllegalArgumentException(
                    "Platform credential TTL must be between 5 and 120 minutes");
        }
        return value;
    }

    public record IssuedCredential(String token, Instant expiresAt) {
    }
}
