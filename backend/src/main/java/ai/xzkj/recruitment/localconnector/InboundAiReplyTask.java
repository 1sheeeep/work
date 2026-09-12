package ai.xzkj.recruitment.localconnector;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "inbound_ai_reply_tasks")
class InboundAiReplyTask {
    /** Initial attempt plus at most two retry attempts for transient AI failures. */
    static final int MAX_AI_ATTEMPTS = 3;
    @Id private UUID id;
    @Version private long version;
    @Column(name="account_id",nullable=false) private UUID accountId;
    @Column(name="observation_id",nullable=false) private UUID observationId;
    @Column(name="job_position_id",nullable=false) private UUID jobPositionId;
    @Column(name="chat_digest",nullable=false,length=64) private String chatDigest;
    @Column(name="message_digest",nullable=false,length=64) private String messageDigest;
    @Column(name="message_text",columnDefinition="TEXT") private String messageText;
    @Column(name="conversation_context",columnDefinition="TEXT") private String conversationContext;
    @Column(nullable=false,length=24) private String status;
    @Column(name="reply_allowed") private Boolean replyAllowed;
    @Column(length=40) private String category;
    private Double confidence;
    @Column(name="reply_content",length=120) private String replyContent;
    @Column(name="result_reason",length=300) private String resultReason;
    @Column(name="attempt_count",nullable=false) private int attemptCount;
    @Column(name="created_at",nullable=false) private Instant createdAt;
    @Column(name="started_at") private Instant startedAt;
    @Column(name="completed_at") private Instant completedAt;
    @Column(name="updated_at",nullable=false) private Instant updatedAt;
    @Column(name="next_attempt_at") private Instant nextAttemptAt;
    @Column(name="last_error_code",length=80) private String lastErrorCode;
    @Column(name="send_status",nullable=false,length=24) private String sendStatus="PENDING";
    @Column(name="send_device_id") private UUID sendDeviceId;
    @Column(name="send_lease_token_hash",length=64) private String sendLeaseTokenHash;
    @Column(name="send_lease_until") private Instant sendLeaseUntil;
    @Column(name="send_claimed_at") private Instant sendClaimedAt;
    @Column(name="send_before_state_digest",length=64) private String sendBeforeStateDigest;
    @Column(name="send_after_state_digest",length=64) private String sendAfterStateDigest;
    @Column(name="send_receipt_digest",length=64) private String sendReceiptDigest;
    @Column(name="send_result_reason",length=300) private String sendResultReason;
    @Column(name="send_completed_at") private Instant sendCompletedAt;

    protected InboundAiReplyTask() { }

    InboundAiReplyTask(UUID accountId, UUID observationId, UUID jobPositionId, String chatDigest,
                       String messageDigest, String messageText, Instant now) {
        this(accountId, observationId, jobPositionId, chatDigest, messageDigest, messageText, null, now);
    }

    InboundAiReplyTask(UUID accountId, UUID observationId, UUID jobPositionId, String chatDigest,
                       String messageDigest, String messageText, String conversationContext, Instant now) {
        this.id=UUID.randomUUID();this.accountId=accountId;this.observationId=observationId;
        this.jobPositionId=jobPositionId;this.chatDigest=chatDigest;this.messageDigest=messageDigest;
        this.messageText=messageText;this.conversationContext=conversationContext;this.status="QUEUED";this.createdAt=now;this.updatedAt=now;this.nextAttemptAt=now;
    }

