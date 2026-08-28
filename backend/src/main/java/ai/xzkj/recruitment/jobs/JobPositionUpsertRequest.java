package ai.xzkj.recruitment.jobs;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

public record JobPositionUpsertRequest(
        @NotNull(message = "请选择归属企业") UUID companyId,
        @NotNull(message = "请选择 BOSS 账号") UUID bossAccountId,
        @NotBlank(message = "请输入职位名称") @Size(max = 120, message = "职位名称不能超过 120 个字符") String title,
        @NotBlank(message = "请输入工作地点") @Size(max = 120, message = "工作地点不能超过 120 个字符") String location,
        @Min(value = 1, message = "月薪下限至少为 1K") @Max(value = 1000, message = "月薪下限不能超过 1000K") int salaryMinK,
        @Min(value = 1, message = "月薪上限至少为 1K") @Max(value = 1000, message = "月薪上限不能超过 1000K") int salaryMaxK,
        @Min(value = 12, message = "薪数不能少于 12") @Max(value = 16, message = "薪数不能超过 16") int salaryMonths,
        @NotBlank(message = "请输入经验要求") @Size(max = 80, message = "经验要求不能超过 80 个字符") String experienceRequirement,
        @NotBlank(message = "请输入学历要求") @Size(max = 80, message = "学历要求不能超过 80 个字符") String educationRequirement,
        @NotBlank(message = "请输入职位描述") @Size(max = 10000, message = "职位描述不能超过 10000 个字符") String description,
        @Size(max = 5000, message = "筛选要求不能超过 5000 个字符") String screeningRequirements
) {
}
