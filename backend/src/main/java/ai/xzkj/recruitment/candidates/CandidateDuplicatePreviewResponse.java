package ai.xzkj.recruitment.candidates;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 只读重复候选人扫描结果，不包含手机号、邮箱或简历正文。 */
public record CandidateDuplicatePreviewResponse(
        Instant generatedAt,
        int scannedCandidates,
        int duplicateGroups,
        List<Group> groups) {

    public record Group(
            UUID groupId,
            String confidence,
            String recommendation,
            UUID suggestedPrimaryCandidateId,
            List<String> reasons,
            List<Candidate> candidates) {}

    public record Candidate(
            UUID candidateId,
            CandidateSource source,
            String displayName,
            String companyName,
            int resumeCount,
            int contactCount,
            long successfulAnalyses,
            String latestAnalysisStatus,
            boolean hasPhoneIdentity,
            boolean hasEmailIdentity,
            Instant createdAt,
            Instant updatedAt) {}
}
