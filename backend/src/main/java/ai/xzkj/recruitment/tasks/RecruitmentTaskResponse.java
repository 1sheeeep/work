package ai.xzkj.recruitment.tasks;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;

public record RecruitmentTaskResponse(
        UUID id,
        JobSummary jobPosition,
        BossSummary bossAccount,
        String name,
        ExecutionStrategy executionStrategy,
        int dailyQuota,
        LocalTime windowStart,
        LocalTime windowEnd,
        String timezone,
        boolean requireManualReview,
        MockExecutionOutcome mockOutcome,
        RecruitmentTaskStatus status,
        int processedToday,
        LocalDate quotaDate,
        Instant lastRunAt,
        String lastError,
        long version,
        Instant createdAt,
        Instant updatedAt
) {
    public static RecruitmentTaskResponse from(RecruitmentTask task) {
        var job = task.getJobPosition();
        var company = job.getCompany();
        var account = task.getBossAccount();
        return new RecruitmentTaskResponse(task.getId(),
                new JobSummary(job.getId(), job.getTitle(), company.getId(), company.getName(), company.getCode()),
                new BossSummary(account.getId(), account.getDisplayName(), account.getExternalIdentifier()),
                task.getName(), task.getExecutionStrategy(), task.getDailyQuota(), task.getWindowStart(),
                task.getWindowEnd(), task.getTimezone(), task.isRequireManualReview(), task.getMockOutcome(),
                task.getStatus(), task.getProcessedToday(), task.getQuotaDate(), task.getLastRunAt(),
                task.getLastError(), task.getVersion(), task.getCreatedAt(), task.getUpdatedAt());
    }

    public record JobSummary(UUID id, String title, UUID companyId, String companyName, String companyCode) {
    }
    public record BossSummary(UUID id, String displayName, String externalIdentifier) {
    }
}
