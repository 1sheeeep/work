package cn.xzkj.erp.platform.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

import java.util.UUID;

import org.junit.jupiter.api.Test;

class ShopSyncJobTest {

    @Test
    void followsExplicitLifecycleAndTracksAttempts() {
        ShopSyncJob job = new ShopSyncJob(UUID.randomUUID(), UUID.randomUUID(), SyncJobType.ORDERS);

        job.transition(SyncJobStatus.RUNNING, 0, 10, null, null);
        job.transition(SyncJobStatus.RUNNING, 5, 10, null, null);
        job.transition(SyncJobStatus.SUCCEEDED, 10, 10, null, null);
        job.transition(SyncJobStatus.SUCCEEDED, 10, 10, null, null);

        assertThat(job.getStatus()).isEqualTo(SyncJobStatus.SUCCEEDED);
        assertThat(job.getAttemptCount()).isEqualTo(1);
        assertThat(job.getProgressProcessed()).isEqualTo(10);
        assertThat(job.getStartedAt()).isNotNull();
        assertThat(job.getCompletedAt()).isNotNull();
    }

    @Test
    void rejectsTerminalTransitionsAndFailedJobsWithoutSummary() {
        ShopSyncJob completed = new ShopSyncJob(
                UUID.randomUUID(),
                UUID.randomUUID(),
                SyncJobType.FULL
        );
        completed.transition(SyncJobStatus.CANCELLED, 0, null, null, null);

        assertThatIllegalStateException()
                .isThrownBy(() -> completed.transition(
                        SyncJobStatus.RUNNING,
                        0,
                        null,
                        null,
                        null
                ));

        ShopSyncJob running = new ShopSyncJob(
                UUID.randomUUID(),
                UUID.randomUUID(),
                SyncJobType.FULL
        );
        running.transition(SyncJobStatus.RUNNING, 0, null, null, null);

        assertThatIllegalArgumentException()
                .isThrownBy(() -> running.transition(
                        SyncJobStatus.FAILED,
                        0,
                        null,
                        "REMOTE_ERROR",
                        null
                ));
    }

    @Test
    void rejectsInvalidProgress() {
        ShopSyncJob job = new ShopSyncJob(UUID.randomUUID(), UUID.randomUUID(), SyncJobType.PRODUCTS);

        assertThatIllegalArgumentException()
                .isThrownBy(() -> job.transition(
                        SyncJobStatus.RUNNING,
                        11,
                        10,
                        null,
                        null
                ));
    }

    @Test
    void runningProgressIsMonotonicAndCannotChangeItsKnownTotal() {
        ShopSyncJob job = new ShopSyncJob(UUID.randomUUID(), UUID.randomUUID(), SyncJobType.PRODUCTS);
        job.transition(SyncJobStatus.RUNNING, 5, 10, null, null);

        assertThatIllegalArgumentException()
                .isThrownBy(() -> job.transition(SyncJobStatus.RUNNING, 4, 10, null, null));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> job.transition(SyncJobStatus.RUNNING, 6, 12, null, null));
    }

    @Test
    void terminalReplayCannotChangeProgressOrErrorDetails() {
        ShopSyncJob job = new ShopSyncJob(UUID.randomUUID(), UUID.randomUUID(), SyncJobType.ORDERS);
        job.transition(SyncJobStatus.RUNNING, 5, 10, null, null);
        job.transition(SyncJobStatus.FAILED, 5, 10, "REMOTE_ERROR", "remote failed");

        assertThatIllegalArgumentException()
                .isThrownBy(() -> job.transition(
                        SyncJobStatus.FAILED,
                        6,
                        10,
                        "REMOTE_ERROR",
                        "remote failed"
                ));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> job.transition(
                        SyncJobStatus.FAILED,
                        5,
                        10,
                        "CHANGED",
                        "remote failed"
                ));
    }
}
