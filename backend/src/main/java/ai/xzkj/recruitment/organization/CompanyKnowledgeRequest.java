package ai.xzkj.recruitment.organization;

import jakarta.validation.constraints.Size;

public record CompanyKnowledgeRequest(
        @Size(max = 120, message = "行业不能超过 120 个字符") String industry,
        @Size(max = 120, message = "公司规模不能超过 120 个字符") String scale,
        @Size(max = 1000, message = "公司介绍不能超过 1000 个字符") String summary,
        boolean approved
) {
}
