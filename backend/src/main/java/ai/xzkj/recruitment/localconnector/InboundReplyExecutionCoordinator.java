package ai.xzkj.recruitment.localconnector;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;

/** 进程内执行协调：同账号使用有界并发，不同账号共享全局 AI 并发。 */
final class InboundReplyExecutionCoordinator {
    private final ConcurrentHashMap<UUID, Integer> activeAccountWorkers = new ConcurrentHashMap<>();
    private final Semaphore modelSlots;
    private final int modelConcurrency;
    private final int perAccountConcurrency;

    InboundReplyExecutionCoordinator(int configuredModelConcurrency) {
        this(configuredModelConcurrency, 1);
    }

    InboundReplyExecutionCoordinator(int configuredModelConcurrency, int configuredPerAccountConcurrency) {
        modelConcurrency = Math.max(1, Math.min(configuredModelConcurrency, 64));
        perAccountConcurrency = Math.max(1, Math.min(configuredPerAccountConcurrency, modelConcurrency));
        modelSlots = new Semaphore(modelConcurrency, true);
    }

    boolean tryEnterAccount(UUID accountId) {
        AtomicBoolean entered = new AtomicBoolean();
        activeAccountWorkers.compute(accountId, (_key, active) -> {
            int current = active == null ? 0 : active;
            if (current >= perAccountConcurrency) return current;
            entered.set(true);
            return current + 1;
        });
        return entered.get();
    }

    void leaveAccount(UUID accountId) {
        activeAccountWorkers.computeIfPresent(accountId, (_key, active) -> active <= 1 ? null : active - 1);
    }

    void acquireModelSlot() throws InterruptedException {
        modelSlots.acquire();
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

    int perAccountConcurrency() {
        return perAccountConcurrency;
    }
}
