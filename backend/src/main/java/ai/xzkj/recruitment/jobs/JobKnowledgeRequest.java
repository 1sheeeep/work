package ai.xzkj.recruitment.jobs;

import jakarta.validation.constraints.Size;

public record JobKnowledgeRequest(
        @Size(max = 1000, message = "岗位简介不能超过 1000 个字符") String replySummary,
        @Size(max = 120, message = "薪资说明不能超过 120 个字符") String salaryDisplay,
        boolean approved
) {
}
