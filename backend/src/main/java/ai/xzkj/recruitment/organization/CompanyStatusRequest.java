package ai.xzkj.recruitment.organization;

import jakarta.validation.constraints.NotNull;

public record CompanyStatusRequest(@NotNull(message = "请选择企业状态") CompanyStatus status) {
}
