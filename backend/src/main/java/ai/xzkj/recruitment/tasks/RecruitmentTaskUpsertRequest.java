package ai.xzkj.recruitment.tasks;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalTime;
import java.util.UUID;

public record RecruitmentTaskUpsertRequest(
        @NotNull(message = "请选择职位") UUID jobPositionId,
        @NotNull(message = "请选择 BOSS 账号") UUID bossAccountId,
        @NotBlank(message = "请输入任务名称") @Size(max = 120, message = "任务名称不能超过 120 个字符") String name,
        @NotNull(message = "请选择执行策略") ExecutionStrategy executionStrategy,
        @Min(value = 1, message = "每日配额至少为 1") @Max(value = 500, message = "每日配额不能超过 500") int dailyQuota,
        @NotNull(message = "请选择开始时间") LocalTime windowStart,
        @NotNull(message = "请选择结束时间") LocalTime windowEnd,
        @NotBlank(message = "请输入时区") @Size(max = 64, message = "时区不能超过 64 个字符") String timezone,
        boolean requireManualReview,
        @NotNull(message = "请选择 Mock 执行结果") MockExecutionOutcome mockOutcome
) {
}
