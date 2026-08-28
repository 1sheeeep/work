package ai.xzkj.recruitment.candidates;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record HumanDecisionRequest(@NotNull ScreeningOutcome outcome,
                                   @NotBlank @Size(max = 3000) String rationale) {}
