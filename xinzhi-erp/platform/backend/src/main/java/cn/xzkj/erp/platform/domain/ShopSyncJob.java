package cn.xzkj.erp.platform.domain;

import java.time.Instant;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

@Entity
@Table(name = "shop_sync_jobs")
public class ShopSyncJob extends TenantOwnedEntity {

    private static final Set<SyncJobStatus> QUEUED_TRANSITIONS =
            Set.of(SyncJobStatus.RUNNING, SyncJobStatus.CANCELLED);
    private static final Set<SyncJobStatus> RUNNING_TRANSITIONS =
            Set.of(SyncJobStatus.SUCCEEDED, SyncJobStatus.FAILED, SyncJobStatus.CANCELLED);

    @Column(name = "shop_id", nullable = false, updatable = false)
    private UUID shopId;

    @Enumerated(EnumType.STRING)
    @Column(name = "job_type", nullable = false, length = 32, updatable = false)
    private SyncJobType jobType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private SyncJobStatus status;

    @Column(name = "progress_processed", nullable = false)
    private int progressProcessed;

    @Column(name = "progress_total")
    private Integer progressTotal;

    @Column(name = "attempt_count", nullable = false)
    private int attemptCount;

    @Column(name = "error_code", length = 80)
    private String errorCode;

    @Column(name = "error_summary", length = 1000)
    private String errorSummary;

    @Column(name = "requested_at", nullable = false, updatable = false)
    private Instant requestedAt;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    protected ShopSyncJob() {
    }

    public ShopSyncJob(UUID tenantId, UUID shopId, SyncJobType jobType) {
        super(tenantId);
        this.shopId = shopId;
        this.jobType = jobType;
        this.status = SyncJobStatus.QUEUED;
        this.requestedAt = Instant.now();
    }

    public void transition(
            SyncJobStatus nextStatus,
            int progressProcessed,
            Integer progressTotal,
            String errorCode,
            String errorSummary
    ) {
        validateProgress(progressProcessed, progressTotal);
        if (status.isTerminal()) {
            replayTerminalState(nextStatus, progressProcessed, progressTotal, errorCode, errorSummary);
            return;
        }
        if (status == SyncJobStatus.QUEUED) {
            transitionFromQueued(nextStatus, progressProcessed, progressTotal, errorCode, errorSummary);
            return;
        }
        transitionFromRunning(nextStatus, progressProcessed, progressTotal, errorCode, errorSummary);
    }

    private void transitionFromQueued(
            SyncJobStatus nextStatus,
            int nextProgressProcessed,
            Integer nextProgressTotal,
            String nextErrorCode,
            String nextErrorSummary
    ) {
        if (nextStatus == SyncJobStatus.QUEUED) {
            requireExactState(nextStatus, nextProgressProcessed, nextProgressTotal, nextErrorCode, nextErrorSummary);
            return;
        }
        if (!QUEUED_TRANSITIONS.contains(nextStatus)) {
            throw invalidTransition(nextStatus);
        }
        requireNoError(nextErrorCode, nextErrorSummary);
        progressProcessed = nextProgressProcessed;
        progressTotal = nextProgressTotal;
        status = nextStatus;
        if (nextStatus == SyncJobStatus.RUNNING) {
            startedAt = Instant.now();
            attemptCount++;
        } else {
            completedAt = Instant.now();
        }
    }

    private void transitionFromRunning(
            SyncJobStatus nextStatus,
            int nextProgressProcessed,
            Integer nextProgressTotal,
            String nextErrorCode,
            String nextErrorSummary
    ) {
        ensureMonotonicProgress(nextProgressProcessed, nextProgressTotal);
        if (nextStatus == SyncJobStatus.RUNNING) {
            requireNoError(nextErrorCode, nextErrorSummary);
            progressProcessed = nextProgressProcessed;
            progressTotal = nextProgressTotal;
            return;
        }
        if (!RUNNING_TRANSITIONS.contains(nextStatus)) {
            throw invalidTransition(nextStatus);
        }
        if (nextStatus == SyncJobStatus.FAILED) {
            if (nextErrorSummary == null || nextErrorSummary.isBlank()) {
                throw new IllegalArgumentException("Failed sync jobs require an error summary");
            }
            errorCode = nextErrorCode;
            errorSummary = nextErrorSummary;
        } else {
            requireNoError(nextErrorCode, nextErrorSummary);
        }
        progressProcessed = nextProgressProcessed;
        progressTotal = nextProgressTotal;
        status = nextStatus;
        completedAt = Instant.now();
    }

    private void replayTerminalState(
            SyncJobStatus nextStatus,
            int nextProgressProcessed,
            Integer nextProgressTotal,
            String nextErrorCode,
            String nextErrorSummary
    ) {
        if (nextStatus != status) {
            throw invalidTransition(nextStatus);
        }
        requireExactState(nextStatus, nextProgressProcessed, nextProgressTotal, nextErrorCode, nextErrorSummary);
    }

    private void requireExactState(
            SyncJobStatus nextStatus,
            int nextProgressProcessed,
            Integer nextProgressTotal,
            String nextErrorCode,
            String nextErrorSummary
    ) {
        String expectedErrorCode = nextStatus == SyncJobStatus.FAILED ? errorCode : null;
        String expectedErrorSummary = nextStatus == SyncJobStatus.FAILED ? errorSummary : null;
        if (nextProgressProcessed != progressProcessed
                || !Objects.equals(nextProgressTotal, progressTotal)
                || !Objects.equals(nextErrorCode, expectedErrorCode)
                || !Objects.equals(nextErrorSummary, expectedErrorSummary)) {
            throw new IllegalArgumentException("Idempotent sync job replay must match the persisted state");
        }
    }

    private void ensureMonotonicProgress(int nextProgressProcessed, Integer nextProgressTotal) {
        if (nextProgressProcessed < progressProcessed) {
            throw new IllegalArgumentException("Sync progress cannot decrease");
        }
        if (progressTotal != null && !Objects.equals(progressTotal, nextProgressTotal)) {
            throw new IllegalArgumentException("Sync progress total cannot change after it is set");
        }
    }

    private static void validateProgress(int nextProgressProcessed, Integer nextProgressTotal) {
        if (nextProgressProcessed < 0 || nextProgressTotal != null
                && (nextProgressTotal < 0 || nextProgressProcessed > nextProgressTotal)) {
            throw new IllegalArgumentException("Sync progress is invalid");
        }
    }

    private static void requireNoError(String nextErrorCode, String nextErrorSummary) {
        if (nextErrorCode != null || nextErrorSummary != null) {
            throw new IllegalArgumentException("Only failed sync jobs may include error details");
        }
    }

    private IllegalStateException invalidTransition(SyncJobStatus nextStatus) {
        return new IllegalStateException("Sync job transition is not allowed: " + status + " -> " + nextStatus);
    }

    public UUID getShopId() {
        return shopId;
    }

    public SyncJobType getJobType() {
        return jobType;
    }

    public SyncJobStatus getStatus() {
        return status;
    }

    public int getProgressProcessed() {
        return progressProcessed;
    }

    public Integer getProgressTotal() {
        return progressTotal;
    }

    public int getAttemptCount() {
        return attemptCount;
    }

    public String getErrorCode() {
        return errorCode;
    }

    public String getErrorSummary() {
        return errorSummary;
    }

    public Instant getRequestedAt() {
        return requestedAt;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public Instant getCompletedAt() {
        return completedAt;
    }
}
