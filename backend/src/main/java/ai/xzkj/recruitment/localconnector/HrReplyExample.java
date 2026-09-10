package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.jobs.JobPosition;
import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "hr_reply_examples")
class HrReplyExample {
    @Id private UUID id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "job_position_id") private JobPosition jobPosition;
    @Column(nullable = false, length = 40) private String intent;
    @Column(name = "candidate_message", nullable = false, length = 1000) private String candidateMessage;
    @Column(name = "hr_reply", nullable = false, length = 500) private String hrReply;
    @Column(name = "source_hash", nullable = false, length = 64, unique = true) private String sourceHash;
    @Column(name = "created_at", nullable = false) private Instant createdAt;

    protected HrReplyExample() { }

    HrReplyExample(JobPosition jobPosition, String intent, String candidateMessage, String hrReply,
                   String sourceHash, Instant createdAt) {
        this.id = UUID.randomUUID(); this.jobPosition = jobPosition; this.intent = intent;
        this.candidateMessage = candidateMessage; this.hrReply = hrReply;
        this.sourceHash = sourceHash; this.createdAt = createdAt;
    }

    String getIntent() { return intent; }
    String getCandidateMessage() { return candidateMessage; }
    String getHrReply() { return hrReply; }
}
