package ai.xzkj.recruitment.users;

import ai.xzkj.recruitment.auth.UserRole;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.Set;
import java.util.UUID;

public record HrUserCreateRequest(
        @NotBlank(message = "请输入用户名")
        @Size(max = 64, message = "用户名不能超过 64 个字符")
        @Pattern(regexp = "^[A-Za-z0-9._-]+$", message = "用户名只能包含字母、数字、点、下划线和横线")
        String username,
        @NotBlank(message = "请输入姓名") @Size(max = 100, message = "姓名不能超过 100 个字符") String displayName,
        @NotNull(message = "请选择角色") UserRole role,
        @NotBlank(message = "请输入初始密码") @Size(min = 12, max = 72, message = "密码长度应为 12 至 72 位") String password,
        @NotEmpty(message = "请至少授权一家企业") Set<UUID> companyIds
) {
}
