package ai.xzkj.recruitment.autoreply;

import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.candidates.CandidateJobContact;
import ai.xzkj.recruitment.candidates.ConversationMessage;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name="auto_reply_attempts")
public class AutoReplyAttempt {
    @Id private UUID id;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="policy_id") private AutoReplyPolicy policy;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="boss_account_id") private BossAccount bossAccount;
    @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="contact_id") private CandidateJobContact contact;
    @OneToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="inbound_message_id") private ConversationMessage inboundMessage;
    @OneToOne(fetch=FetchType.LAZY) @JoinColumn(name="outbound_message_id") private ConversationMessage outboundMessage;
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=24) private AutoReplyAttemptStatus status;
    @Column(name="idempotency_key",nullable=false,length=160) private String idempotencyKey;
    @Column(name="owner_id",length=120) private String ownerId;
    @Column(name="lease_until") private Instant leaseUntil;
    @Column(name="attempt_count",nullable=false) private int attemptCount;
    @Column(name="result_message",length=500) private String resultMessage;
    @Column(name="created_at",nullable=false) private Instant createdAt;
    @Column(name="completed_at") private Instant completedAt;
    protected AutoReplyAttempt(){}
    public void complete(AutoReplyAttemptStatus status, ConversationMessage outbound, String message, Instant now){this.status=status;outboundMessage=outbound;resultMessage=message;completedAt=now;leaseUntil=now;}
    public void defer(Instant retryAt,String message){status=AutoReplyAttemptStatus.CLAIMED;leaseUntil=retryAt;resultMessage=message;ownerId=null;}
    public UUID getId(){return id;} public AutoReplyPolicy getPolicy(){return policy;} public BossAccount getBossAccount(){return bossAccount;}
    public CandidateJobContact getContact(){return contact;} public ConversationMessage getInboundMessage(){return inboundMessage;}
    public ConversationMessage getOutboundMessage(){return outboundMessage;} public AutoReplyAttemptStatus getStatus(){return status;}
    public String getIdempotencyKey(){return idempotencyKey;} public String getResultMessage(){return resultMessage;}
    public int getAttemptCount(){return attemptCount;} public Instant getCreatedAt(){return createdAt;} public Instant getCompletedAt(){return completedAt;}
}
