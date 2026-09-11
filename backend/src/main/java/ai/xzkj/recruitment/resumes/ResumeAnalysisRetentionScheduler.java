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
    private final ResumeIntakeRepository intakes;
    private final ResumeAnalysisFeedbackRepository feedback;
    private final ResumeAnalysisRetentionProperties properties;
    private final AuditService audit;
    private final Clock clock;

    @Autowired
    public ResumeAnalysisRetentionScheduler(AiAssistanceRunRepository runs, ResumeIntakeRepository intakes, ResumeAnalysisFeedbackRepository feedback,
                                            ResumeAnalysisRetentionProperties properties, AuditService audit) {
        this(runs, intakes, feedback, properties, audit, Clock.systemUTC());
    }

    ResumeAnalysisRetentionScheduler(AiAssistanceRunRepository runs, ResumeIntakeRepository intakes, ResumeAnalysisFeedbackRepository feedback,
                                     ResumeAnalysisRetentionProperties properties, AuditService audit, Clock clock) {
        this.runs = runs;
        this.intakes = intakes;
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

    @Scheduled(fixedDelayString = "${app.resume.analysis-retention.source-pdf-cleanup-interval:7d}",
            initialDelayString = "${app.resume.analysis-retention.source-pdf-cleanup-initial-delay:1h}")
    @Transactional
    public void purgeExpiredSourcePdfs() {
        if (!properties.isEnabled()) return;
        Instant now = clock.instant();
        Instant cutoff = now.minus(java.time.Duration.ofDays(properties.getDays()));
        for (ResumeIntake intake : intakes.findSourcePdfsDueForPurge(cutoff, PageRequest.of(0, properties.getBatchSize()))) {
            intake.clearSourcePdf();
            intake.clearExtractedText();
            audit.systemSuccess("PURGE_RESUME_SOURCE_PDF", "RESUME_INTAKE", intake.getId(),
                    intake.getDisplayLabel(), "已按保留策略清除原始 PDF 和提取文本，仅保留摘要、分析状态和审计记录");
        }
    }
}
