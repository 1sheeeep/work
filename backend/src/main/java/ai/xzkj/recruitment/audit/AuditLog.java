package ai.xzkj.recruitment.audit;

import ai.xzkj.recruitment.auth.SystemUser;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "audit_logs")
public class AuditLog {
    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "actor_user_id")
    private SystemUser actor;

    @Column(name = "actor_name", nullable = false, length = 100)
    private String actorName;

    @Column(nullable = false, length = 64)
    private String action;

    @Column(name = "target_type", nullable = false, length = 64)
    private String targetType;

    @Column(name = "target_id")
    private UUID targetId;

    @Column(name = "target_label", length = 160)
    private String targetLabel;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private AuditResult result;

    @Column(length = 1000)
    private String details;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    protected AuditLog() {
    }

    public AuditLog(
            SystemUser actor,
            String action,
            String targetType,
            UUID targetId,
            String targetLabel,
            AuditResult result,
            String details
    ) {
        this.id = UUID.randomUUID();
        this.actor = actor;
        this.actorName = actor.getDisplayName();
        this.action = action;
        this.targetType = targetType;
        this.targetId = targetId;
        this.targetLabel = targetLabel;
        this.result = result;
        this.details = details;
        this.occurredAt = Instant.now();
    }

    public UUID getId() { return id; }
    public String getActorName() { return actorName; }
    public String getAction() { return action; }
    public String getTargetType() { return targetType; }
    public UUID getTargetId() { return targetId; }
    public String getTargetLabel() { return targetLabel; }
    public AuditResult getResult() { return result; }
    public String getDetails() { return details; }
    public Instant getOccurredAt() { return occurredAt; }
}
