package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.common.AiUpstreamFailure;
import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.boss.BossAccountRepository;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobPositionRepository;
import ai.xzkj.recruitment.jobs.JobPositionStatus;
import ai.xzkj.recruitment.candidates.ConversationTimelineService;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import jakarta.annotation.PreDestroy;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;

import java.time.Instant;
import java.time.Duration;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** 持久化、按账号 FIFO 串行的入站 AI 回复队列；不同账号可并行。 */
@Service
class InboundAiReplyQueueService implements InboundReplyWorkGate {
    private static final long CLIENT_WAIT_NANOS = 125_000_000_000L;
    private final InboundAiReplyTaskRepository tasks;
    private final BrowserUnreadObservationRepository observations;
    private final BossAccountRepository accounts;
    private final JobPositionRepository jobs;
    private final InboundJobReplyService replies;
    private final TransactionTemplate transactions;
    private final MeterRegistry meters;
    private final JdbcTemplate jdbc;
    private final ConversationTimelineService timeline;
    private final AuditService audit;
    private final ExecutorService workers = Executors.newVirtualThreadPerTaskExecutor();
    private final InboundReplyExecutionCoordinator execution;
    private final SecureRandom random = new SecureRandom();
    @Value("${app.inbound-reply.queue-retention:P7D}")
    private Duration queueRetention = Duration.ofDays(7);
    @Value("${app.inbound-reply.max-pending-per-account:100}") private long maxPendingPerAccount = 100;
    @Value("${app.inbound-reply.max-pending-global:1000}") private long maxPendingGlobal = 1000;
    @Value("${app.inbound-reply.send-limit-per-hour:20}") private long sendLimitPerHour = 20;
    @Value("${app.inbound-reply.send-limit-per-day:100}") private long sendLimitPerDay = 100;
    @Value("${app.inbound-reply.auto-send-enabled:false}") private boolean autoSendEnabled;
    @Value("${app.inbound-reply.shadow-evaluation-enabled:false}") private boolean shadowEvaluationEnabled;
    @Value("${app.inbound-reply.silent-revalidation-delay:PT10S}") private Duration silentRevalidationDelay = Duration.ofSeconds(10);

    InboundAiReplyQueueService(InboundAiReplyTaskRepository tasks, BrowserUnreadObservationRepository observations,
                               BossAccountRepository accounts, JobPositionRepository jobs,
                               InboundJobReplyService replies, PlatformTransactionManager manager,
                               MeterRegistry meters, JdbcTemplate jdbc,
                               ConversationTimelineService timeline, AuditService audit,
                               @Value("${app.inbound-reply.model-concurrency:8}") int configuredModelConcurrency) {
        this.tasks = tasks; this.observations = observations; this.accounts = accounts; this.jobs = jobs; this.replies = replies;
        this.meters = meters;
        this.jdbc = jdbc;
        this.timeline = timeline;
        this.audit = audit;
        this.execution = new InboundReplyExecutionCoordinator(configuredModelConcurrency);
        this.transactions = new TransactionTemplate(manager);
        this.transactions.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        Gauge.builder("recruitment.inbound.reply.queue.depth", tasks,
                        repository -> repository.countByStatus("QUEUED") + repository.countByStatus("RETRY_WAIT"))
                .description("等待处理的入站 AI 回复任务数").register(meters);
        Gauge.builder("recruitment.inbound.reply.model.slots.available", execution,
                        InboundReplyExecutionCoordinator::availableModelSlots)
                .description("当前可用的 AI 并发槽位").register(meters);
        Gauge.builder("recruitment.inbound.reply.model.slots.capacity", execution,
                        InboundReplyExecutionCoordinator::modelConcurrency)
                .description("AI 回复模型并发槽位总数").register(meters);
        registerTaskGauge("recruitment.inbound.reply.processing", "PROCESSING", null,
                "正在调用 AI 的入站回复任务数");
        registerTaskGauge("recruitment.inbound.reply.retry.waiting", "RETRY_WAIT", null,
                "等待重试的入站回复任务数");
        registerTaskGauge("recruitment.inbound.reply.send.ready", null, "READY",
                "已生成且等待插件发送的回复数");
        registerTaskGauge("recruitment.inbound.reply.send.leased", null, "CLAIMED",
                "已签发发送租约且等待回执的回复数");
        registerTaskGauge("recruitment.inbound.reply.send.unknown", null, "UNKNOWN",
                "发送结果不确定、禁止自动重试的回复数");
        Gauge.builder("recruitment.inbound.reply.queue.oldest.seconds", this,
                        service -> service.oldestPendingSeconds())
                .description("最早等待处理任务的等待秒数；无等待任务时为 0").register(meters);
    }

