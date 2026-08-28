package ai.xzkj.recruitment.users;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record HrUserPasswordRequest(
        @NotBlank(message = "请输入新密码") @Size(min = 12, max = 72, message = "密码长度应为 12 至 72 位") String password
) {
}
