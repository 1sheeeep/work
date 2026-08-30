package ai.xzkj.recruitment.jobs;

import ai.xzkj.recruitment.boss.BossAccountStatus;
import ai.xzkj.recruitment.boss.BossConnectionStatus;
import ai.xzkj.recruitment.organization.CompanyStatus;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record JobPositionResponse(
        UUID id,
        CompanySummary company,
        BossAccountSummary bossAccount,
        String title,
        String location,
        int salaryMinK,
        int salaryMaxK,
        int salaryMonths,
        String experienceRequirement,
        String educationRequirement,
        String description,
        String screeningRequirements,
        String captureSource,
        Short captureCompleteness,
        Instant capturedAt,
        boolean captureVerified,
        Instant captureVerifiedAt,
        Instant lastObservedAt,
        int observationCount,
        String replySummary,
        String salaryDisplay,
        boolean knowledgeApproved,
        int knowledgeVersion,
        Instant knowledgeApprovedAt,
        boolean safeReplyReady,
        List<String> safeReplyIssues,
        ReviewReadiness reviewReadiness,
        JobPositionStatus status,
        long version,
        Instant createdAt,
        Instant updatedAt
) {
    public static JobPositionResponse from(JobPosition job) {
        var company = job.getCompany();
        var account = job.getBossAccount();
        var reply = SafeReplyComposer.compose(job);
        return new JobPositionResponse(
                job.getId(),
                new CompanySummary(company.getId(), company.getName(), company.getCode(), company.getStatus()),
                new BossAccountSummary(account.getId(), account.getDisplayName(), account.getExternalIdentifier(),
                        account.getStatus(), account.getConnectionStatus()),
                job.getTitle(), job.getLocation(), job.getSalaryMinK(), job.getSalaryMaxK(), job.getSalaryMonths(),
                job.getExperienceRequirement(), job.getEducationRequirement(), job.getDescription(),
                job.getScreeningRequirements(), job.getCaptureSource(), job.getCaptureCompleteness(), job.getCapturedAt(),
                job.isCaptureVerified(), job.getCaptureVerifiedAt(), job.getLastObservedAt(), job.getObservationCount(),
                job.getReplySummary(), job.getSalaryDisplay(), job.isKnowledgeApproved(),
                job.getKnowledgeVersion(), job.getKnowledgeApprovedAt(), "KNOWLEDGE".equals(reply.mode()),
                reply.missingFields(), ReviewReadiness.from(job), job.getStatus(), job.getVersion(),
                job.getCreatedAt(), job.getUpdatedAt());
    }

    public record CompanySummary(UUID id, String name, String code, CompanyStatus status) {
    }

    public record BossAccountSummary(UUID id, String displayName, String externalIdentifier,
                                     BossAccountStatus status, BossConnectionStatus connectionStatus) {
    }

    public record ReviewReadiness(boolean importedDraft, boolean profileComplete, boolean captureReady,
                                  boolean companyKnowledgeReady, boolean jobKnowledgeReady,
                                  boolean activationReady, List<String> blockers) {
        static ReviewReadiness from(JobPosition job) {
            boolean imported = !"MANUAL".equals(job.getCaptureSource()) && job.getStatus() == JobPositionStatus.DRAFT;
            boolean profile = complete(job.getLocation()) && complete(job.getExperienceRequirement())
                    && complete(job.getEducationRequirement()) && complete(job.getDescription());
            boolean capture = "MANUAL".equals(job.getCaptureSource()) || job.isCaptureVerified();
            var company = job.getCompany();
            boolean companyKnowledge = company.isKnowledgeApproved() && complete(company.getKnowledgeIndustry())
                    && complete(company.getKnowledgeSummary());
            boolean jobKnowledge = job.isKnowledgeApproved() && complete(job.getReplySummary());
            List<String> blockers = new java.util.ArrayList<>();
            if (!profile) blockers.add("岗位详情待补全");
            if (!capture) blockers.add("真实页面资料待核对");
            if (!companyKnowledge) blockers.add("企业回复知识待审核");
            if (!jobKnowledge) blockers.add("岗位回复知识待审核");
            return new ReviewReadiness(imported, profile, capture, companyKnowledge, jobKnowledge,
                    job.getStatus() == JobPositionStatus.DRAFT && profile && capture && companyKnowledge && jobKnowledge,
                    List.copyOf(blockers));
        }

        private static boolean complete(String value) {
            return value != null && !value.isBlank() && !value.contains("待从 BOSS 岗位页补全");
        }
    }
}
