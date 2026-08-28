package ai.xzkj.recruitment.tasks;

import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.jobs.JobPosition;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;

@Entity
@Table(name = "recruitment_tasks")
public class RecruitmentTask {
    @Id private UUID id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "job_position_id", nullable = false)
    private JobPosition jobPosition;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "boss_account_id", nullable = false)
    private BossAccount bossAccount;
    @Column(nullable = false, length = 120) private String name;
    @Enumerated(EnumType.STRING)
    @Column(name = "execution_strategy", nullable = false, length = 24)
    private ExecutionStrategy executionStrategy;
    @Column(name = "daily_quota", nullable = false) private int dailyQuota;
    @Column(name = "window_start", nullable = false) private LocalTime windowStart;
    @Column(name = "window_end", nullable = false) private LocalTime windowEnd;
    @Column(nullable = false, length = 64) private String timezone;
    @Column(name = "require_manual_review", nullable = false) private boolean requireManualReview;
    @Enumerated(EnumType.STRING)
    @Column(name = "mock_outcome", nullable = false, length = 24)
    private MockExecutionOutcome mockOutcome;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24) private RecruitmentTaskStatus status;
    @Column(name = "processed_today", nullable = false) private int processedToday;
    @Column(name = "quota_date") private LocalDate quotaDate;
    @Column(name = "last_run_at") private Instant lastRunAt;
    @Column(name = "last_error", length = 1000) private String lastError;
    @Column(name = "scheduler_enabled", nullable = false) private boolean schedulerEnabled;
    @Column(name = "next_run_at") private Instant nextRunAt;
    @Column(name = "last_scheduled_at") private Instant lastScheduledAt;
    @Column(name = "last_scheduler_owner", length = 120) private String lastSchedulerOwner;
    @Version private long version;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;

    protected RecruitmentTask() {
    }

    public RecruitmentTask(JobPosition jobPosition, BossAccount bossAccount, String name,
                           ExecutionStrategy executionStrategy, int dailyQuota, LocalTime windowStart,
                           LocalTime windowEnd, String timezone, boolean requireManualReview,
                           MockExecutionOutcome mockOutcome) {
        this.id = UUID.randomUUID();
        this.jobPosition = jobPosition;
        this.bossAccount = bossAccount;
        this.name = name;
        this.executionStrategy = executionStrategy;
        this.dailyQuota = dailyQuota;
        this.windowStart = windowStart;
        this.windowEnd = windowEnd;
        this.timezone = timezone;
        this.requireManualReview = requireManualReview;
        this.mockOutcome = mockOutcome;
        this.status = RecruitmentTaskStatus.DRAFT;
        this.schedulerEnabled = true;
        this.createdAt = Instant.now();
        this.updatedAt = this.createdAt;
    }

    public void update(String name, ExecutionStrategy strategy, int dailyQuota, LocalTime windowStart,
                       LocalTime windowEnd, String timezone, boolean requireManualReview,
                       MockExecutionOutcome mockOutcome) {
        this.name = name;
        this.executionStrategy = strategy;
        this.dailyQuota = dailyQuota;
        this.windowStart = windowStart;
        this.windowEnd = windowEnd;
        this.timezone = timezone;
        this.requireManualReview = requireManualReview;
        this.mockOutcome = mockOutcome;
    }

    public void changeStatus(RecruitmentTaskStatus status) {
        this.status = status;
        if (status == RecruitmentTaskStatus.RUNNING) nextRunAt = Instant.now();
        else if (status != RecruitmentTaskStatus.READY) nextRunAt = null;
    }

    public void scheduleNext(Instant scheduledAt, Instant nextRunAt, String owner) {
        this.lastScheduledAt = scheduledAt;
        this.nextRunAt = nextRunAt;
        this.lastSchedulerOwner = owner;
    }

    public void prepareQuota(LocalDate today) {
        if (!today.equals(quotaDate)) {
            quotaDate = today;
            processedToday = 0;
        }
    }

    public void applySuccess(int processedCount, Instant runAt) {
        processedToday += processedCount;
        lastRunAt = runAt;
        lastError = null;
        status = processedToday >= dailyQuota ? RecruitmentTaskStatus.COMPLETED : RecruitmentTaskStatus.RUNNING;
    }

    public void applyFailure(String message, Instant runAt) {
        lastRunAt = runAt;
        lastError = message;
        status = RecruitmentTaskStatus.FAILED;
    }

    public void applyNeedsAttention(String message, Instant runAt) {
        lastRunAt = runAt;
        lastError = message;
        status = RecruitmentTaskStatus.NEEDS_ATTENTION;
    }

    @PreUpdate
    void preUpdate() { updatedAt = Instant.now(); }

    public UUID getId() { return id; }
    public JobPosition getJobPosition() { return jobPosition; }
    public BossAccount getBossAccount() { return bossAccount; }
    public String getName() { return name; }
    public ExecutionStrategy getExecutionStrategy() { return executionStrategy; }
    public int getDailyQuota() { return dailyQuota; }
    public LocalTime getWindowStart() { return windowStart; }
    public LocalTime getWindowEnd() { return windowEnd; }
    public String getTimezone() { return timezone; }
    public boolean isRequireManualReview() { return requireManualReview; }
    public MockExecutionOutcome getMockOutcome() { return mockOutcome; }
    public RecruitmentTaskStatus getStatus() { return status; }
    public int getProcessedToday() { return processedToday; }
    public LocalDate getQuotaDate() { return quotaDate; }
    public Instant getLastRunAt() { return lastRunAt; }
    public String getLastError() { return lastError; }
    public boolean isSchedulerEnabled() { return schedulerEnabled; }
    public Instant getNextRunAt() { return nextRunAt; }
    public Instant getLastScheduledAt() { return lastScheduledAt; }
    public String getLastSchedulerOwner() { return lastSchedulerOwner; }
    public long getVersion() { return version; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
