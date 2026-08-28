package ai.xzkj.recruitment.boss;

import jakarta.validation.constraints.NotNull;

public record BossAccountStatusRequest(@NotNull(message = "请选择账号状态") BossAccountStatus status) {
}
