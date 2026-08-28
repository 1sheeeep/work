package ai.xzkj.recruitment.tasks;

import java.time.Instant;
import java.util.UUID;

public record TaskExecutionResponse(
        UUID id,
        String idempotencyKey,
        int attemptNumber,
        int requestedCount,
        int processedCount,
        TaskExecutionStatus status,
        String message,
        Instant startedAt,
        Instant completedAt
) {
    public static TaskExecutionResponse from(RecruitmentTaskExecution execution) {
        return new TaskExecutionResponse(execution.getId(), execution.getIdempotencyKey(),
                execution.getAttemptNumber(), execution.getRequestedCount(), execution.getProcessedCount(),
                execution.getStatus(), execution.getMessage(), execution.getStartedAt(), execution.getCompletedAt());
    }
}
