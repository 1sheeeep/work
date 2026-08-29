package ai.xzkj.recruitment.jobs;

import java.util.List;

public record ReplyPreviewResponse(
        String mode,
        String content,
        List<String> missingFields,
        int companyKnowledgeVersion,
        int jobKnowledgeVersion
) {
}
