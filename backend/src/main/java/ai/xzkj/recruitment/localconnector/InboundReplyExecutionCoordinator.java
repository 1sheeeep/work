package ai.xzkj.recruitment.localconnector;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.time.Duration;

/** 进程内执行协调：同账号只允许一个 drain，不同账号共享有界 AI 并发。 */
final class InboundReplyExecutionCoordinator {
    private final Set<UUID> activeAccounts = ConcurrentHashMap.newKeySet();
    private final Semaphore modelSlots;
    private final int modelConcurrency;

    InboundReplyExecutionCoordinator(int configuredModelConcurrency) {
        modelConcurrency = Math.max(1, Math.min(configuredModelConcurrency, 64));
        modelSlots = new Semaphore(modelConcurrency, true);
    }

    boolean tryEnterAccount(UUID accountId) {
        return activeAccounts.add(accountId);
    }

    void leaveAccount(UUID accountId) {
        activeAccounts.remove(accountId);
    }

    void acquireModelSlot() throws InterruptedException {
        modelSlots.acquire();
    }

    boolean tryAcquireModelSlot(Duration timeout) throws InterruptedException {
        Duration safe = timeout == null || timeout.isNegative() ? Duration.ZERO : timeout;
        return modelSlots.tryAcquire(safe.toNanos(), TimeUnit.NANOSECONDS);
    }

    void releaseModelSlot() {
        modelSlots.release();
    }

    int availableModelSlots() {
        return modelSlots.availablePermits();
    }

    int modelConcurrency() {
        return modelConcurrency;
    }
}
