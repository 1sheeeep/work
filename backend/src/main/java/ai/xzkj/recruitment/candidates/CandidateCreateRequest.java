package ai.xzkj.recruitment.candidates;

import jakarta.validation.constraints.*;
import java.util.UUID;

public record CandidateCreateRequest(
        @NotNull UUID jobPositionId,
        @NotNull CandidateSource source,
        @NotBlank @Size(max = 200) String externalCandidateId,
        @NotBlank @Size(max = 100) String displayName,
        @Size(max = 120) String currentTitle,
        @Min(0) @Max(60) Integer yearsExperience,
        @Size(max = 80) String education,
        @Size(max = 3000) String skillsSummary,
        @NotNull ScreeningOutcome hardRuleOutcome,
        @NotBlank @Size(max = 3000) String hardRuleRationale,
        @NotNull ScreeningOutcome aiOutcome,
        @NotBlank @Size(max = 3000) String aiRationale,
        @NotBlank @Size(max = 80) String modelVersion,
        @NotBlank @Size(max = 80) String promptVersion
) {}
