package ai.xzkj.recruitment.tasks;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "recruitment_task_executions")
public class RecruitmentTaskExecution {
    @Id private UUID id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "task_id", nullable = false)
    private RecruitmentTask task;
    @Column(name = "idempotency_key", nullable = false, length = 100) private String idempotencyKey;
    @Column(name = "attempt_number", nullable = false) private int attemptNumber;
    @Column(name = "requested_count", nullable = false) private int requestedCount;
    @Column(name = "processed_count", nullable = false) private int processedCount;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24) private TaskExecutionStatus status;
    @Column(length = 1000) private String message;
    @Column(name = "started_at", nullable = false) private Instant startedAt;
    @Column(name = "completed_at") private Instant completedAt;

    protected RecruitmentTaskExecution() {
    }

    public RecruitmentTaskExecution(RecruitmentTask task, String idempotencyKey, int attemptNumber,
                                    int requestedCount, int processedCount, TaskExecutionStatus status,
                                    String message, Instant startedAt, Instant completedAt) {
        this.id = UUID.randomUUID();
        this.task = task;
        this.idempotencyKey = idempotencyKey;
        this.attemptNumber = attemptNumber;
        this.requestedCount = requestedCount;
        this.processedCount = processedCount;
        this.status = status;
        this.message = message;
        this.startedAt = startedAt;
        this.completedAt = completedAt;
    }

    public UUID getId() { return id; }
    public RecruitmentTask getTask() { return task; }
    public String getIdempotencyKey() { return idempotencyKey; }
    public int getAttemptNumber() { return attemptNumber; }
    public int getRequestedCount() { return requestedCount; }
    public int getProcessedCount() { return processedCount; }
    public TaskExecutionStatus getStatus() { return status; }
    public String getMessage() { return message; }
    public Instant getStartedAt() { return startedAt; }
    public Instant getCompletedAt() { return completedAt; }
}
