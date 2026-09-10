package cn.xzkj.erp.iam.application;

import static cn.xzkj.erp.iam.domain.SecurityAuditActions.PASSWORD_CREDENTIAL_ISSUED;
import static cn.xzkj.erp.iam.domain.SecurityAuditActions.PASSWORD_CREDENTIAL_REVOKED;
import static cn.xzkj.erp.iam.domain.SecurityAuditActions.USER_ACTIVATED;
import static cn.xzkj.erp.iam.domain.SecurityAuditActions.USER_PASSWORD_RESET;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.domain.AccountStatus;
import cn.xzkj.erp.iam.domain.PasswordCredentialPurpose;
import cn.xzkj.erp.iam.domain.TenantStatus;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.PasswordCredentialEntity;
import cn.xzkj.erp.iam.persistence.PasswordCredentialRepository;
import cn.xzkj.erp.iam.persistence.UserAccountEntity;
import cn.xzkj.erp.iam.persistence.UserAccountRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PasswordCredentialService {
    private cn.xzkj.erp.iam.preparation.NativeCustomerServiceIdentity nativeIdentity;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    public void setNativeIdentity(cn.xzkj.erp.iam.preparation.NativeCustomerServiceIdentity identity){this.nativeIdentity=identity;}

    public static final int MINIMUM_TTL_MINUTES = 5;
    public static final int MAXIMUM_TTL_MINUTES = 120;
    public static final int MAX_PAGE_SIZE = 100;
    public static final int MAX_PAGE_NUMBER = 1_000_000;

    private final UserAccountRepository userRepository;
    private final PasswordCredentialRepository credentialRepository;
    private final AuthSessionRepository sessionRepository;
    private final PasswordCredentialTokenService tokenService;
    private final PasswordHashingService passwordHashingService;
    private final SecurityAuditRecorder auditRecorder;
    private final Clock clock;
    private final Duration defaultTtl;

    public PasswordCredentialService(
            UserAccountRepository userRepository,
            PasswordCredentialRepository credentialRepository,
            AuthSessionRepository sessionRepository,
            PasswordCredentialTokenService tokenService,
            PasswordHashingService passwordHashingService,
            SecurityAuditRecorder auditRecorder,
            Clock clock,
            @Value("${erp.security.password-credential-ttl:PT30M}")
            Duration defaultTtl) {
        this.userRepository = userRepository;
        this.credentialRepository = credentialRepository;
        this.sessionRepository = sessionRepository;
        this.tokenService = tokenService;
        this.passwordHashingService = passwordHashingService;
        this.auditRecorder = auditRecorder;
        this.clock = clock;
        this.defaultTtl = requireBoundedTtl(defaultTtl);
    }

    @Transactional
    public IssuedCredential issue(
            IamActor actor,
            UUID userId,
            PasswordCredentialPurpose purpose,
            Integer expiresInMinutes) {
        if (userId.equals(actor.userId())) {
            throw new SelfServiceNotAllowedException();
        }
        UserAccountEntity user = requireUser(actor.tenantId(), userId);
        if(nativeIdentity!=null)nativeIdentity.requireLocalPasswordAllowed(actor.tenantId(),userId);
        if (purpose == PasswordCredentialPurpose.ACTIVATION
                && user.getStatus() != AccountStatus.DISABLED) {
            throw new IamConflictException();
        }
        Instant now = clock.instant();
        Duration ttl = expiresInMinutes == null
                ? defaultTtl
                : requireBoundedTtl(Duration.ofMinutes(expiresInMinutes));
        credentialRepository.revokeOpenForPurpose(
                actor.tenantId(),
                userId,
                purpose,
                now);
        PasswordCredentialTokenService.GeneratedToken token = tokenService.generate();
        PasswordCredentialEntity credential = new PasswordCredentialEntity(
                UUID.randomUUID(),
                actor.tenantId(),
                user,
                purpose,
                token.tokenHash(),
                now.plus(ttl),
                actor.userId(),
                actor.systemAdminId(),
                now);
        try {
            credentialRepository.saveAndFlush(credential);
        } catch (DataIntegrityViolationException concurrentIssuance) {
            throw new IamConflictException();
        }
        audit(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                PASSWORD_CREDENTIAL_ISSUED,
                userId,
                actor.requestId(),
                actor.sourceIp(),
                purpose);
        return new IssuedCredential(
                credential.getId(),
                purpose,
                token.rawToken(),
                credential.getExpiresAt());
    }

    @Transactional(readOnly = true)
    public PageResult<CredentialMetadataView> listMetadata(
            UUID tenantId,
            UUID userId,
            int page,
            int size) {
        validatePage(page, size);
        requireUser(tenantId, userId);
        var result = credentialRepository.findAllByTenantIdAndUser_Id(
                tenantId,
                userId,
                PageRequest.of(
                        page,
                        size,
                        Sort.by("createdAt")
                                .descending()
                                .and(Sort.by("id").descending())));
        Instant now = clock.instant();
        return PageResult.of(
                result.getContent().stream()
                        .map(credential -> CredentialMetadataView.from(
                                credential,
                                now))
                        .toList(),
                page,
                size,
                result.getTotalElements());
    }

    @Transactional
    public void revoke(
            IamActor actor,
            UUID userId,
            UUID credentialId) {
        requireUser(actor.tenantId(), userId);
        PasswordCredentialEntity credential = credentialRepository
                .findByIdAndTenantIdAndUser_Id(
                        credentialId,
                        actor.tenantId(),
                        userId)
                .orElseThrow(IamNotFoundException::new);
        if (credential.getConsumedAt() != null || credential.getRevokedAt() != null) {
            return;
        }
        credential.revoke(clock.instant());
        credentialRepository.saveAndFlush(credential);
        audit(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                PASSWORD_CREDENTIAL_REVOKED,
                userId,
                actor.requestId(),
                actor.sourceIp(),
                credential.getPurpose());
    }

    @Transactional
    public void redeem(
            char[] rawToken,
            char[] newPassword,
            String requestId,
            String sourceIp) {
        String tokenHash = tokenService.hashPresented(rawToken);
        try {
            PasswordCredentialEntity credential = credentialRepository
                    .findByTokenHashForUpdate(tokenHash)
                    .orElseThrow(InvalidPasswordCredentialException::new);
            Instant now = clock.instant();
            UserAccountEntity user = credential.getUser();
            if(nativeIdentity!=null && nativeIdentity.isBound(user.getTenant().getId(),user.getId()))throw new InvalidPasswordCredentialException();
            if (!credential.isUsableAt(now)
                    || user.getTenant().getStatus() != TenantStatus.ACTIVE
                    || !statusAllowsRedemption(
                            credential.getPurpose(),
                            user.getStatus())) {
                throw new InvalidPasswordCredentialException();
            }

            String passwordHash;
            try {
                passwordHash =
                        passwordHashingService.hashForStorage(newPassword);
            } catch (IllegalArgumentException invalidPassword) {
                throw new IamValidationException();
            }
            AccountStatus resultingStatus =
                    credential.getPurpose()
                                    == PasswordCredentialPurpose.ACTIVATION
                            ? AccountStatus.ACTIVE
                            : user.getStatus();
            user.initializePassword(passwordHash, resultingStatus, now);
            userRepository.saveAndFlush(user);
            credential.consume(now);
            credentialRepository.saveAndFlush(credential);
            credentialRepository.revokeOtherOpenForUser(
                    credential.getTenantId(),
                    user.getId(),
                    credential.getId(),
                    now);
            sessionRepository.revokeActiveForUser(
                    credential.getTenantId(),
                    user.getId(),
                    now);
            audit(
                    credential.getTenantId(),
                    null,
                    null,
                    credential.getPurpose()
                                    == PasswordCredentialPurpose.ACTIVATION
                            ? USER_ACTIVATED
                            : USER_PASSWORD_RESET,
                    user.getId(),
                    requestId,
                    sourceIp,
                    credential.getPurpose());
        } finally {
            if (newPassword != null) {
                Arrays.fill(newPassword, '\0');
            }
        }
    }

    private UserAccountEntity requireUser(UUID tenantId, UUID userId) {
        return userRepository.findByIdAndTenant_Id(userId, tenantId)
                .orElseThrow(IamNotFoundException::new);
    }

    private static boolean statusAllowsRedemption(
            PasswordCredentialPurpose purpose,
            AccountStatus status) {
        if (purpose == PasswordCredentialPurpose.ACTIVATION) {
            return status == AccountStatus.DISABLED;
        }
        return status == AccountStatus.ACTIVE || status == AccountStatus.DISABLED;
    }

    private static Duration requireBoundedTtl(Duration ttl) {
        if (ttl == null
                || ttl.compareTo(Duration.ofMinutes(MINIMUM_TTL_MINUTES)) < 0
                || ttl.compareTo(Duration.ofMinutes(MAXIMUM_TTL_MINUTES)) > 0) {
            throw new IllegalArgumentException(
                    "Password credential TTL must be between 5 and 120 minutes");
        }
        return ttl;
    }

    private static void validatePage(int page, int size) {
        if (page < 0
                || page > MAX_PAGE_NUMBER
                || size < 1
                || size > MAX_PAGE_SIZE) {
            throw new IamValidationException();
        }
    }

    private void audit(
            UUID tenantId,
            UUID actorUserId,
            UUID actorSystemAdminId,
            String action,
            UUID userId,
            String requestId,
            String sourceIp,
            PasswordCredentialPurpose purpose) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                tenantId,
                actorUserId,
                actorSystemAdminId,
                action,
                "user",
                userId.toString(),
                requestId,
                sourceIp,
                Map.of("purpose", purpose.name())));
    }

    public record IssuedCredential(
            UUID id,
            PasswordCredentialPurpose purpose,
            String token,
            Instant expiresAt) {
    }

    public record CredentialMetadataView(
            UUID id,
            PasswordCredentialPurpose purpose,
            CredentialStatus status,
            Instant expiresAt,
            Instant createdAt,
            Instant consumedAt,
            Instant revokedAt) {

        static CredentialMetadataView from(
                PasswordCredentialEntity credential,
                Instant now) {
            return new CredentialMetadataView(
                    credential.getId(),
                    credential.getPurpose(),
                    CredentialStatus.from(credential, now),
                    credential.getExpiresAt(),
                    credential.getCreatedAt(),
                    credential.getConsumedAt(),
                    credential.getRevokedAt());
        }
    }

    public enum CredentialStatus {
        ACTIVE,
        EXPIRED,
        CONSUMED,
        REVOKED;

        static CredentialStatus from(
                PasswordCredentialEntity credential,
                Instant now) {
            if (credential.getConsumedAt() != null) {
                return CONSUMED;
            }
            if (credential.getRevokedAt() != null) {
                return REVOKED;
            }
            if (!credential.getExpiresAt().isAfter(now)) {
                return EXPIRED;
            }
            return ACTIVE;
        }
    }
}
