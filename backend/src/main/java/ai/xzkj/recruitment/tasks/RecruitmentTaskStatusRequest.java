package ai.xzkj.recruitment.tasks;

import jakarta.validation.constraints.NotNull;

public record RecruitmentTaskStatusRequest(@NotNull(message = "请选择任务状态") RecruitmentTaskStatus status) {
}