    InboundJobReplyService.Decision enqueueAndAwait(UUID accountId, UUID observationId, UUID jobId,
                                                     String chatDigest, String messageDigest, String text) {
        return enqueueAndAwait(accountId, observationId, jobId, chatDigest, messageDigest, text, null);
    }

    InboundJobReplyService.Decision enqueueAndAwait(UUID accountId, UUID observationId, UUID jobId,
                                                     String chatDigest, String messageDigest, String text, String context) {
        UUID taskId = submit(accountId, observationId, jobId, chatDigest, messageDigest, text, context);
        long deadline = System.nanoTime() + CLIENT_WAIT_NANOS;
        while (System.nanoTime() < deadline) {
            InboundAiReplyTask current = transactions.execute(status -> tasks.findById(taskId).orElse(null));
            if (current == null) throw unavailable("AI_REPLY_TASK_MISSING", "AI 回复任务暂时不可用");
            if ("COMPLETED".equals(current.getStatus()) || "FAILED".equals(current.getStatus())) return current.decision();
            try { Thread.sleep(100); }
            catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw unavailable("AI_REPLY_WAIT_INTERRUPTED", "等待 AI 回复任务时被中断");
            }
        }
        meters.counter("recruitment.inbound.reply.wait.timeout").increment();
        throw unavailable("AI_REPLY_WAIT_TIMEOUT", "AI 回复任务仍在队列中，插件稍后将重试");
    }

    UUID submit(UUID accountId, UUID observationId, UUID jobId, String chatDigest,
                String messageDigest, String text) {
        return submit(accountId, observationId, jobId, chatDigest, messageDigest, text, null);
    }

    UUID submit(UUID accountId, UUID observationId, UUID jobId, String chatDigest,
                String messageDigest, String text, String context) {
        InboundAiReplyTask submitted = transactions.execute(status ->
                enqueue(accountId, observationId, jobId, chatDigest, messageDigest, text, context));
        if (submitted == null) throw unavailable("AI_REPLY_QUEUE_ENQUEUE_FAILED", "AI 回复任务入队失败，稍后将重试");
        triggerDrain(accountId);
        return submitted.getId();
    }

    List<InboundReplyRetryCandidateResponse> retryable(UUID accountId) {
        Instant now = Instant.now();
        return transactions.execute(status -> tasks
                // 库存复核只能在当前账号没有正常排队、模型处理中或等待退避的
                // 新任务时启动，避免历史消息抢占实时求职者消息。
                .countByAccountIdAndStatusIn(accountId, List.of("QUEUED", "PROCESSING", "RETRY_WAIT")) > 0
                ? List.<InboundReplyRetryCandidateResponse>of()
                : tasks.findSafeReplayInventory(accountId)
                .stream()
                .filter(task -> task.isReplayableFailure(now, silentRevalidationDelay))
                .filter(task -> observations.findById(task.getObservationId()).map(observation ->
                        (!task.isExpectedSilence() || !observation.isSelectedConversationUnread())
                                && task.getChatDigest().equals(observation.getChatDigest())
                                && task.getMessageDigest().equals(observation.getLatestMessageDigest())
                                && "INBOUND".equals(observation.getLatestDirection())
                                && task.getJobPositionId().equals(observation.getMatchedJobPositionId()))
                        .orElse(false))
                .map(task -> new InboundReplyRetryCandidateResponse(task.getId(), task.getChatDigest(),
                        task.getMessageDigest(), task.getLastErrorCode(), task.getAttemptCount(), task.getUpdatedAt()))
                .toList());
    }

    InboundReplyTaskAcceptedResponse retryFailed(UUID accountId, UUID taskId, UUID observationId, UUID jobId,
                                                   String chatDigest, String messageDigest, String text, String context) {
        InboundReplyTaskAcceptedResponse accepted = transactions.execute(status -> {
            InboundAiReplyTask task = tasks.findForUpdateById(taskId).orElse(null);
            if (task == null || !accountId.equals(task.getAccountId()))
                throw new ApiException(HttpStatus.NOT_FOUND, "AI_REPLY_TASK_NOT_FOUND", "AI 回复任务不存在");
            if (!observationId.equals(task.getObservationId()) || !jobId.equals(task.getJobPositionId())
                    || !chatDigest.equals(task.getChatDigest()) || !messageDigest.equals(task.getMessageDigest()))
                throw new ApiException(HttpStatus.CONFLICT, "AI_REPLY_RETRY_TARGET_MISMATCH", "重试目标与当前会话不一致，已拒绝重试");
            if (!task.isReplayableFailure(Instant.now(), silentRevalidationDelay))
                throw new ApiException(HttpStatus.CONFLICT, "AI_REPLY_RETRY_NOT_ALLOWED", "该失败任务不是可安全重试类型，已保持终态");
            BrowserUnreadObservation observation = observations.findById(task.getObservationId()).orElse(null);
            if (task.isExpectedSilence() && observation != null && observation.isSelectedConversationUnread())
                throw new ApiException(HttpStatus.CONFLICT, "AI_REPLY_RETRY_READ_REQUIRED", "静默复核只允许已读且没有新消息的会话");
            long accountOutstanding = tasks.countByAccountIdAndStatusIn(accountId, List.of("QUEUED", "PROCESSING", "RETRY_WAIT"))
                    + tasks.countByAccountIdAndSendStatus(accountId, "READY")
                    + tasks.countByAccountIdAndSendStatus(accountId, "CLAIMED");
            long globalOutstanding = tasks.countByStatusIn(List.of("QUEUED", "PROCESSING", "RETRY_WAIT"))
                    + tasks.countBySendStatus("READY") + tasks.countBySendStatus("CLAIMED");
            if (accountOutstanding >= maxPendingPerAccount)
                throw unavailable("AI_REPLY_ACCOUNT_QUEUE_FULL", "当前招聘账号的 AI 回复队列已满，请稍后重试");
            if (globalOutstanding >= maxPendingGlobal)
                throw unavailable("AI_REPLY_GLOBAL_QUEUE_FULL", "AI 回复系统当前繁忙，请稍后重试");
            if (!task.requeueWithFreshInput(text, context, Instant.now()))
                throw new ApiException(HttpStatus.CONFLICT, "AI_REPLY_RETRY_INPUT_INVALID", "重试必须提供当前会话最新的非空消息正文");
            tasks.flush();
            return new InboundReplyTaskAcceptedResponse(task.getId(), "QUEUED", null);
        });
        if (accepted == null) throw unavailable("AI_REPLY_RETRY_ENQUEUE_FAILED", "失败任务重新入队失败，请稍后重试");
        meters.counter("recruitment.inbound.reply.requeued", "reason", "fresh_message").increment();
        triggerDrain(accountId);
        return accepted;
    }

    InboundReplyTaskStatusResponse status(UUID accountId, UUID taskId) {
        InboundAiReplyTask task = transactions.execute(status -> tasks.findById(taskId).orElse(null));
        if (task == null || !accountId.equals(task.getAccountId()))
            throw new ApiException(HttpStatus.NOT_FOUND, "AI_REPLY_TASK_NOT_FOUND", "AI 回复任务不存在");
        InboundReplyDecisionResponse decision = null;
        if ("COMPLETED".equals(task.getStatus()) || "FAILED".equals(task.getStatus())) {
            InboundJobReplyService.Decision value = task.decision();
            decision = new InboundReplyDecisionResponse(value.replyAllowed(), value.category(), value.confidence(), value.content(), value.reason());
        }
        return new InboundReplyTaskStatusResponse(task.getId(), task.getStatus(), decision,
                task.getAttemptCount(), task.getNextAttemptAt(), task.getLastErrorCode(), task.getResultReason(),
                task.getSendStatus(), task.getSendResultReason());
    }

    List<InboundAiReplyTask> recentSuccessfulSends() {
        return tasks.findTop100BySendStatusOrderBySendCompletedAtDesc("SUCCEEDED");
    }
    List<InboundAiReplyTask> recentSkippedReplies() {
        return tasks.findTop100BySendStatusOrderByCompletedAtDesc("SKIPPED");
    }
    List<InboundAiReplyTask> recentDecisions(Instant since) {
        return tasks.findTop500ByCompletedAtAfterOrderByCompletedAtDesc(since);
    }
    List<InboundAiReplyTask> recentEvents(Instant since) {
        return tasks.findTop500ByUpdatedAtAfterOrderByUpdatedAtDesc(since);
    }

    @Override
    public boolean hasPendingWork(UUID accountId) {
        if (accountId == null) return false;
        return tasks.countByAccountIdAndStatusIn(accountId, List.of("QUEUED", "PROCESSING", "RETRY_WAIT")) > 0
                // READY means the AI decision is already complete; do not let a
                // human-review draft starve the independent resume worker.
                || tasks.countByAccountIdAndSendStatus(accountId, "CLAIMED") > 0;
    }

    InboundReplyTaskDiscardResponse discardStale(UUID accountId, UUID taskId, InboundReplyTaskDiscardRequest request) {
        return transactions.execute(status -> {
            InboundAiReplyTask task = tasks.findForUpdateById(taskId).orElse(null);
            if (task == null || !accountId.equals(task.getAccountId()))
                throw new ApiException(HttpStatus.NOT_FOUND,"AI_REPLY_TASK_NOT_FOUND","AI 回复任务不存在");
            if (!request.chatDigest().equals(task.getChatDigest()) || !request.messageDigest().equals(task.getMessageDigest()))
                throw new ApiException(HttpStatus.CONFLICT,"AI_REPLY_DISCARD_TARGET_MISMATCH","待作废任务与原消息不一致");
            if (request.currentMessageDigest().equals(request.messageDigest()))
                throw new ApiException(HttpStatus.CONFLICT,"AI_REPLY_DISCARD_MESSAGE_UNCHANGED","候选人最新消息尚未变化，禁止作废待发送回复");
            Instant now=Instant.now();
            task.supersede(request.reason(),now);
            meters.counter("recruitment.inbound.reply.send.discarded","reason","message_changed").increment();
            return new InboundReplyTaskDiscardResponse(task.getId(),task.getSendStatus(),now);
        });
    }

    InboundReplySendClaimResponse claimSend(UUID accountId, UUID deviceId, InboundReplySendClaimRequest request) {
        return transactions.execute(status -> {
            if (accounts.findForUpdateById(accountId).isEmpty())
                throw new ApiException(HttpStatus.NOT_FOUND,"BOSS_ACCOUNT_NOT_FOUND","招聘账号不存在");
            InboundAiReplyTask task = tasks.findForUpdateById(request.taskId()).orElse(null);
            if (task == null || !accountId.equals(task.getAccountId()))
                throw new ApiException(HttpStatus.NOT_FOUND, "AI_REPLY_TASK_NOT_FOUND", "AI 回复任务不存在");
            if (!request.chatDigest().equals(task.getChatDigest()) || !request.messageDigest().equals(task.getMessageDigest()))
                throw new ApiException(HttpStatus.CONFLICT, "AI_REPLY_SEND_TARGET_MISMATCH", "发送目标与 AI 任务不一致");
            JobPosition job = jobs.findWithDetailsById(task.getJobPositionId()).orElse(null);
            if (job == null || job.getStatus() != JobPositionStatus.ACTIVE || !accountId.equals(job.getBossAccount().getId())) {
                task.skipSend("AI 分析后岗位已停用或归属发生变化，已禁止发送", Instant.now());
                return new InboundReplySendClaimResponse(false, task.getId(), null, null, null, null,
                        "SKIPPED", "AI 分析后岗位已停用或归属发生变化，已禁止发送");
            }
            if (!"READY".equals(task.getSendStatus()))
                return new InboundReplySendClaimResponse(false, task.getId(), null, null, null, null,
                        task.getSendStatus(), "该 AI 回复已领取、已处理或不允许再发送");
            if (!autoSendEnabled)
                return new InboundReplySendClaimResponse(false,task.getId(),null,null,null,null,
                        task.getSendStatus(),"后端 AI 自动发送总开关已关闭，任务继续保留等待");
            Instant now = Instant.now();
            long sentLastHour = tasks.countByAccountIdAndSendStatusAndSendCompletedAtAfter(accountId,"SUCCEEDED",now.minus(Duration.ofHours(1)));
            long sentLastDay = tasks.countByAccountIdAndSendStatusAndSendCompletedAtAfter(accountId,"SUCCEEDED",now.minus(Duration.ofDays(1)));
            if (sentLastHour >= sendLimitPerHour || sentLastDay >= sendLimitPerDay) {
                meters.counter("recruitment.inbound.reply.send.rate_limited").increment();
                return new InboundReplySendClaimResponse(false,task.getId(),null,null,null,null,
                        task.getSendStatus(),"已达到账号发送安全上限，回复已保留，待额度窗口恢复后再领取");
            }
            String raw = token();
            task.claimSend(deviceId, hash(raw), request.beforeStateDigest(), now);
            return new InboundReplySendClaimResponse(true, task.getId(), raw, task.getReplyContent(),
                    hash(task.getReplyContent()), task.getSendLeaseUntil(), task.getSendStatus(), "45 秒单次发送租约已签发");
        });
    }

    InboundReplySendReceiptResponse receiptSend(UUID accountId, UUID deviceId, InboundReplySendReceiptRequest request) {
        InboundReplySendReceiptResponse response = transactions.execute(status -> {
            InboundAiReplyTask task = tasks.findForUpdateBySendLeaseTokenHash(hash(request.leaseToken())).orElseThrow(() ->
                    new ApiException(HttpStatus.UNAUTHORIZED, "AI_REPLY_SEND_LEASE_INVALID", "AI 回复发送租约无效"));
            if (!accountId.equals(task.getAccountId()))
                throw new ApiException(HttpStatus.FORBIDDEN, "AI_REPLY_SEND_ACCOUNT_MISMATCH", "AI 回复发送租约不属于当前账号");
            try {
                task.receiptSend(deviceId, request.outcome(), request.beforeStateDigest(), request.afterStateDigest(),
                        request.receiptDigest(), request.reason(), Instant.now());
                try {
                    JobPosition job = jobs.findWithDetailsById(task.getJobPositionId()).orElse(null);
                    timeline.recordAiSendReceipt(task.getAccountId(), task.getJobPositionId(), task.getChatDigest(),
                            task.getId(), request.outcome(), job);
                } catch (RuntimeException timelineError) {
                    meters.counter("recruitment.conversation.timeline.write.failure", "stage", "ai_receipt").increment();
                }
                meters.counter("recruitment.inbound.reply.send.receipt", "outcome", request.outcome()).increment();
                return new InboundReplySendReceiptResponse(task.getId(), task.getSendStatus(), task.getSendCompletedAt());
            } catch (IllegalStateException conflict) {
                throw new ApiException(HttpStatus.CONFLICT, "AI_REPLY_SEND_RECEIPT_CONFLICT", conflict.getMessage());
            }
        });
        if ("UNKNOWN".equals(request.outcome()) || "FAILED".equals(request.outcome())) {
            recordAiProblem("AI_REPLY_SEND_" + request.outcome(), response == null ? null : response.taskId(),
                    "SEND_" + request.outcome(), request.reason());
        }
        return response;
    }

    private InboundAiReplyTask enqueue(UUID accountId, UUID observationId, UUID jobId,
                                       String chatDigest, String messageDigest, String text, String context) {
        InboundAiReplyTask existing = tasks.findByAccountIdAndChatDigestAndMessageDigest(accountId, chatDigest, messageDigest).orElse(null);
        if (existing != null) return existing;
        // PostgreSQL transaction advisory lock: serialize only the short global capacity check + insert.
        // It is released automatically at transaction end and never surrounds the external AI request.
        jdbc.query("SELECT pg_advisory_xact_lock(742025)", resultSet -> null);
        existing = tasks.findByAccountIdAndChatDigestAndMessageDigest(accountId, chatDigest, messageDigest).orElse(null);
        if (existing != null) return existing;
        List<String> pending = List.of("QUEUED","PROCESSING","RETRY_WAIT");
        long accountOutstanding = tasks.countByAccountIdAndStatusIn(accountId,pending)
                + tasks.countByAccountIdAndSendStatus(accountId,"READY")
                + tasks.countByAccountIdAndSendStatus(accountId,"CLAIMED");
        long globalOutstanding = tasks.countByStatusIn(pending)
                + tasks.countBySendStatus("READY") + tasks.countBySendStatus("CLAIMED");
        if (accountOutstanding >= maxPendingPerAccount)
            throw unavailable("AI_REPLY_ACCOUNT_QUEUE_FULL","当前招聘账号的 AI 回复队列已满，请稍后重试");
        if (globalOutstanding >= maxPendingGlobal)
            throw unavailable("AI_REPLY_GLOBAL_QUEUE_FULL","AI 回复系统当前繁忙，请稍后重试");
        try {
            InboundAiReplyTask created = tasks.saveAndFlush(new InboundAiReplyTask(accountId, observationId, jobId, chatDigest, messageDigest, text, context, Instant.now()));
            meters.counter("recruitment.inbound.reply.enqueued").increment();
            return created;
        } catch (DataIntegrityViolationException duplicate) {
            return tasks.findByAccountIdAndChatDigestAndMessageDigest(accountId, chatDigest, messageDigest).orElse(null);
        }
    }

    private void drain(UUID accountId) {
        if (!execution.tryEnterAccount(accountId)) return;
        try {
            while (true) {
                InboundAiReplyTask task;
                try {
                    task = transactions.execute(status -> {
                        if (tasks.existsByAccountIdAndStatus(accountId, "RETRY_WAIT")
                                || tasks.existsByAccountIdAndStatus(accountId, "PROCESSING")) return null;
                        InboundAiReplyTask next = tasks.findFirstByAccountIdAndStatusOrderByCreatedAtAsc(accountId, "QUEUED").orElse(null);
                        if (next != null) {
                            next.start(Instant.now());
                            tasks.flush();
                        }
                        return next;
                    });
                } catch (DataIntegrityViolationException | ConcurrencyFailureException claimedByAnotherInstance) {
                    meters.counter("recruitment.inbound.reply.claim.conflict").increment();
                    return;
                }
                if (task == null) return;
                try {
                    JobPosition job = jobs.findWithDetailsById(task.getJobPositionId()).orElse(null);
                    if (job == null) { fail(task.getId(), "INBOUND_REPLY_JOB_MISSING", "队列任务对应岗位已不存在"); continue; }
                    InboundJobReplyService.Decision evaluated;
                    Timer.Sample modelTimer = Timer.start(meters);
                    execution.acquireModelSlot();
                    try {
                        InboundJobReplyService.ConversationRuntime runtime = observations.findById(task.getObservationId())
                                .map(value -> InboundJobReplyService.ConversationRuntime.from(
                                        value.getConversationStage(), value.getConversationSignals()))
                                .orElseGet(InboundJobReplyService.ConversationRuntime::empty);
                        evaluated = replies.decide(job, task.getMessageText(), task.getConversationContext(), runtime);
                    }
                    finally {
                        execution.releaseModelSlot();
                        modelTimer.stop(Timer.builder("recruitment.inbound.reply.model.duration")
                                .description("AI 理解与受控生成耗时").register(meters));
                    }
                    recordDecisionMetrics(evaluated);
                    if (!evaluated.replyAllowed() && evaluated.retryable()) {
                        String reason = "AI 输出质量问题，准备有限重试：" + evaluated.reason();
                        meters.counter("recruitment.inbound.reply.decision.retryable",
                                "reason", InboundReplyQualityGate.reasonCode(evaluated)).increment();
                        retry(task.getId(), "AI_OUTPUT_INVALID", reason);
                        continue;
                    }
                    InboundJobReplyService.Decision decision = shadowEvaluationEnabled
                            ? evaluated.asShadowEvaluation()
                            : evaluated;
                    Instant completedAt = Instant.now();
                    transactions.executeWithoutResult(status -> tasks.findById(task.getId())
                            .ifPresent(value -> value.complete(decision, completedAt)));
                    if (!decision.replyAllowed()) {
                        recordAiSkip(task.getId(), decision.category(), decision.reason());
                    }
                    try {
                        timeline.recordAiReply(task.getAccountId(), task.getJobPositionId(), task.getChatDigest(),
                                task.getId(), decision.replyAllowed(), decision.content(), completedAt, job);
                    } catch (RuntimeException timelineError) {
                        meters.counter("recruitment.conversation.timeline.write.failure", "stage", "ai_reply").increment();
                    }
                    meters.counter("recruitment.inbound.reply.completed", "allowed", Boolean.toString(decision.replyAllowed())).increment();
                } catch (Exception error) {
                    String code = errorCode(error);
                    String reason = "AI 回复任务处理失败：" + safe(error);
                    if (!isRetryable(error, code)) {
                        fail(task.getId(), code, reason);
                        continue;
                    }
                    if (!retry(task.getId(), code, reason)) return;
                    return;
                }
            }
        } finally {
            execution.leaveAccount(accountId);
        }
    }

    private void triggerDrain(UUID accountId) {
        workers.submit(() -> drain(accountId));
    }

    private boolean retry(UUID id, String code, String reason) {
        boolean[] scheduled = {false};
        transactions.executeWithoutResult(status -> tasks.findById(id)
                .ifPresent(value -> scheduled[0] = value.retry(code, reason, Instant.now())));
        if (scheduled[0]) {
            meters.counter("recruitment.inbound.reply.retry", "code", code).increment();
            recordAiProblem("AI_REPLY_RETRY_SCHEDULED", id, code, reason);
        }
        return scheduled[0];
    }
    private void fail(UUID id, String code, String reason) {
        transactions.executeWithoutResult(status -> tasks.findById(id)
                .ifPresent(value -> value.fail(code, reason, Instant.now())));
        meters.counter("recruitment.inbound.reply.failed", "reason", safeCategory(code)).increment();
        recordAiProblem("AI_REPLY_TASK_FAILED", id, code, reason);
    }

    private void recordAiProblem(String action, UUID taskId, String code, String reason) {
        try {
            audit.systemFailure(action, "INBOUND_AI_REPLY_TASK", taskId,
                    code == null ? "AI 自动回复问题" : code,
                    "task=" + (taskId == null ? "UNKNOWN" : taskId) + " | code=" + (code == null ? "UNKNOWN" : code)
                            + " | " + (reason == null || reason.isBlank() ? "未记录具体原因" : reason));
        } catch (RuntimeException auditFailure) {
            meters.counter("recruitment.inbound.reply.problem.log.failure").increment();
        }
    }

    private void recordAiSkip(UUID taskId, String category, String reason) {
        try {
            audit.systemSuccess("AI_REPLY_SAFETY_SKIPPED", "INBOUND_AI_REPLY_TASK", taskId,
                    category == null ? "AI 安全跳过" : category,
                    "task=" + taskId + " | category=" + (category == null ? "UNKNOWN" : category)
                            + " | " + (reason == null || reason.isBlank() ? "AI 决定不自动回复" : reason));
        } catch (RuntimeException auditFailure) {
            meters.counter("recruitment.inbound.reply.problem.log.failure").increment();
        }
    }

    private boolean isRetryable(Exception error, String code) {
        if (error instanceof AiUpstreamFailure upstream) return upstream.isRetryable();
        return Set.of("AI_OUTPUT_INVALID", "INBOUND_REPLY_AI_REQUEST_FAILED", "INBOUND_REPLY_AI_INVALID",
                "INBOUND_REPLY_AI_INVALID_RESULT", "INBOUND_REPLY_AI_OUTPUT_MISSING", "INBOUND_REPLY_AI_TIMEOUT")
                .contains(code);
    }

    @Scheduled(fixedDelayString = "${app.inbound-reply.queue-recovery-interval:5s}",
            initialDelayString = "${app.inbound-reply.queue-recovery-interval:5s}")
    void recover() {
        Instant now = Instant.now();
        transactions.executeWithoutResult(status -> {
            tasks.findByStatusAndStartedAtBefore("PROCESSING", now.minusSeconds(180)).forEach(task -> task.recoverIfStale(now));
            tasks.findTop100ByStatusAndNextAttemptAtBeforeOrderByNextAttemptAtAsc("RETRY_WAIT", now).forEach(task -> task.releaseRetry(now));
            tasks.findBySendStatusAndSendLeaseUntilBefore("CLAIMED", now).forEach(task -> task.expireSendLease(now));
            tasks.findTop100BySendStatusOrderByCompletedAtDesc("READY").forEach(task -> {
                BrowserUnreadObservation observation = observations.findById(task.getObservationId()).orElse(null);
                if (observation == null) {
                    task.skipSend("原会话观察记录已不存在，待发送回复已安全作废", now);
                } else if (!observation.isUnread() || !"INBOUND".equals(observation.getLatestDirection())) {
                    task.skipSend("会话已由 HR 处理或已不再处于候选人未读状态，待发送回复已安全作废", now);
                } else if (!task.getMessageDigest().equals(observation.getLatestMessageDigest())
                        || !task.getJobPositionId().equals(observation.getMatchedJobPositionId())) {
                    task.skipSend("候选人最新消息或岗位归属已变化，旧待发送回复已安全作废", now);
                }
            });
        });
        Set<UUID> accounts = ConcurrentHashMap.newKeySet();
        transactions.execute(status -> {
            tasks.findTop100ByStatusOrderByCreatedAtAsc("QUEUED").forEach(task -> accounts.add(task.getAccountId()));
            return null;
        });
        accounts.forEach(this::triggerDrain);
    }

    @Scheduled(fixedDelayString = "${app.inbound-reply.queue-cleanup-interval:1h}",
            initialDelayString = "${app.inbound-reply.queue-cleanup-initial-delay:1m}")
    void cleanupHistory() {
        Instant cutoff = Instant.now().minus(queueRetention);
        transactions.executeWithoutResult(status -> jdbc.update("""
                DELETE FROM inbound_ai_reply_tasks
                WHERE (status = 'FAILED' AND completed_at < ?)
                   OR (status = 'COMPLETED'
                       AND send_status IN ('SKIPPED','SUCCEEDED','FAILED','UNKNOWN')
                       AND COALESCE(send_completed_at, completed_at) < ?)
                """, java.sql.Timestamp.from(cutoff), java.sql.Timestamp.from(cutoff)));
    }

    @PreDestroy
    void shutdownWorkers() {
        workers.shutdown();
        try {
            if (!workers.awaitTermination(65, TimeUnit.SECONDS)) workers.shutdownNow();
        } catch (InterruptedException interrupted) {
            workers.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    private ApiException unavailable(String code, String message) {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, code, message);
    }
    private void registerTaskGauge(String name, String status, String sendStatus, String description) {
        Gauge.builder(name, tasks, repository -> status != null
                        ? repository.countByStatus(status)
                        : repository.countBySendStatus(sendStatus))
                .description(description).register(meters);
    }
    private void recordDecisionMetrics(InboundJobReplyService.Decision decision) {
        String outcome = decision.replyAllowed() ? "ALLOWED"
                : decision.retryable() ? "RETRYABLE"
                : decision.reason() != null && decision.reason().startsWith("正常静默：") ? "EXPECTED_SILENCE"
                : "BLOCKED";
        meters.counter("recruitment.inbound.reply.decision",
                "category", safeCategory(decision.category()),
                "outcome", outcome,
                "reason", InboundReplyQualityGate.reasonCode(decision)).increment();
    }
    private String safeCategory(String value) {
        if (value == null || !value.matches("[A-Z_]{2,40}")) return "UNKNOWN";
        return value;
    }
    private double oldestPendingSeconds() {
        Long seconds = jdbc.queryForObject("""
                SELECT COALESCE(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(created_at)))::bigint, 0)
                FROM inbound_ai_reply_tasks
                WHERE status IN ('QUEUED','RETRY_WAIT')
                """, Long.class);
        return seconds == null ? 0 : Math.max(0, seconds);
    }
    private String errorCode(Exception error) {
        return error instanceof ApiException api ? api.getCode() : error.getClass().getSimpleName().toUpperCase();
    }
    private String safe(Exception error) {
        String value = error.getMessage();
        if (value == null || value.isBlank()) value = error.getClass().getSimpleName();
        value = value.replace('\n', ' ').replace('\r', ' ').trim();
        return value.substring(0, Math.min(240, value.length()));
    }
    private String token() { byte[] value=new byte[32];random.nextBytes(value);return Base64.getUrlEncoder().withoutPadding().encodeToString(value); }
    private String hash(String value) { try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}catch(Exception error){throw new IllegalStateException(error);} }
}
