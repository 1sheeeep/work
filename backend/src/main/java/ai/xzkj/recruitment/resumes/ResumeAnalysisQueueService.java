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
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 简历后台分析队列。文件提取与会话回复完全解耦，数据库状态负责恢复，
 * 同一实例始终只运行一个分析 worker；服务重启后会继续处理未完成任务。
 */
@Service
public class ResumeAnalysisQueueService {
    private final ResumeIntakeRepository intakes;
    private final AutomatedResumeAnalysisService analysis;
    private final InboundReplyWorkGate replyWork;
    private final TransactionTemplate transactions;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean draining = new AtomicBoolean();
    @Value("${app.resume.analysis-queue.enabled:true}") private boolean enabled;

    public ResumeAnalysisQueueService(ResumeIntakeRepository intakes,
                                      AutomatedResumeAnalysisService analysis,
                                      InboundReplyWorkGate replyWork,
                                      PlatformTransactionManager manager) {
        this.intakes = intakes;
        this.analysis = analysis;
        this.replyWork = replyWork;
        this.transactions = new TransactionTemplate(manager);
        this.transactions.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** 在提取成功的同一事务中调用，确保简历不会因进程重启而丢失。 */
    public void enqueue(ResumeIntake intake) {
        intake.queueAnalysis(Instant.now());
    }

    @Scheduled(fixedDelayString = "${app.resume.analysis-queue.poll-interval:2s}",
            initialDelayString = "${app.resume.analysis-queue.initial-delay:5s}")
    public void scheduleDrain() {
        if (!enabled || !draining.compareAndSet(false, true)) return;
        worker.execute(() -> {
            try {
                drain();
            } finally {
                draining.set(false);
            }
        });
    }

    private void drain() {
        while (enabled) {
            UUID intakeId = claimNext();
            if (intakeId == null) return;
            if (!process(intakeId)) return;
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
            intake.claimAnalysis(now);
            return intake.getId();
        });
    }

    private boolean process(UUID intakeId) {
        Boolean processed = false;
        try {
            processed = transactions.execute(status -> {
                ResumeIntake intake = intakes.findWithDetailsById(intakeId).orElse(null);
                if (intake == null) return true;
                if (replyWork.hasPendingWork(intake.getContact().getBossAccount().getId())) return false;
                String text = intake.getExtractedText();
                if (text == null || text.isBlank()) {
                    intake.analysisUnavailable("FAILED", "RESUME_TEXT_NOT_AVAILABLE", "简历提取文本不存在，无法进行 AI 分析", Instant.now());
                } else {
                    analysis.analyzeInMemory(intake, text);
                }
                return true;
            });
        } catch (RuntimeException ignored) {
            // 最终状态在独立事务中记录，避免 worker 因一次异常停止。
        }
        if (!Boolean.TRUE.equals(processed)) {
            transactions.execute(status -> {
                ResumeIntake intake = intakes.findById(intakeId).orElse(null);
                if (intake != null) intake.deferAnalysis(Instant.now());
                return null;
            });
            return false;
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
                    || "RESUME_TEXT_NOT_AVAILABLE".equals(intake.getAnalysisFailureCode())) {
                intake.failAnalysisQueue(intake.getAnalysisFailureReason(), now);
            } else if (!intake.retryAnalysisQueue(
                    intake.getAnalysisFailureReason() == null ? "AI 分析未完成" : intake.getAnalysisFailureReason(), now)) {
                // retryAnalysisQueue 已将任务转为 FAILED。
            }
            return null;
        });
    }

    @PreDestroy
    void shutdown() {
        worker.shutdownNow();
    }
}
