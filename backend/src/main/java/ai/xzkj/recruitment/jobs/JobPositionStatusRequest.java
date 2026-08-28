package ai.xzkj.recruitment.jobs;

import jakarta.validation.constraints.NotNull;

public record JobPositionStatusRequest(@NotNull(message = "请选择职位状态") JobPositionStatus status) {
}
