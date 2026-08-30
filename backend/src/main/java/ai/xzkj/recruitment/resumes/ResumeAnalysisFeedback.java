package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.auth.SystemUser;
import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "resume_analysis_feedback")
public class ResumeAnalysisFeedback {
    @Id private UUID id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "analysis_run_id") private AiAssistanceRun analysisRun;
    @Enumerated(EnumType.STRING) @Column(name = "feedback_type", nullable = false, length = 24) private ResumeAnalysisFeedbackType feedbackType;
    @Column(nullable = false, length = 1000) private String note;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "created_by") private SystemUser createdBy;
    @Column(name = "created_at", nullable = false) private Instant createdAt;

    protected ResumeAnalysisFeedback() {}

    ResumeAnalysisFeedback(AiAssistanceRun analysisRun, ResumeAnalysisFeedbackType feedbackType, String note, SystemUser createdBy) {
        this.id = UUID.randomUUID();
        this.analysisRun = analysisRun;
        this.feedbackType = feedbackType;
        this.note = note;
        this.createdBy = createdBy;
        this.createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public AiAssistanceRun getAnalysisRun() { return analysisRun; }
    public ResumeAnalysisFeedbackType getFeedbackType() { return feedbackType; }
    public String getNote() { return note; }
    public SystemUser getCreatedBy() { return createdBy; }
    public Instant getCreatedAt() { return createdAt; }
}
