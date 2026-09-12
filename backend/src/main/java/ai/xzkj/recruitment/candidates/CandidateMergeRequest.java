package ai.xzkj.recruitment.candidates;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

public record CandidateMergeRequest(
        @NotNull UUID primaryCandidateId,
        @NotEmpty @Size(max = 50) List<UUID> duplicateCandidateIds) {}
