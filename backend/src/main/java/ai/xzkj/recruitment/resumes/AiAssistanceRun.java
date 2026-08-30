package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.candidates.CandidateJobContact;
import ai.xzkj.recruitment.jobs.JobPosition;
import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "ai_assistance_runs")
public class AiAssistanceRun {
    @Id private UUID id;
    @Column(name = "assistance_type", nullable = false, length = 24) private String assistanceType;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "job_position_id") private JobPosition jobPosition;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "candidate_contact_id") private CandidateJobContact candidateContact;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "resume_intake_id") private ResumeIntake resumeIntake;
    @Column(nullable = false, length = 40) private String provider;
    @Column(name = "model_version", nullable = false, length = 80) private String modelVersion;
    @Column(name = "prompt_version", nullable = false, length = 80) private String promptVersion;
    @Column(name = "input_hash", nullable = false, length = 64) private String inputHash;
    @Column(nullable = false, length = 16) private String status;
    @Column(length = 16) private String outcome;
    @Column(columnDefinition = "TEXT") private String rationale;
    @Column(name = "structured_result", columnDefinition = "TEXT") private String structuredResult;
    @Column(name = "error_message", length = 1000) private String errorMessage;
    @Column(name = "result_expires_at") private Instant resultExpiresAt;
    @Column(name = "result_purged_at") private Instant resultPurgedAt;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "created_by") private SystemUser createdBy;
    @Column(name = "created_at", nullable = false) private Instant createdAt;

    protected AiAssistanceRun() {}

    static AiAssistanceRun succeeded(ResumeIntake intake, SystemUser user, String model, String inputHash,
                                     String rationale, String structuredResult, Instant resultExpiresAt) {
        AiAssistanceRun run = base(intake, user, model, inputHash);
        run.status = "SUCCEEDED";
        run.outcome = "REVIEW";
        run.rationale = rationale;
        run.structuredResult = structuredResult;
        run.resultExpiresAt = resultExpiresAt;
        return run;
    }

    static AiAssistanceRun failed(ResumeIntake intake, SystemUser user, String model, String inputHash,
                                  String errorMessage) {
        AiAssistanceRun run = base(intake, user, model, inputHash);
        run.status = "FAILED";
        run.errorMessage = errorMessage;
        return run;
    }

    private static AiAssistanceRun base(ResumeIntake intake, SystemUser user, String model, String inputHash) {
        AiAssistanceRun run = new AiAssistanceRun();
        run.id = UUID.randomUUID();
        run.assistanceType = "RESUME_ANALYSIS";
        run.resumeIntake = intake;
        run.candidateContact = intake.getContact();
        run.jobPosition = intake.getContact().getJobPosition();
        run.provider = "OPENAI";
        run.modelVersion = model == null || model.isBlank() ? "UNCONFIGURED" : model;
        run.promptVersion = "resume-analysis-v1";
        run.inputHash = inputHash;
        run.createdBy = user;
        run.createdAt = Instant.now();
        return run;
    }

    public UUID getId() { return id; }
    public ResumeIntake getResumeIntake() { return resumeIntake; }
    public String getProvider() { return provider; }
    public String getModelVersion() { return modelVersion; }
    public String getPromptVersion() { return promptVersion; }
    public String getInputHash() { return inputHash; }
    public String getStatus() { return status; }
    public String getRationale() { return rationale; }
    public String getStructuredResult() { return structuredResult; }
    public String getErrorMessage() { return errorMessage; }
    public Instant getResultExpiresAt() { return resultExpiresAt; }
    public Instant getResultPurgedAt() { return resultPurgedAt; }
    public boolean isResultPurged() { return resultPurgedAt != null; }
    public SystemUser getCreatedBy() { return createdBy; }
    public Instant getCreatedAt() { return createdAt; }

    boolean purgeResult(Instant now) {
        if (resultPurgedAt != null || resultExpiresAt == null || resultExpiresAt.isAfter(now)) return false;
        rationale = null;
        structuredResult = null;
        resultPurgedAt = now;
        return true;
    }
}
