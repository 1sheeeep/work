package ai.xzkj.recruitment.candidates;

import java.util.List;
import java.util.UUID;

public record CandidateMergePreviewResponse(
        UUID primaryCandidateId,
        List<UUID> duplicateCandidateIds,
        int candidateCount,
        int contactCount,
        int resumeCount,
        long successfulAnalysisCount,
        int conversationMessageCount,
        List<String> warnings) {}
