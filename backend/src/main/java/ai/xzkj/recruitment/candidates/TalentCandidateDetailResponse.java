package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.resumes.ResumeIntakeSource;
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record TalentCandidateDetailResponse(
        TalentCandidateResponse candidate,
        List<ContactSummary> contacts,
        List<ResumeSummary> resumes,
        List<AnalysisSummary> analyses,
        List<TimelineEvent> timeline) {

    public record ContactSummary(
            UUID id,
            UUID jobPositionId,
            String jobTitle,
            UUID bossAccountId,
            String accountName,
            String status,
            boolean humanTakenOver,
            String assignedHr,
            Instant latestMessageAt,
            String latestMessagePreview) {}

    public record ResumeSummary(
            UUID id,
            UUID contactId,
            ResumeIntakeSource source,
            String displayLabel,
            Instant receivedAt,
            String status,
            String processingStatus,
            String documentType,
            String failureCode,
            String failureReason,
            String analysisStatus,
            String analysisFailureCode,
            String analysisFailureReason,
            String analysisQueueStatus,
            int analysisQueueAttempts,
            Instant processedAt,
            Instant analysisCompletedAt) {}

    public record AnalysisSummary(
            UUID id,
            UUID resumeIntakeId,
            String provider,
            String modelVersion,
            String status,
            String origin,
            JsonNode result,
            String errorMessage,
            Instant createdAt,
            Instant resultExpiresAt,
            Instant resultPurgedAt) {}

    public record TimelineEvent(
            String type,
            String label,
            String status,
            UUID referenceId,
            Instant occurredAt,
            String detail) {}
}
