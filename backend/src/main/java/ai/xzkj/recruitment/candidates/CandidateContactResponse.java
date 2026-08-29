package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.autoreply.AutoReplyAttempt;
import java.time.Instant;
import java.util.UUID;

public record CandidateContactResponse(
        UUID id, UUID candidateId, CompanySummary company, JobSummary jobPosition, BossSummary bossAccount,
        CandidateSource source, String sourceReference, String displayName, String currentTitle,
        Integer yearsExperience, String education, String skillsSummary, CandidatePrivacyStatus privacyStatus,
        CandidateContactStatus status, boolean humanTakenOver, ScreeningDecisionResponse.UserSummary assignedHr,
        ScreeningDecisionResponse latestHardRule, ScreeningDecisionResponse latestAiSuggestion,
        ScreeningDecisionResponse latestHumanOverride, Instant latestMessageAt, MessageDirection latestMessageDirection,
        String latestMessagePreview, boolean needsHrFollowUp, boolean pendingReviewDraft,
        String latestAutoReplyStatus, Instant latestAutoReplyAt, Instant createdAt, Instant updatedAt) {
    public static CandidateContactResponse from(CandidateJobContact contact, java.util.List<ScreeningDecision> decisions,
                                                ConversationMessage latestMessage, AutoReplyAttempt latestAttempt) {
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
                latest(decisions, ScreeningDecisionType.HUMAN_OVERRIDE),
                latestMessage == null ? null : latestMessage.getCreatedAt(), latestMessage == null ? null : latestMessage.getDirection(),
                preview(latestMessage), needsFollowUp(latestMessage, latestAttempt),
                latestMessage != null && latestMessage.getDeliveryStatus() == MessageDeliveryStatus.PENDING_REVIEW,
                latestAttempt == null ? null : latestAttempt.getStatus().name(),
                latestAttempt == null ? null : (latestAttempt.getCompletedAt() == null ? latestAttempt.getCreatedAt() : latestAttempt.getCompletedAt()),
                contact.getCreatedAt(), contact.getUpdatedAt());
    }
    private static ScreeningDecisionResponse latest(java.util.List<ScreeningDecision> decisions, ScreeningDecisionType type) {
        return decisions.stream().filter(item -> item.getDecisionType() == type).findFirst().map(ScreeningDecisionResponse::from).orElse(null);
    }
    private static boolean needsFollowUp(ConversationMessage message, AutoReplyAttempt attempt) {
        if (message == null) return false;
        if (message.getDirection() == MessageDirection.INBOUND) return true;
        return attempt != null && (attempt.getStatus().name().equals("SENT") || attempt.getStatus().name().equals("PENDING_REVIEW"));
    }
    private static String preview(ConversationMessage message) {
        if (message == null) return null;
        String content = message.getContent();
        return content.length() <= 80 ? content : content.substring(0, 80) + "…";
    }
    public record CompanySummary(UUID id, String name, String code) {}
    public record JobSummary(UUID id, String title) {}
    public record BossSummary(UUID id, String displayName) {}
}