    void start(Instant now){status="PROCESSING";attemptCount++;startedAt=now;updatedAt=now;}
    void complete(InboundJobReplyService.Decision decision,Instant now){if(!"PROCESSING".equals(status))return;status="COMPLETED";replyAllowed=decision.replyAllowed();category=decision.category();confidence=decision.confidence();replyContent=decision.content();resultReason=bounded(decision.reason());sendStatus=decision.replyAllowed()?"READY":"SKIPPED";messageText=null;conversationContext=null;nextAttemptAt=null;lastErrorCode=null;completedAt=now;updatedAt=now;}
    void fail(String reason,Instant now){status="FAILED";replyAllowed=false;category="UNCERTAIN";confidence=0d;replyContent=null;resultReason=bounded(reason);sendStatus="SKIPPED";messageText=null;conversationContext=null;nextAttemptAt=null;completedAt=now;updatedAt=now;}
    boolean retry(String code,String reason,Instant now){if(attemptCount>=MAX_AI_ATTEMPTS){lastErrorCode=code;fail("AI 输出重试已耗尽（"+MAX_AI_ATTEMPTS+" 次）："+reason,now);return false;}status="RETRY_WAIT";lastErrorCode=code;resultReason=bounded(reason);startedAt=null;nextAttemptAt=now.plusSeconds(5L*(1L<<Math.max(0,attemptCount-1)));updatedAt=now;return true;}
    void releaseRetry(Instant now){if("RETRY_WAIT".equals(status)&&nextAttemptAt!=null&&!nextAttemptAt.isAfter(now)){status="QUEUED";updatedAt=now;}}
    void recoverIfStale(Instant now){if("PROCESSING".equals(status)&&startedAt!=null&&Duration.between(startedAt,now).toMinutes()>=3){status="QUEUED";startedAt=null;nextAttemptAt=now;updatedAt=now;}}
    InboundJobReplyService.Decision decision(){return new InboundJobReplyService.Decision(Boolean.TRUE.equals(replyAllowed),category==null?"UNCERTAIN":category,confidence==null?0:confidence,replyContent,resultReason==null?"任务尚未完成":resultReason);}
    boolean claimSend(UUID deviceId,String tokenHash,String beforeDigest,Instant now){if(!"READY".equals(sendStatus))return false;sendStatus="CLAIMED";sendDeviceId=deviceId;sendLeaseTokenHash=tokenHash;sendBeforeStateDigest=beforeDigest;sendClaimedAt=now;sendLeaseUntil=now.plusSeconds(30);updatedAt=now;return true;}
    boolean receiptSend(UUID deviceId,String outcome,String beforeDigest,String afterDigest,String receiptDigest,String reason,Instant now){if(!deviceId.equals(sendDeviceId))throw new IllegalStateException("发送租约不属于当前设备");if(!"CLAIMED".equals(sendStatus)){if(sendStatus.equals(outcome)&&java.util.Objects.equals(sendReceiptDigest,receiptDigest)&&java.util.Objects.equals(sendBeforeStateDigest,beforeDigest)&&java.util.Objects.equals(sendAfterStateDigest,afterDigest))return false;throw new IllegalStateException("发送租约已有不同结果，禁止覆盖");}if(now.isAfter(sendLeaseUntil)){expireSendLease(now);return true;}if("SUCCEEDED".equals(outcome)&&java.util.Objects.equals(beforeDigest,afterDigest))throw new IllegalStateException("发送成功回执必须包含页面状态变化");sendStatus=outcome;sendBeforeStateDigest=beforeDigest;sendAfterStateDigest=afterDigest;sendReceiptDigest=receiptDigest;sendResultReason=bounded(reason);sendCompletedAt=now;updatedAt=now;return true;}
    void expireSendLease(Instant now){if(!"CLAIMED".equals(sendStatus))return;sendStatus="UNKNOWN";sendResultReason="发送租约超时且未收到明确回执，已禁止重试";sendCompletedAt=now;updatedAt=now;}
    void skipSend(String reason,Instant now){if(!"READY".equals(sendStatus))return;sendStatus="SKIPPED";sendResultReason=bounded(reason);sendCompletedAt=now;updatedAt=now;}
    void supersede(String reason,Instant now){if("CLAIMED".equals(sendStatus)||"SUCCEEDED".equals(sendStatus)||"UNKNOWN".equals(sendStatus))return;status="COMPLETED";replyAllowed=false;category="SUPERSEDED";confidence=0d;replyContent=null;resultReason=bounded(reason);sendStatus="SKIPPED";sendResultReason=bounded(reason);messageText=null;conversationContext=null;nextAttemptAt=null;completedAt=now;sendCompletedAt=now;updatedAt=now;}
    private String bounded(String value){String clean=value==null?"处理失败":value.replace('\n',' ').replace('\r',' ').trim();return clean.substring(0,Math.min(300,clean.length()));}

    UUID getId(){return id;} UUID getAccountId(){return accountId;} UUID getObservationId(){return observationId;} UUID getJobPositionId(){return jobPositionId;}
    String getMessageText(){return messageText;} String getConversationContext(){return conversationContext;} String getStatus(){return status;} Instant getCreatedAt(){return createdAt;} int getAttemptCount(){return attemptCount;} Instant getNextAttemptAt(){return nextAttemptAt;} String getLastErrorCode(){return lastErrorCode;}
    String getChatDigest(){return chatDigest;} String getMessageDigest(){return messageDigest;} String getReplyContent(){return replyContent;} String getCategory(){return category;} Double getConfidence(){return confidence;} String getResultReason(){return resultReason;} String getSendStatus(){return sendStatus;} String getSendResultReason(){return sendResultReason;} UUID getSendDeviceId(){return sendDeviceId;} String getSendLeaseTokenHash(){return sendLeaseTokenHash;} Instant getSendLeaseUntil(){return sendLeaseUntil;} Instant getCompletedAt(){return completedAt;} Instant getSendCompletedAt(){return sendCompletedAt;} Instant getUpdatedAt(){return updatedAt;}
    boolean isPartialReply(){return resultReason!=null&&resultReason.startsWith("已部分回答，仍需 HR 补充：");}
    boolean isExpectedSilence(){return resultReason!=null&&resultReason.startsWith("正常静默：");}
    boolean isShadowEvaluation(){return resultReason!=null&&resultReason.startsWith("影子评测：");}
    boolean wasReplyApproved(){return Boolean.TRUE.equals(replyAllowed)||isShadowEvaluation();}
}
