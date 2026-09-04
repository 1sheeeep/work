package ai.xzkj.recruitment.organization;

public record CompanyAiAnalysisAuthorizationRequest(
        boolean enabled,
        boolean resumeProcessingAuthorized,
        boolean candidateNoticeConfirmed,
        boolean retentionPolicyConfirmed
) {}
