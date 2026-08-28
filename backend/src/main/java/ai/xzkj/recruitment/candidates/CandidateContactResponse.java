package ai.xzkj.recruitment.candidates;

import java.time.Instant;
import java.util.UUID;

public record CandidateContactResponse(
        UUID id, UUID candidateId, CompanySummary company, JobSummary jobPosition, BossSummary bossAccount,
        CandidateSource source, String sourceReference, String displayName, String currentTitle,
        Integer yearsExperience, String education, String skillsSummary, CandidatePrivacyStatus privacyStatus,
        CandidateContactStatus status, boolean humanTakenOver, ScreeningDecisionResponse.UserSummary assignedHr,
        ScreeningDecisionResponse latestHardRule, ScreeningDecisionResponse latestAiSuggestion,
        ScreeningDecisionResponse latestHumanOverride, Instant createdAt, Instant updatedAt) {
    public static CandidateContactResponse from(CandidateJobContact contact, java.util.List<ScreeningDecision> decisions) {
        CandidateProfile candidate = contact.getCandidate();
        return new CandidateContactResponse(contact.getId(), candidate.getId(),
                new CompanySummary(candidate.getCompany().getId(), candidate.getCompany().getName(), candidate.getCompany().getCode()),
                new JobSummary(contact.getJobPosition().getId(), contact.getJobPosition().getTitle()),
                new BossSummary(contact.getBossAccount().getId(), contact.getBossAccount().getDisplayName()),
                candidate.getSource(), candidate.getSource() + " · " + candidate.getDedupKey().substring(0, 8),
                candidate.getDisplayName(), candidate.getCurrentTitle(), candidate.getYearsExperience(), candidate.getEducation(),
                candidate.getSkillsSummary(), candidate.getPrivacyStatus(), contact.getStatus(), contact.isHumanTakenOver(),
                contact.getAssignedHr() == null ? null : new ScreeningDecisionResponse.UserSummary(contact.getAssignedHr().getId(), contact.getAssignedHr().getDisplayName()),
                latest(decisions, ScreeningDecisionType.HARD_RULE), latest(decisions, ScreeningDecisionType.AI_SUGGESTION),
                latest(decisions, ScreeningDecisionType.HUMAN_OVERRIDE), contact.getCreatedAt(), contact.getUpdatedAt());
    }
    private static ScreeningDecisionResponse latest(java.util.List<ScreeningDecision> decisions, ScreeningDecisionType type) {
        return decisions.stream().filter(item -> item.getDecisionType() == type).findFirst().map(ScreeningDecisionResponse::from).orElse(null);
    }
    public record CompanySummary(UUID id, String name, String code) {}
    public record JobSummary(UUID id, String title) {}
    public record BossSummary(UUID id, String displayName) {}
}
