package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.jobs.JobPosition;
import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "candidate_job_contacts")
public class CandidateJobContact {
    @Id private UUID id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "candidate_id") private CandidateProfile candidate;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "job_position_id") private JobPosition jobPosition;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "boss_account_id") private BossAccount bossAccount;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 24) private CandidateContactStatus status;
    @Column(name = "human_taken_over", nullable = false) private boolean humanTakenOver;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "assigned_hr_id") private SystemUser assignedHr;
    @Version private long version;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;

    protected CandidateJobContact() {}
    public CandidateJobContact(CandidateProfile candidate, JobPosition jobPosition, BossAccount bossAccount) {
        this.id = UUID.randomUUID(); this.candidate = candidate; this.jobPosition = jobPosition; this.bossAccount = bossAccount;
        this.status = CandidateContactStatus.SCREENING; this.createdAt = Instant.now(); this.updatedAt = this.createdAt;
    }
    public void applyScreening(ScreeningOutcome hardRule, ScreeningOutcome ai) {
        if (hardRule == ScreeningOutcome.REJECT) status = CandidateContactStatus.REJECTED;
        else if (hardRule == ScreeningOutcome.PASS && ai == ScreeningOutcome.PASS) status = CandidateContactStatus.QUALIFIED;
        else status = CandidateContactStatus.SCREENING;
    }
    public void applyHumanDecision(ScreeningOutcome outcome) {
        status = outcome == ScreeningOutcome.PASS ? CandidateContactStatus.QUALIFIED
                : outcome == ScreeningOutcome.REJECT ? CandidateContactStatus.REJECTED : CandidateContactStatus.SCREENING;
    }
    public void takeOver(SystemUser user) { humanTakenOver = true; assignedHr = user; }
    public void release() { humanTakenOver = false; assignedHr = null; }
    public void markContacting() { status = CandidateContactStatus.CONTACTING; }
    @PreUpdate void preUpdate() { updatedAt = Instant.now(); }
    public UUID getId() { return id; }
    public CandidateProfile getCandidate() { return candidate; }
    public JobPosition getJobPosition() { return jobPosition; }
    public BossAccount getBossAccount() { return bossAccount; }
    public CandidateContactStatus getStatus() { return status; }
    public boolean isHumanTakenOver() { return humanTakenOver; }
    public SystemUser getAssignedHr() { return assignedHr; }
    public long getVersion() { return version; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
