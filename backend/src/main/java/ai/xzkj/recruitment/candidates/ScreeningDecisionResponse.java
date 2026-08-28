package ai.xzkj.recruitment.candidates;

import java.time.Instant;
import java.util.UUID;

public record ScreeningDecisionResponse(UUID id, ScreeningDecisionType decisionType, ScreeningOutcome outcome,
                                        String engineVersion, String modelVersion, String promptVersion,
                                        String rationale, UserSummary createdBy, Instant createdAt) {
    public static ScreeningDecisionResponse from(ScreeningDecision decision) {
        return new ScreeningDecisionResponse(decision.getId(), decision.getDecisionType(), decision.getOutcome(),
                decision.getEngineVersion(), decision.getModelVersion(), decision.getPromptVersion(), decision.getRationale(),
                decision.getCreatedBy() == null ? null : new UserSummary(decision.getCreatedBy().getId(), decision.getCreatedBy().getDisplayName()),
                decision.getCreatedAt());
    }
    public record UserSummary(UUID id, String displayName) {}
}
