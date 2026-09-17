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
    static final String QUEUE_ANALYSIS = "ANALYSIS";
    static final String QUEUE_SEND = "SEND";
    static final String QUEUE_REVALIDATION = "REVALIDATION";
    static final String QUEUE_TERMINAL = "TERMINAL";
    /** Initial attempt plus at most two retry attempts for transient AI failures. */
    static final int MAX_AI_ATTEMPTS = 3;
    static final int MAX_SAFE_REPLAYS = 1;
    static final long SEND_LEASE_SECONDS = 45;
    private static final long MAX_RETRY_DELAY_SECONDS = 60;
    @Id private UUID id;
    @Version private long version;
    @Column(name="account_id",nullable=false) private UUID accountId;
    @Column(name="observation_id",nullable=false) private UUID observationId;
    @Column(name="job_position_id",nullable=false) private UUID jobPositionId;
    @Column(name="chat_digest",nullable=false,length=64) private String chatDigest;
    @Column(name="message_digest",nullable=false,length=64) private String messageDigest;
    @Column(name="message_text",columnDefinition="TEXT") private String messageText;
    @Column(name="conversation_context",columnDefinition="TEXT") private String conversationContext;
    @Column(name="purpose",nullable=false,length=24) private String purpose="STANDARD_REPLY";
    @Column(name="resume_intake_id") private UUID resumeIntakeId;
    @Column(nullable=false,length=24) private String status;
    @Column(name="reply_allowed") private Boolean replyAllowed;
    @Column(length=40) private String category;
    private Double confidence;
    @Column(name="reply_content",length=120) private String replyContent;
    @Column(name="result_reason",length=300) private String resultReason;
    @Column(name="attempt_count",nullable=false) private int attemptCount;
    @Column(name="created_at",nullable=false) private Instant createdAt;
    @Column(name="started_at") private Instant startedAt;
    @Column(name="processing_token",length=36) private String processingToken;
    @Column(name="queue_lane",nullable=false,length=24) private String queueLane = QUEUE_ANALYSIS;
    @Column(name="completed_at") private Instant completedAt;
    @Column(name="updated_at",nullable=false) private Instant updatedAt;
    @Column(name="next_attempt_at") private Instant nextAttemptAt;
    @Column(name="last_error_code",length=80) private String lastErrorCode;
    @Column(name="safe_replay_count",nullable=false) private int safeReplayCount;
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
        this(accountId, observationId, jobPositionId, chatDigest, messageDigest, messageText,
                conversationContext, "STANDARD_REPLY", null, now);
    }

    InboundAiReplyTask(UUID accountId, UUID observationId, UUID jobPositionId, String chatDigest,
                       String messageDigest, String messageText, String conversationContext,
                       String purpose, UUID resumeIntakeId, Instant now) {
        this.id=UUID.randomUUID();this.accountId=accountId;this.observationId=observationId;
        this.jobPositionId=jobPositionId;this.chatDigest=chatDigest;this.messageDigest=messageDigest;
        this.messageText=messageText;this.conversationContext=conversationContext;
        this.purpose="RESUME_RECEIPT".equals(purpose)?"RESUME_RECEIPT":"STANDARD_REPLY";
        this.resumeIntakeId="RESUME_RECEIPT".equals(this.purpose)?resumeIntakeId:null;
        this.status="QUEUED";this.queueLane=QUEUE_ANALYSIS;this.createdAt=now;this.updatedAt=now;this.nextAttemptAt=now;
    }

    String start(Instant now){status="PROCESSING";queueLane=QUEUE_ANALYSIS;attemptCount++;startedAt=now;processingToken=UUID.randomUUID().toString();updatedAt=now;return processingToken;}
    void complete(InboundJobReplyService.Decision decision,Instant now){complete(decision,processingToken,now);}
    boolean complete(InboundJobReplyService.Decision decision,String expectedProcessingToken,Instant now){if(!isCurrentProcessing(expectedProcessingToken))return false;status="COMPLETED";replyAllowed=decision.replyAllowed();category=decision.category();confidence=decision.confidence();replyContent=decision.content();resultReason=bounded(decision.reason());sendStatus=decision.replyAllowed()?"READY":"SKIPPED";queueLane=decision.replyAllowed()?QUEUE_SEND:(isReplayableFailure()?QUEUE_REVALIDATION:QUEUE_TERMINAL);conversationContext=null;nextAttemptAt=null;lastErrorCode=null;processingToken=null;completedAt=now;updatedAt=now;return true;}
    void fail(String reason,Instant now){fail(lastErrorCode,reason,now);}
    void fail(String code,String reason,Instant now){status="FAILED";replyAllowed=false;category="UNCERTAIN";confidence=0d;replyContent=null;resultReason=bounded(reason);lastErrorCode=boundedCode(code);sendStatus="SKIPPED";queueLane=isReplayableFailure()?QUEUE_REVALIDATION:QUEUE_TERMINAL;conversationContext=null;nextAttemptAt=null;processingToken=null;completedAt=now;updatedAt=now;}
    boolean failProcessing(String code,String reason,String expectedProcessingToken,Instant now){if(!isCurrentProcessing(expectedProcessingToken))return false;fail(code,reason,now);return true;}
    boolean retry(String code,String reason,Instant now){return retry(code,reason,processingToken,now);}
    boolean retry(String code,String reason,String expectedProcessingToken,Instant now){if(!isCurrentProcessing(expectedProcessingToken))return false;if(attemptCount>=MAX_AI_ATTEMPTS){lastErrorCode=code;fail(code,"AI 输出重试已耗尽（"+MAX_AI_ATTEMPTS+" 次）："+reason,now);return false;}status="RETRY_WAIT";queueLane=QUEUE_ANALYSIS;lastErrorCode=boundedCode(code);resultReason=bounded(reason);startedAt=null;processingToken=null;long delay=Math.min(MAX_RETRY_DELAY_SECONDS,5L*(1L<<Math.max(0,attemptCount-1)));nextAttemptAt=now.plusSeconds(delay);updatedAt=now;return true;}
    void releaseRetry(Instant now){if("RETRY_WAIT".equals(status)&&nextAttemptAt!=null&&!nextAttemptAt.isAfter(now)){status="QUEUED";queueLane=QUEUE_ANALYSIS;updatedAt=now;}}
    boolean recoverIfStale(Instant now){
        if(!"PROCESSING".equals(status)||startedAt==null||Duration.between(startedAt,now).toMinutes()<3)return false;
        if(attemptCount>=MAX_AI_ATTEMPTS){
            fail("INBOUND_REPLY_AI_STALE_PROCESSING","AI 回复任务处理超过 3 分钟且已达到最大尝试次数，已停止自动重试",now);
            return true;
        }
        status="QUEUED";queueLane=QUEUE_ANALYSIS;startedAt=null;processingToken=null;nextAttemptAt=now;updatedAt=now;return true;
    }
    boolean isReplayableFailure(){
        // A legacy badge-clear result must not override the interview handoff.
        // Cancellation is a separate deterministic intent and may still be
        // revalidated with fresh page evidence.
        if (InboundJobReplyService.isInterviewCoordination(messageText, conversationContext)
                && !InboundJobReplyService.isInterviewCancellation(messageText)) return false;
        // 2026-09-14 前的恢复任务曾把“自动打开会话后未读角标消失”误判为 HR 已处理。
        // 这类任务允许再做一次受控复核；真正重入队前仍必须由插件重新读取当前正文，
        // 并通过消息摘要、方向、岗位归属和详情时效校验。
        if (wasUnreadBadgeMisclassified()) return safeReplayCount < 2;
        if (safeReplayCount >= MAX_SAFE_REPLAYS) return false;
        if ("FAILED".equals(sendStatus)) return "COMPLETED".equals(status) && Boolean.TRUE.equals(replyAllowed);
        if (!"SKIPPED".equals(sendStatus)) return false;
        if ("FAILED".equals(status)) return switch (lastErrorCode == null ? "" : lastErrorCode) {
                    case "AI_OUTPUT_INVALID", "INBOUND_REPLY_AI_REQUEST_FAILED", "INBOUND_REPLY_AI_TIMEOUT",
                         "INBOUND_REPLY_AI_INVALID", "INBOUND_REPLY_AI_INVALID_RESULT", "INBOUND_REPLY_AI_OUTPUT_MISSING",
                         "INBOUND_REPLY_AI_RATE_LIMITED", "INBOUND_REPLY_AI_UPSTREAM_5XX" -> true;
                    default -> false;
                };
        if (!"COMPLETED".equals(status) || resultReason == null) return false;
        // Older policy versions classified explicit interview cancellations as generic
        // interview coordination. Replay only messages that the current deterministic
        // cancellation classifier can prove are cancellations; ordinary scheduling
        // questions must continue to be handed to HR.
        if ("INTERVIEW_COORDINATION".equals(category)
                && InboundJobReplyService.isInterviewCancellation(messageText)) return true;
        // Only malformed model output may be revalidated. A grounded-fact
        // mismatch, explicit human handoff or expected conversational ending
        // must not silently re-enter the AI queue on every duty cycle.
        return resultReason.startsWith("AI 回复未通过独立意图校验")
                || resultReason.startsWith("AI 回复未通过独立质量校验")
                || resultReason.startsWith("AI 社交回复未通过安全校验")
                || resultReason.startsWith("AI 澄清问题未通过安全校验");
    }
    boolean wasUnreadBadgeMisclassified(){
        return "COMPLETED".equals(status) && "SKIPPED".equals(sendStatus)
                && "会话已由 HR 处理或已不再处于候选人未读状态，待发送回复已安全作废".equals(sendResultReason);
    }
    boolean isReplayableFailure(Instant now, Duration silentDelay){
        if (!isReplayableFailure()) return false;
        if (!isExpectedSilence()) return true;
        Instant terminalAt = completedAt == null ? updatedAt : completedAt;
        Duration delay = silentDelay == null || silentDelay.isNegative() ? Duration.ofMinutes(30) : silentDelay;
        return terminalAt != null && !terminalAt.plus(delay).isAfter(now);
    }
    boolean requeueWithFreshInput(String freshText, String freshContext, Instant now){
        if (!isReplayableFailure() || freshText == null || freshText.isBlank()) return false;
        String previousCode = lastErrorCode;
        safeReplayCount++;
        messageText = boundedMessage(freshText);
        conversationContext = boundedContext(freshContext);
        status = "QUEUED";
        replyAllowed = null;
        category = null;
        confidence = null;
        replyContent = null;
        resultReason = bounded("安全重试已通过最新会话复核并重新入队；上次失败码=" + (previousCode == null ? "UNKNOWN" : previousCode));
        attemptCount = 0;
        startedAt = null;
        processingToken = null;
        completedAt = null;
        nextAttemptAt = now;
        lastErrorCode = null;
        sendStatus = "PENDING";
        queueLane = QUEUE_ANALYSIS;
        sendDeviceId = null;
        sendLeaseTokenHash = null;
        sendLeaseUntil = null;
        sendClaimedAt = null;
        sendBeforeStateDigest = null;
        sendAfterStateDigest = null;
        sendReceiptDigest = null;
        sendResultReason = null;
        sendCompletedAt = null;
        updatedAt = now;
        return true;
    }
    InboundJobReplyService.Decision decision(){return new InboundJobReplyService.Decision(Boolean.TRUE.equals(replyAllowed),category==null?"UNCERTAIN":category,confidence==null?0:confidence,replyContent,resultReason==null?"任务尚未完成":resultReason);}
    boolean claimSend(UUID deviceId,String tokenHash,String beforeDigest,Instant now){if(!"READY".equals(sendStatus))return false;queueLane=QUEUE_SEND;sendStatus="CLAIMED";sendDeviceId=deviceId;sendLeaseTokenHash=tokenHash;sendBeforeStateDigest=beforeDigest;sendClaimedAt=now;sendLeaseUntil=now.plusSeconds(SEND_LEASE_SECONDS);updatedAt=now;return true;}
    boolean receiptSend(UUID deviceId,String outcome,String beforeDigest,String afterDigest,String receiptDigest,String reason,Instant now){if(!deviceId.equals(sendDeviceId))throw new IllegalStateException("发送租约不属于当前设备");if(!"CLAIMED".equals(sendStatus)){if(sendStatus.equals(outcome)&&java.util.Objects.equals(sendReceiptDigest,receiptDigest)&&java.util.Objects.equals(sendBeforeStateDigest,beforeDigest)&&java.util.Objects.equals(sendAfterStateDigest,afterDigest))return false;throw new IllegalStateException("发送租约已有不同结果，禁止覆盖");}if(now.isAfter(sendLeaseUntil)){expireSendLease(now);return true;}if("SUCCEEDED".equals(outcome)&&java.util.Objects.equals(beforeDigest,afterDigest))throw new IllegalStateException("发送成功回执必须包含页面状态变化");sendStatus=outcome;queueLane="FAILED".equals(outcome)?QUEUE_REVALIDATION:QUEUE_TERMINAL;sendBeforeStateDigest=beforeDigest;sendAfterStateDigest=afterDigest;sendReceiptDigest=receiptDigest;sendResultReason=bounded(reason);sendCompletedAt=now;updatedAt=now;return true;}
    boolean reconcileUnknownSend(UUID deviceId,String outboundDigest,String receiptDigest,Instant now){if(!deviceId.equals(sendDeviceId))throw new IllegalStateException("发送租约不属于当前设备");if("SUCCEEDED".equals(sendStatus))return false;if(!"UNKNOWN".equals(sendStatus)&&!"CLAIMED".equals(sendStatus))throw new IllegalStateException("只有结果不明的已领取发送任务可复核");if(sendBeforeStateDigest==null||sendBeforeStateDigest.equals(outboundDigest))throw new IllegalStateException("复核未提供新的出站消息证据");sendStatus="SUCCEEDED";queueLane=QUEUE_TERMINAL;sendAfterStateDigest=outboundDigest;sendReceiptDigest=receiptDigest;sendResultReason="页面延迟复核确认：同一会话出现与租约回复完全一致的新出站消息";sendCompletedAt=now;updatedAt=now;return true;}
    void expireSendLease(Instant now){if(!"CLAIMED".equals(sendStatus))return;sendStatus="UNKNOWN";queueLane=QUEUE_TERMINAL;sendResultReason="发送租约超时且未收到明确回执，已禁止重试";sendCompletedAt=now;updatedAt=now;}
    boolean expireReadySend(Instant cutoff,Instant now){if(!"READY".equals(sendStatus)||completedAt==null||!completedAt.isBefore(cutoff))return false;skipSend("AI 回复超过自动发送等待时限，已转交 HR 人工处理",now);return true;}
    void skipSend(String reason,Instant now){if(!"READY".equals(sendStatus))return;sendStatus="SKIPPED";queueLane=QUEUE_TERMINAL;sendResultReason=bounded(reason);sendCompletedAt=now;updatedAt=now;}
    void supersede(String reason,Instant now){if("CLAIMED".equals(sendStatus)||"SUCCEEDED".equals(sendStatus)||"UNKNOWN".equals(sendStatus))return;status="COMPLETED";queueLane=QUEUE_TERMINAL;replyAllowed=false;category="SUPERSEDED";confidence=0d;replyContent=null;resultReason=bounded(reason);sendStatus="SKIPPED";sendResultReason=bounded(reason);conversationContext=null;processingToken=null;nextAttemptAt=null;completedAt=now;sendCompletedAt=now;updatedAt=now;}
    private boolean isCurrentProcessing(String expectedProcessingToken){return "PROCESSING".equals(status)&&expectedProcessingToken!=null&&expectedProcessingToken.equals(processingToken);}
    private String bounded(String value){String clean=value==null?"处理失败":value.replace('\n',' ').replace('\r',' ').trim();return clean.substring(0,Math.min(300,clean.length()));}
    private String boundedMessage(String value){String clean=value.replace('\n',' ').replace('\r',' ').trim();return clean.substring(0,Math.min(1000,clean.length()));}
    private String boundedContext(String value){if(value==null||value.isBlank())return null;String clean=value.replace('\n',' ').replace('\r',' ').trim();return clean.substring(0,Math.min(2400,clean.length()));}
    private String boundedCode(String value){if(value==null||value.isBlank())return null;String clean=value.replace('\n',' ').replace('\r',' ').trim();return clean.substring(0,Math.min(80,clean.length()));}

    UUID getId(){return id;} UUID getAccountId(){return accountId;} UUID getObservationId(){return observationId;} UUID getJobPositionId(){return jobPositionId;}
    String getMessageText(){return messageText;} String getConversationContext(){return conversationContext;} String getStatus(){return status;} String getQueueLane(){return queueLane;} Instant getCreatedAt(){return createdAt;} Instant getStartedAt(){return startedAt;} String getProcessingToken(){return processingToken;} int getAttemptCount(){return attemptCount;} Instant getNextAttemptAt(){return nextAttemptAt;} String getLastErrorCode(){return lastErrorCode;} int getSafeReplayCount(){return safeReplayCount;}
    String getChatDigest(){return chatDigest;} String getMessageDigest(){return messageDigest;} String getReplyContent(){return replyContent;} String getCategory(){return category;} Double getConfidence(){return confidence;} String getResultReason(){return resultReason;} String getSendStatus(){return sendStatus;} String getSendResultReason(){return sendResultReason;} UUID getSendDeviceId(){return sendDeviceId;} String getSendLeaseTokenHash(){return sendLeaseTokenHash;} Instant getSendClaimedAt(){return sendClaimedAt;} Instant getSendLeaseUntil(){return sendLeaseUntil;} Instant getCompletedAt(){return completedAt;} Instant getSendCompletedAt(){return sendCompletedAt;} Instant getUpdatedAt(){return updatedAt;}
    boolean isPartialReply(){return resultReason!=null&&resultReason.startsWith("已部分回答，仍需 HR 补充：");}
    boolean isExpectedSilence(){return resultReason!=null&&resultReason.startsWith("正常静默：");}
    String dispositionCode(){
        if ("SUCCEEDED".equals(sendStatus)) return "REPLIED";
        if ("UNKNOWN".equals(sendStatus)) return "SEND_UNCONFIRMED";
        if ("CLAIMED".equals(sendStatus)) return "SENDING";
        if ("READY".equals(sendStatus)) return "READY_TO_SEND";
        if ("QUEUED".equals(status) || "PROCESSING".equals(status) || "RETRY_WAIT".equals(status))
            return "RETRY_WAIT".equals(status) ? "MODEL_RETRY_WAIT" : "AI_PROCESSING";
        if ("FAILED".equals(sendStatus)) return isReplayableFailure() ? "SEND_FAILED_RETRYABLE" : "SEND_FAILED_FINAL";
        if ("FAILED".equals(status)) return isReplayableFailure() ? "MODEL_FAILED_RETRYABLE" : "MODEL_FAILED_FINAL";
        if (isExpectedSilence()) return "EXPECTED_SILENCE";
        if ("INTERVIEW_COORDINATION".equals(category) || "INTERVIEW_COMPLETED".equals(category)) return "INTERVIEW_HR";
        if ("SUPERSEDED".equals(category) || (sendResultReason != null
                && (sendResultReason.contains("消息已变化") || sendResultReason.contains("岗位归属已变化"))))
            return "STALE_CONTEXT";
        if (resultReason != null && (resultReason.contains("岗位事实校验")
                || resultReason.contains("已审核岗位资料中没有可靠答案")
                || resultReason.contains("岗位回复资料尚未审核"))) return "FACT_UNVERIFIED";
        if ("TRUE_OFF_TOPIC".equals(category) || "UNRELATED".equals(category)) return "OFF_TOPIC";
        if ("SENSITIVE".equals(category)) return "SAFETY_BLOCKED";
        if (isReplayableFailure()) return "MODEL_INVALID_RETRYABLE";
        return "HUMAN_REVIEW";
    }
    boolean isResumeReceipt(){return "RESUME_RECEIPT".equals(purpose)||"RESUME_SENT".equals(category)||"[SYSTEM_RESUME_ATTACHMENT_RECEIPT]".equals(conversationContext);}
    boolean isShadowEvaluation(){return resultReason!=null&&resultReason.startsWith("影子评测：");}
    boolean wasReplyApproved(){return Boolean.TRUE.equals(replyAllowed)||isShadowEvaluation();}
}
