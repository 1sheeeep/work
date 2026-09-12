package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.organization.Company;
import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "candidate_merge_operations")
public class CandidateMergeOperation {
    @Id private UUID id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "company_id") private Company company;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "primary_candidate_id") private CandidateProfile primaryCandidate;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "merged_by") private SystemUser mergedBy;
    @Column(nullable = false, length = 16) private String status;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "undone_at") private Instant undoneAt;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "undone_by") private SystemUser undoneBy;

    protected CandidateMergeOperation() {}

    public CandidateMergeOperation(Company company, CandidateProfile primaryCandidate, SystemUser mergedBy, Instant now) {
        this.id = UUID.randomUUID(); this.company = company; this.primaryCandidate = primaryCandidate;
        this.mergedBy = mergedBy; this.status = "ACTIVE"; this.createdAt = now == null ? Instant.now() : now;
    }

    public void undo(SystemUser user, Instant now) { status = "UNDONE"; undoneBy = user; undoneAt = now == null ? Instant.now() : now; }
    public UUID getId() { return id; }
    public Company getCompany() { return company; }
    public CandidateProfile getPrimaryCandidate() { return primaryCandidate; }
    public SystemUser getMergedBy() { return mergedBy; }
    public String getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUndoneAt() { return undoneAt; }
    public SystemUser getUndoneBy() { return undoneBy; }
}
