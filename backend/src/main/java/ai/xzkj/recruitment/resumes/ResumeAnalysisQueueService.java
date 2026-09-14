package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.localconnector.InboundReplyWorkGate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import jakarta.annotation.PreDestroy;

import java.time.Instant;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;

/**
 * 简历后台分析队列。文件提取与会话回复完全解耦，数据库状态负责恢复，
 * 分析 worker 使用有界并发；服务重启后会继续处理未完成任务。
 */
@Service
public class ResumeAnalysisQueueService {
    private final ResumeIntakeRepository intakes;
    private final AutomatedResumeAnalysisService analysis;
    private final InboundReplyWorkGate replyWork;
    private final TransactionTemplate transactions;
    private final ExecutorService worker = Executors.newVirtualThreadPerTaskExecutor();
    private final Semaphore analysisSlots;
    @Value("${app.resume.analysis-queue.enabled:true}") private boolean enabled;
    @Value("${app.resume.analysis-queue.max-reply-priority-wait:0s}") private Duration maxReplyPriorityWait = Duration.ZERO;

    public ResumeAnalysisQueueService(ResumeIntakeRepository intakes,
                                      AutomatedResumeAnalysisService analysis,
                                      InboundReplyWorkGate replyWork,
                                      PlatformTransactionManager manager,
                                      @Value("${app.resume.analysis-queue.concurrency:2}") int configuredConcurrency) {
        this.intakes = intakes;
        this.analysis = analysis;
        this.replyWork = replyWork;
        this.transactions = new TransactionTemplate(manager);
        this.transactions.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.analysisSlots = new Semaphore(Math.max(1, Math.min(configuredConcurrency, 8)), true);
    }

    /** 在提取成功的同一事务中调用，确保简历不会因进程重启而丢失。 */
    public void enqueue(ResumeIntake intake) {
        intake.queueAnalysis(Instant.now());
    }

    @Scheduled(fixedDelayString = "${app.resume.analysis-queue.poll-interval:2s}",
            initialDelayString = "${app.resume.analysis-queue.initial-delay:5s}")
    public void scheduleDrain() {
        if (!enabled) return;
        while (analysisSlots.tryAcquire()) {
            UUID intakeId;
            try {
                intakeId = claimNext();
            } catch (RuntimeException error) {
                analysisSlots.release();
                throw error;
            }
            if (intakeId == null) {
                analysisSlots.release();
                return;
            }
            UUID claimedIntakeId = intakeId;
            worker.execute(() -> {
                try {
                    process(claimedIntakeId);
                } finally {
                    analysisSlots.release();
                }
            });
        }
    }

    private UUID claimNext() {
        return transactions.execute(status -> {
            Instant now = Instant.now();
            for (ResumeIntake stale : intakes.findExpiredAnalysisLeases(now, PageRequest.of(0, 20))) {
                stale.recoverAnalysisLease(now);
            }
            var due = intakes.findDueForAnalysis(now, PageRequest.of(0, 1));
            if (due.isEmpty()) return null;
            ResumeIntake intake = due.get(0);
            if (!intake.claimAnalysis(now)) return null;
            return intake.getId();
        });
    }

    private boolean process(UUID intakeId) {
        Boolean processed = false;
        try {
            processed = transactions.execute(status -> {
                ResumeIntake intake = intakes.findWithDetailsById(intakeId).orElse(null);
                if (intake == null) return true;
                Instant now = Instant.now();
                boolean insideReplyPriorityWindow = maxReplyPriorityWait != null && !maxReplyPriorityWait.isZero()
                        && !maxReplyPriorityWait.isNegative() && intake.getAnalysisQueueQueuedAt() != null
                        && intake.getAnalysisQueueQueuedAt().plus(maxReplyPriorityWait).isAfter(now);
                if (insideReplyPriorityWindow && replyWork.hasPendingWork(intake.getContact().getBossAccount().getId())) return false;
                String text = intake.getExtractedText();
                if (text == null || text.isBlank()) {
                    intake.analysisUnavailable("FAILED", "RESUME_TEXT_NOT_AVAILABLE", "简历提取文本不存在，无法进行 AI 分析", Instant.now());
                } else {
                    analysis.analyzeInMemory(intake, text);
                }
                return true;
            });
        } catch (RuntimeException error) {
            // 不能把异常任务当成普通 defer，否则会绕过 attempt 上限形成无限循环。
            transactions.execute(status -> {
                ResumeIntake intake = intakes.findById(intakeId).orElse(null);
                if (intake != null) {
                    intake.analysisUnavailable("FAILED", "RESUME_ANALYSIS_WORKER_EXCEPTION",
                            "简历分析 worker 异常：" + safe(error), Instant.now());
                }
                return null;
            });
            finalizeTask(intakeId);
            return true;
        }
        if (!Boolean.TRUE.equals(processed)) {
            transactions.execute(status -> {
                ResumeIntake intake = intakes.findById(intakeId).orElse(null);
                if (intake != null) intake.deferAnalysisForReplyPriority(Instant.now());
                return null;
            });
            // Continue with another due intake. The deferred item is hidden for
            // five seconds and its attempt budget was restored.
            return true;
        }
        finalizeTask(intakeId);
        return true;
    }

    private void finalizeTask(UUID intakeId) {
        transactions.execute(status -> {
            ResumeIntake intake = intakes.findById(intakeId).orElse(null);
            if (intake == null) return null;
            Instant now = Instant.now();
            if ("SUCCEEDED".equals(intake.getAnalysisStatus())) {
                intake.completeAnalysisQueue(now);
            } else if ("NOT_AUTHORIZED".equals(intake.getAnalysisStatus())
                    || "NOT_CONFIGURED".equals(intake.getAnalysisStatus())
                    || "ACTIVE_JOB_REQUIRED".equals(intake.getAnalysisFailureCode())
                    || "RESUME_TEXT_NOT_AVAILABLE".equals(intake.getAnalysisFailureCode())
                    || isNonRetryableProviderFailure(intake.getAnalysisFailureCode())) {
                intake.failAnalysisQueue(intake.getAnalysisFailureReason(), now);
            } else if (!intake.retryAnalysisQueue(
                    intake.getAnalysisFailureReason() == null ? "AI 分析未完成" : intake.getAnalysisFailureReason(), now)) {
                // retryAnalysisQueue 已将任务转为 FAILED。
            }
            return null;
        });
    }

    private boolean isNonRetryableProviderFailure(String code) {
        return switch (code == null ? "" : code) {
            case "OPENAI_NOT_CONFIGURED", "OPENAI_CONFIGURATION_REQUIRED", "OPENAI_AUTH_FAILED",
                    "OPENAI_MODEL_INVALID", "OPENAI_BASE_URL_INVALID" -> true;
            default -> false;
        };
    }

    private String safe(Exception error) {
        String value = error == null ? "未知异常" : error.getMessage();
        if (value == null || value.isBlank()) value = error == null ? "未知异常" : error.getClass().getSimpleName();
        value = value.replace('\n', ' ').replace('\r', ' ').trim();
        return value.substring(0, Math.min(240, value.length()));
    }

    @PreDestroy
    void shutdown() {
        worker.shutdownNow();
    }
}
