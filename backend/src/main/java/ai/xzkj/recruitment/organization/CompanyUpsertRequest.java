package ai.xzkj.recruitment.organization;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record CompanyUpsertRequest(
        @NotBlank(message = "请输入企业名称") @Size(max = 120, message = "企业名称不能超过 120 个字符") String name,
        @NotBlank(message = "请输入企业编码")
        @Pattern(regexp = "[A-Za-z0-9_-]{2,32}", message = "企业编码需为 2-32 位字母、数字、下划线或短横线") String code,
        @Size(max = 120, message = "所在地不能超过 120 个字符") String location,
        @Size(max = 500, message = "备注不能超过 500 个字符") String notes
) {
}
