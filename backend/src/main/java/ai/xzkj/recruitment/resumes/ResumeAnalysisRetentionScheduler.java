package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.audit.AuditService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;

@Component
public class ResumeAnalysisRetentionScheduler {
    private final AiAssistanceRunRepository runs;
    private final ResumeAnalysisFeedbackRepository feedback;
    private final ResumeAnalysisRetentionProperties properties;
    private final AuditService audit;
    private final Clock clock;

    @Autowired
    public ResumeAnalysisRetentionScheduler(AiAssistanceRunRepository runs, ResumeAnalysisFeedbackRepository feedback,
                                            ResumeAnalysisRetentionProperties properties, AuditService audit) {
        this(runs, feedback, properties, audit, Clock.systemUTC());
    }

    ResumeAnalysisRetentionScheduler(AiAssistanceRunRepository runs, ResumeAnalysisFeedbackRepository feedback,
                                     ResumeAnalysisRetentionProperties properties, AuditService audit, Clock clock) {
        this.runs = runs;
        this.feedback = feedback;
        this.properties = properties;
        this.audit = audit;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${app.resume.analysis-retention.cleanup-interval:1h}", initialDelayString = "${app.resume.analysis-retention.initial-delay:5m}")
    @Transactional
    public void purgeExpired() {
        if (!properties.isEnabled()) return;
        Instant now = clock.instant();
        for (AiAssistanceRun run : runs.findExpiredResumeAnalysisRuns(now, PageRequest.of(0, properties.getBatchSize()))) {
            if (!run.purgeResult(now)) continue;
            feedback.deleteByAnalysisRunId(run.getId());
            audit.systemSuccess("PURGE_RESUME_ANALYSIS_RESULT", "AI_ASSISTANCE_RUN", run.getId(),
                    run.getResumeIntake().getDisplayLabel(), "已按保留策略清除 AI 结构化结果、摘要与 HR 复核内容；仅保留输入摘要和审计");
        }
    }
}
