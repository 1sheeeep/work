package ai.xzkj.recruitment.jobs;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record JobPositionReviewRequest(
        @NotBlank(message = "请输入工作地点") @Size(max = 120, message = "工作地点不能超过 120 个字符") String location,
        @Min(value = 1, message = "月薪下限至少为 1K") @Max(value = 1000, message = "月薪下限不能超过 1000K") int salaryMinK,
        @Min(value = 1, message = "月薪上限至少为 1K") @Max(value = 1000, message = "月薪上限不能超过 1000K") int salaryMaxK,
        @Min(value = 12, message = "薪数不能少于 12") @Max(value = 16, message = "薪数不能超过 16") int salaryMonths,
        @NotBlank(message = "请输入经验要求") @Size(max = 80, message = "经验要求不能超过 80 个字符") String experienceRequirement,
        @NotBlank(message = "请输入学历要求") @Size(max = 80, message = "学历要求不能超过 80 个字符") String educationRequirement,
        @NotBlank(message = "请输入职位描述") @Size(max = 10000, message = "职位描述不能超过 10000 个字符") String description,
        @Size(max = 5000, message = "筛选要求不能超过 5000 个字符") String screeningRequirements,
        @NotBlank(message = "请填写候选人可见的岗位简介") @Size(max = 1000, message = "岗位简介不能超过 1000 个字符") String replySummary,
        @Size(max = 120, message = "薪资说明不能超过 120 个字符") String salaryDisplay,
        @AssertTrue(message = "请确认已对照真实 BOSS 岗位资料逐项核对") boolean captureConfirmed,
        @AssertTrue(message = "请确认岗位回复知识准确且允许使用") boolean knowledgeApproved,
        @AssertTrue(message = "请明确确认启用该岗位") boolean activateConfirmed
) {
}
