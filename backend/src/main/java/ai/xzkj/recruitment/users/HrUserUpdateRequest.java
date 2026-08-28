package ai.xzkj.recruitment.users;

import ai.xzkj.recruitment.auth.UserRole;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.Set;
import java.util.UUID;

public record HrUserUpdateRequest(
        @NotBlank(message = "请输入姓名") @Size(max = 100, message = "姓名不能超过 100 个字符") String displayName,
        @NotNull(message = "请选择角色") UserRole role,
        @NotEmpty(message = "请至少授权一家企业") Set<UUID> companyIds
) {
}
