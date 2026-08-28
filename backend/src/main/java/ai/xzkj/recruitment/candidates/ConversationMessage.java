package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.auth.SystemUser;
import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "conversation_messages")
public class ConversationMessage {
    @Id private UUID id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "contact_id") private CandidateJobContact contact;
    @Column(name = "external_message_id", nullable = false, length = 120) private String externalMessageId;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 16) private MessageDirection direction;
    @Enumerated(EnumType.STRING) @Column(name = "sender_type", nullable = false, length = 16) private MessageSenderType senderType;
    @Enumerated(EnumType.STRING) @Column(name = "delivery_status", nullable = false, length = 24) private MessageDeliveryStatus deliveryStatus;
    @Column(nullable = false, columnDefinition = "TEXT") private String content;
    @Column(name = "model_version", length = 80) private String modelVersion;
    @Column(name = "prompt_version", length = 80) private String promptVersion;
    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "created_by") private SystemUser createdBy;
    @Column(name = "approved_at") private Instant approvedAt;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    protected ConversationMessage() {}
    public ConversationMessage(CandidateJobContact contact, String externalMessageId, MessageDirection direction,
                               MessageSenderType senderType, MessageDeliveryStatus deliveryStatus, String content,
                               String modelVersion, String promptVersion, SystemUser createdBy) {
        this.id = UUID.randomUUID(); this.contact = contact; this.externalMessageId = externalMessageId;
        this.direction = direction; this.senderType = senderType; this.deliveryStatus = deliveryStatus;
        this.content = content; this.modelVersion = modelVersion; this.promptVersion = promptVersion;
        this.createdBy = createdBy; this.createdAt = Instant.now();
    }
    public void sent() { deliveryStatus = MessageDeliveryStatus.SENT; approvedAt = Instant.now(); }
    public void failed() { deliveryStatus = MessageDeliveryStatus.FAILED; approvedAt = Instant.now(); }
    public void reject() { deliveryStatus = MessageDeliveryStatus.REJECTED; approvedAt = Instant.now(); }
    public void anonymize() { content = "[内容已匿名]"; }
    public UUID getId() { return id; }
    public CandidateJobContact getContact() { return contact; }
    public String getExternalMessageId() { return externalMessageId; }
    public MessageDirection getDirection() { return direction; }
    public MessageSenderType getSenderType() { return senderType; }
    public MessageDeliveryStatus getDeliveryStatus() { return deliveryStatus; }
    public String getContent() { return content; }
    public String getModelVersion() { return modelVersion; }
    public String getPromptVersion() { return promptVersion; }
    public SystemUser getCreatedBy() { return createdBy; }
    public Instant getApprovedAt() { return approvedAt; }
    public Instant getCreatedAt() { return createdAt; }
}
