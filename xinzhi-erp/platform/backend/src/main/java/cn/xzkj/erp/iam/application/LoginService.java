package cn.xzkj.erp.iam.application;

import static cn.xzkj.erp.iam.domain.SecurityAuditActions.LOGIN_FAILED;
import static cn.xzkj.erp.iam.domain.SecurityAuditActions.LOGIN_SUCCEEDED;
import static cn.xzkj.erp.iam.domain.SecurityAuditActions.SESSION_REVOKED;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.domain.AccountStatus;
import cn.xzkj.erp.iam.domain.BusinessEmailAddress;
import cn.xzkj.erp.iam.domain.LoginIdentifier;
import cn.xzkj.erp.iam.domain.TenantStatus;
import cn.xzkj.erp.iam.persistence.AuthSessionEntity;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.persistence.TenantEntity;
import cn.xzkj.erp.iam.persistence.TenantRepository;
import cn.xzkj.erp.iam.persistence.UserAccountEntity;
import cn.xzkj.erp.iam.persistence.UserAccountRepository;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import java.time.Clock;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LoginService {
    private cn.xzkj.erp.iam.preparation.NativeCustomerServiceIdentity nativeIdentity;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    public void setNativeIdentity(cn.xzkj.erp.iam.preparation.NativeCustomerServiceIdentity identity){this.nativeIdentity=identity;}

    private final TenantRepository tenantRepository;
    private final UserAccountRepository userRepository;
    private final AuthSessionRepository sessionRepository;
    private final PermissionRepository permissionRepository;
    private final SecurityAuditRecorder auditRecorder;
    private final PasswordHashingService passwordHashingService;
    private final SessionTokenService tokenService;
    private final LoginThrottleService loginThrottleService;
    private final Clock clock;
    private final String dummyPasswordHash;

    public LoginService(
            TenantRepository tenantRepository,
            UserAccountRepository userRepository,
            AuthSessionRepository sessionRepository,
            PermissionRepository permissionRepository,
            SecurityAuditRecorder auditRecorder,
            PasswordHashingService passwordHashingService,
            SessionTokenService tokenService,
            LoginThrottleService loginThrottleService,
            Clock clock) {
        this.tenantRepository = tenantRepository;
        this.userRepository = userRepository;
        this.sessionRepository = sessionRepository;
        this.permissionRepository = permissionRepository;
        this.auditRecorder = auditRecorder;
        this.passwordHashingService = passwordHashingService;
        this.tokenService = tokenService;
        this.loginThrottleService = loginThrottleService;
        this.clock = clock;
        this.dummyPasswordHash =
                passwordHashingService.hashForStorage(UUID.randomUUID().toString().toCharArray());
    }

    @Transactional
    public LoginResult login(LoginCommand command) {
        Optional<TenantEntity> tenantCandidate =
                tenantRepository.findByCode(command.tenantCode());
        if (tenantCandidate.isEmpty()) {
            passwordHashingService.matches(command.password(), dummyPasswordHash);
            throw new InvalidLoginException();
        }

        TenantEntity tenant = tenantCandidate.orElseThrow();
        Optional<UserAccountEntity> userCandidate;
        if (BusinessEmailAddress.isValid(command.username())) {
            userCandidate = userRepository.findByTenant_IdAndEmail(
                    tenant.getId(),
                    BusinessEmailAddress.normalize(command.username()));
        } else {
            String phoneNumber = LoginIdentifier.normalizePhone(
                    command.username());
            userCandidate = phoneNumber == null
                    ? userRepository.findByTenant_IdAndUsername(
                            tenant.getId(),
                            command.username())
                    : userRepository.findByTenant_IdAndPhoneNumber(
                            tenant.getId(),
                            phoneNumber);
        }
        UserAccountEntity user = userCandidate.orElse(null);
        String storedHash = user == null || user.getPasswordHash() == null
                ? dummyPasswordHash
                : user.getPasswordHash();
        Optional<LoginRateLimitedException> currentLock = user == null
                ? Optional.empty()
                : loginThrottleService.currentLock(
                        tenant.getId(),
                        user.getId());
        if(user!=null && nativeIdentity!=null && nativeIdentity.isBound(tenant.getId(),user.getId())) {
            if(currentLock.isPresent())throw currentLock.orElseThrow();
            try {
                var result=nativeIdentity.login(user,command);
                var concurrent=loginThrottleService.clearForSuccessfulLogin(tenant.getId(),user.getId());
                if(concurrent.isPresent())throw concurrent.orElseThrow();
                return result;
            } catch(InvalidLoginException rejected) {
                var decision=loginThrottleService.recordFailure(tenant.getId(),user.getId(),command.requestId());
                recordFailure(tenant.getId(),user.getId(),command);
                if(decision.rateLimited())throw decision.exception();
                throw rejected;
            }
        }
        boolean passwordMatches = passwordHashingService.matches(command.password(), storedHash);

        if (currentLock.isPresent()) {
            recordFailure(tenant.getId(), user.getId(), command);
            throw currentLock.orElseThrow();
        }

        if (tenant.getStatus() != TenantStatus.ACTIVE
                || user == null
                || user.getStatus() != AccountStatus.ACTIVE
                || user.getPasswordHash() == null
                || !passwordMatches) {
            LoginThrottleService.FailureDecision failureDecision =
                    user == null
                            ? null
                            : loginThrottleService.recordFailure(
                                    tenant.getId(),
                                    user.getId(),
                                    command.requestId());
            recordFailure(
                    tenant.getId(),
                    user == null ? null : user.getId(),
                    command);
            if (failureDecision != null
                    && failureDecision.rateLimited()) {
                throw failureDecision.exception();
            }
            throw new InvalidLoginException();
        }

        Optional<LoginRateLimitedException> concurrentLock =
                loginThrottleService.clearForSuccessfulLogin(
                        tenant.getId(),
                        user.getId());
        if (concurrentLock.isPresent()) {
            recordFailure(tenant.getId(), user.getId(), command);
            throw concurrentLock.orElseThrow();
        }

        SessionTokenService.IssuedToken token = tokenService.issue();
        AuthSessionEntity session = new AuthSessionEntity(
                UUID.randomUUID(),
                tenant.getId(),
                user,
                token.hash(),
                token.expiresAt(),
                clock.instant());
        sessionRepository.save(session);
        var permissions = permissionRepository
                .findCodesByTenantIdAndUserId(tenant.getId(), user.getId());

        auditRecorder.recordAtomically(new SecurityAuditEvent(
                tenant.getId(),
                user.getId(),
                LOGIN_SUCCEEDED,
                "auth_session",
                session.getId().toString(),
                command.requestId(),
                command.sourceIp(),
                Map.of()));

        return new LoginResult(
                token.rawValue(),
                token.expiresAt(),
                tenant.getId(),
                tenant.getCode(),
                tenant.getName(),
                user.getId(),
                user.getUsername(),
                user.getEmail(),
                user.getDisplayName(),
                permissions);
    }

    @Transactional
    public void logout(ErpPrincipal principal, String requestId, String sourceIp) {
        if(nativeIdentity!=null)nativeIdentity.clearSession(principal);
        int revokedCount = sessionRepository.revokeScopedSessionIfOpen(
                principal.sessionId(),
                principal.tenantId(),
                principal.userId(),
                clock.instant());
        if (revokedCount == 0) {
            if (!sessionRepository.existsByIdAndTenantIdAndUser_Id(
                    principal.sessionId(),
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
                principal.sessionId().toString(),
                requestId,
                sourceIp,
                Map.of()));
    }

    private void recordFailure(
            UUID tenantId,
            UUID userId,
            LoginCommand command) {
        auditRecorder.record(new SecurityAuditEvent(
                tenantId,
                null,
                LOGIN_FAILED,
                "user",
                userId == null ? "unknown" : userId.toString(),
                command.requestId(),
                command.sourceIp(),
                Map.of("reason", "invalid_credentials_or_status")));
    }
}
