package cn.xzkj.erp.platformadmin.application;

import static cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditActions.LOGIN_THROTTLED;

import cn.xzkj.erp.iam.application.LoginRateLimitedException;
import cn.xzkj.erp.iam.application.LoginThrottleProperties;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditEvent;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditRecorder;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminLoginThrottleStore;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminLoginThrottleStore.LockedState;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PlatformAdminLoginThrottleService {

    private final PlatformAdminLoginThrottleStore store;
    private final LoginThrottleProperties properties;
    private final PlatformAdminAuditRecorder auditRecorder;

    public PlatformAdminLoginThrottleService(
            PlatformAdminLoginThrottleStore store,
            LoginThrottleProperties properties,
            PlatformAdminAuditRecorder auditRecorder) {
        this.store = store;
        this.properties = properties;
        this.auditRecorder = auditRecorder;
    }

    public Optional<LoginRateLimitedException> currentLock(UUID adminId) {
        return store.findActiveLock(adminId).map(this::rateLimited);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public FailureDecision recordFailure(UUID adminId, String requestId) {
        Instant now = store.databaseNow();
        store.createEmptyIfMissing(adminId, now);
        LockedState state = store.lockState(adminId)
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
                adminId,
                failedCount,
                windowStartedAt,
                lockedUntil,
                now);
        if (lockedUntil == null) {
            return FailureDecision.notLimited();
        }
        auditRecorder.recordAtomically(new PlatformAdminAuditEvent(
                null,
                null,
                LOGIN_THROTTLED,
                "system_admin",
                adminId.toString(),
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
    public void clearForVerifiedLogin(UUID adminId) {
        store.delete(adminId);
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
        return new LoginRateLimitedException(Math.min(
                retryAfter,
                properties.getLockDuration().toSeconds()));
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
