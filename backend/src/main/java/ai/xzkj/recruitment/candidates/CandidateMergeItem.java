package ai.xzkj.recruitment.candidates;

import jakarta.persistence.*;
import java.util.UUID;

@Entity
@Table(name = "candidate_merge_items", uniqueConstraints = @UniqueConstraint(name = "uq_candidate_merge_item", columnNames = {"operation_id", "source_candidate_id"}))
public class CandidateMergeItem {
    @Id private UUID id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "operation_id") private CandidateMergeOperation operation;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "source_candidate_id") private CandidateProfile sourceCandidate;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "target_candidate_id") private CandidateProfile targetCandidate;

    protected CandidateMergeItem() {}
    public CandidateMergeItem(CandidateMergeOperation operation, CandidateProfile sourceCandidate, CandidateProfile targetCandidate) {
        this.id = UUID.randomUUID(); this.operation = operation; this.sourceCandidate = sourceCandidate; this.targetCandidate = targetCandidate;
    }
    public UUID getId() { return id; }
    public CandidateMergeOperation getOperation() { return operation; }
    public CandidateProfile getSourceCandidate() { return sourceCandidate; }
    public CandidateProfile getTargetCandidate() { return targetCandidate; }
}
