package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.auth.SystemUser;
import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "screening_decisions")
public class ScreeningDecision {
    @Id private UUID id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "contact_id") private CandidateJobContact contact;
    @Enumerated(EnumType.STRING) @Column(name = "decision_type", nullable = false, length = 24) private ScreeningDecisionType decisionType;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16) private ScreeningOutcome outcome;
    @Column(name = "engine_version", length = 80) private String engineVersion;
    @Column(name = "model_version", length = 80) private String modelVersion;
    @Column(name = "prompt_version", length = 80) private String promptVersion;
    @Column(nullable = false, columnDefinition = "TEXT") private String rationale;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "created_by") private SystemUser createdBy;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    protected ScreeningDecision() {}
    public ScreeningDecision(CandidateJobContact contact, ScreeningDecisionType decisionType, ScreeningOutcome outcome,
                             String engineVersion, String modelVersion, String promptVersion,
                             String rationale, SystemUser createdBy) {
        this.id = UUID.randomUUID(); this.contact = contact; this.decisionType = decisionType; this.outcome = outcome;
        this.engineVersion = engineVersion; this.modelVersion = modelVersion; this.promptVersion = promptVersion;
        this.rationale = rationale; this.createdBy = createdBy; this.createdAt = Instant.now();
    }
    public void anonymize() { rationale = "候选人资料已匿名"; }
    public UUID getId() { return id; }
    public ScreeningDecisionType getDecisionType() { return decisionType; }
    public ScreeningOutcome getOutcome() { return outcome; }
    public String getEngineVersion() { return engineVersion; }
    public String getModelVersion() { return modelVersion; }
    public String getPromptVersion() { return promptVersion; }
    public String getRationale() { return rationale; }
    public SystemUser getCreatedBy() { return createdBy; }
    public Instant getCreatedAt() { return createdAt; }
}
