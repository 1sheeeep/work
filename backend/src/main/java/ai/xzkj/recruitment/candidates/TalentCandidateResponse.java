package ai.xzkj.recruitment.candidates;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * First-version talent library projection. It intentionally exposes only
 * structured candidate metadata and processing status; resume files and
 * conversation bodies remain behind their existing permissioned endpoints.
 */
public record TalentCandidateResponse(
        UUID candidateId,
        CompanySummary company,
        CandidateSource source,
        String sourceReference,
        String displayName,
        String currentTitle,
        Integer yearsExperience,
        String education,
        String skillsSummary,
        CandidatePrivacyStatus privacyStatus,
        int resumeCount,
        String latestResumeStatus,
        String latestAnalysisStatus,
        String latestAnalysisQueueStatus,
        Instant latestAnalysisCompletedAt,
        List<JobSummary> relatedJobs,
        Instant createdAt,
        Instant updatedAt) {

    public record CompanySummary(UUID id, String name, String code) {}
    public record JobSummary(UUID id, String title) {}
}
