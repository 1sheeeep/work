package ai.xzkj.recruitment.candidates;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record CandidateMergeOperationResponse(
        UUID operationId,
        String status,
        UUID primaryCandidateId,
        List<UUID> mergedCandidateIds,
        Instant createdAt,
        Instant undoneAt) {}
