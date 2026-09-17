package ai.xzkj.recruitment.localconnector;

import org.junit.jupiter.api.Test;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class InboundReplyExecutionCoordinatorTest {
    @Test
    void boundsConfiguredModelConcurrency() {
        assertThat(new InboundReplyExecutionCoordinator(0).modelConcurrency()).isEqualTo(1);
        assertThat(new InboundReplyExecutionCoordinator(8).modelConcurrency()).isEqualTo(8);
        assertThat(new InboundReplyExecutionCoordinator(1000).modelConcurrency()).isEqualTo(64);
    }

    @Test
    void serializesOneAccountButAllowsDifferentAccounts() {
        InboundReplyExecutionCoordinator coordinator = new InboundReplyExecutionCoordinator(2);
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();

        assertThat(coordinator.tryEnterAccount(first)).isTrue();
        assertThat(coordinator.tryEnterAccount(first)).isFalse();
        assertThat(coordinator.tryEnterAccount(second)).isTrue();
        coordinator.leaveAccount(first);
        assertThat(coordinator.tryEnterAccount(first)).isTrue();
        coordinator.leaveAccount(first);
        coordinator.leaveAccount(second);
    }

    @Test
    void allowsThreeWorkersForOneAccountAndRejectsTheFourth() {
        InboundReplyExecutionCoordinator coordinator = new InboundReplyExecutionCoordinator(8, 3);
        UUID account = UUID.randomUUID();

        assertThat(coordinator.perAccountConcurrency()).isEqualTo(3);
        assertThat(coordinator.tryEnterAccount(account)).isTrue();
        assertThat(coordinator.tryEnterAccount(account)).isTrue();
        assertThat(coordinator.tryEnterAccount(account)).isTrue();
        assertThat(coordinator.tryEnterAccount(account)).isFalse();
        coordinator.leaveAccount(account);
        assertThat(coordinator.tryEnterAccount(account)).isTrue();
        coordinator.leaveAccount(account);
        coordinator.leaveAccount(account);
        coordinator.leaveAccount(account);
    }

    @Test
    void blocksOnlyAtConfiguredGlobalModelCapacity() throws Exception {
        InboundReplyExecutionCoordinator coordinator = new InboundReplyExecutionCoordinator(2);
        coordinator.acquireModelSlot();
        coordinator.acquireModelSlot();
        CountDownLatch entered = new CountDownLatch(1);
        Thread waiting = Thread.startVirtualThread(() -> {
            try {
                coordinator.acquireModelSlot();
                entered.countDown();
                coordinator.releaseModelSlot();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        });

        assertThat(entered.await(50, TimeUnit.MILLISECONDS)).isFalse();
        coordinator.releaseModelSlot();
        assertThat(entered.await(1, TimeUnit.SECONDS)).isTrue();
        coordinator.releaseModelSlot();
        waiting.join();
        assertThat(coordinator.availableModelSlots()).isEqualTo(2);
    }

    @Test
    void keepsFiveHundredAccountsWithinGlobalCapacity() throws Exception {
        int tasks = 500;
        InboundReplyExecutionCoordinator coordinator = new InboundReplyExecutionCoordinator(8);
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch finished = new CountDownLatch(tasks);
        AtomicInteger active = new AtomicInteger();
        AtomicInteger peak = new AtomicInteger();
        AtomicInteger failures = new AtomicInteger();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int index = 0; index < tasks; index++) executor.submit(() -> {
                UUID accountId = UUID.randomUUID();
                boolean accountEntered = false;
                boolean slotAcquired = false;
                try {
                    start.await();
                    accountEntered = coordinator.tryEnterAccount(accountId);
                    if (!accountEntered) { failures.incrementAndGet(); return; }
                    coordinator.acquireModelSlot();
                    slotAcquired = true;
                    int current = active.incrementAndGet();
                    peak.accumulateAndGet(current, Math::max);
                    Thread.sleep(2);
                    active.decrementAndGet();
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    failures.incrementAndGet();
                } finally {
                    if (slotAcquired) coordinator.releaseModelSlot();
                    if (accountEntered) coordinator.leaveAccount(accountId);
                    finished.countDown();
                }
            });
            start.countDown();
            assertThat(finished.await(10, TimeUnit.SECONDS)).isTrue();
        }
        assertThat(failures.get()).isZero();
        assertThat(peak.get()).isEqualTo(8);
        assertThat(coordinator.availableModelSlots()).isEqualTo(8);
    }
}
