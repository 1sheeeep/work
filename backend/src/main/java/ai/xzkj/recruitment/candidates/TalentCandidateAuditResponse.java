package ai.xzkj.recruitment.candidates;

import java.time.Instant;

/** Aggregate-only integrity report; it intentionally contains no resume or message content. */
public record TalentCandidateAuditResponse(
        Instant generatedAt,
        Counts counts) {

    public record Counts(
            long candidateProfiles,
            long candidateJobContacts,
            long resumeIntakes,
            long aiRuns,
            long conversationMessages,
            long companies,
            long anonymizedCandidates,
            long candidatesWithMultipleResumes,
            long duplicateCandidateKeys,
            long pendingReviewWithAiSuccess,
            long succeededWithoutAiRun,
            long failedWithoutFailedRun,
            long contactsWithoutMessages,
            long contactsOnClosedJobs) {}
}
