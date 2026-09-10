package cn.xzkj.erp.iam.application;

import static cn.xzkj.erp.iam.domain.SecurityAuditActions.LOGIN_THROTTLED;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.persistence.LoginThrottleStore;
import cn.xzkj.erp.iam.persistence.LoginThrottleStore.LockedState;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LoginThrottleService {

    private final LoginThrottleStore store;
    private final LoginThrottleProperties properties;
    private final SecurityAuditRecorder auditRecorder;

    public LoginThrottleService(
            LoginThrottleStore store,
            LoginThrottleProperties properties,
            SecurityAuditRecorder auditRecorder) {
        this.store = store;
        this.properties = properties;
        this.auditRecorder = auditRecorder;
    }

    public Optional<LoginRateLimitedException> currentLock(
            UUID tenantId,
            UUID userId) {
        return store.findActiveLock(tenantId, userId)
                .map(this::rateLimited);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public FailureDecision recordFailure(
            UUID tenantId,
            UUID userId,
            String requestId) {
        Instant now = store.databaseNow();
        store.createEmptyIfMissing(tenantId, userId, now);
        LockedState state = store.lockState(tenantId, userId)
                .orElseThrow(IllegalStateException::new);
        now = store.databaseNow();

        if (isActiveLock(state, now)) {
            return FailureDecision.rateLimited(
                    rateLimited(state.lockedUntil()));
        }

        boolean resetWindow = state.lockedUntil() != null
                || !now.isBefore(state.windowStartedAt()
                        .plus(properties.getWindow()));
        int failedCount = resetWindow ? 1 : state.failedCount() + 1;
        Instant windowStartedAt =
                resetWindow ? now : state.windowStartedAt();
        Instant lockedUntil = failedCount >= properties.getMaxFailures()
                ? now.plus(properties.getLockDuration())
                : null;
        store.update(
                tenantId,
                userId,
                failedCount,
                windowStartedAt,
                lockedUntil,
                now);

        if (lockedUntil == null) {
            return FailureDecision.notLimited();
        }

        auditRecorder.recordAtomically(new SecurityAuditEvent(
                tenantId,
                null,
                LOGIN_THROTTLED,
                "user",
                userId.toString(),
                requestId,
                null,
                Map.of(
                        "maxFailures",
                        Integer.toString(properties.getMaxFailures()),
                        "windowSeconds",
                        Long.toString(properties.getWindow().toSeconds()),
                        "lockDurationSeconds",
                        Long.toString(properties.getLockDuration().toSeconds()))));
        return FailureDecision.rateLimited(rateLimited(lockedUntil));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public Optional<LoginRateLimitedException> clearForSuccessfulLogin(
            UUID tenantId,
            UUID userId) {
        Instant now = store.databaseNow();
        Optional<LockedState> state = store.lockState(tenantId, userId);
        if (state.isEmpty()) {
            return Optional.empty();
        }
        if (isActiveLock(state.orElseThrow(), now)) {
            return Optional.of(rateLimited(
                    state.orElseThrow().lockedUntil()));
        }
        store.delete(tenantId, userId);
        return Optional.empty();
    }

    private boolean isActiveLock(LockedState state, Instant now) {
        return state.lockedUntil() != null
                && state.lockedUntil().isAfter(now);
    }

    private LoginRateLimitedException rateLimited(Instant lockedUntil) {
        Instant now = store.databaseNow();
        long remainingMillis = Math.max(
                1,
                Duration.between(now, lockedUntil).toMillis());
        long retryAfter = Math.max(1, (remainingMillis + 999) / 1000);
        long maximum = properties.getLockDuration().toSeconds();
        return new LoginRateLimitedException(Math.min(retryAfter, maximum));
    }

    public record FailureDecision(
            boolean rateLimited,
            LoginRateLimitedException exception) {

        static FailureDecision notLimited() {
            return new FailureDecision(false, null);
        }

        static FailureDecision rateLimited(
                LoginRateLimitedException exception) {
            return new FailureDecision(true, exception);
        }
    }
}
