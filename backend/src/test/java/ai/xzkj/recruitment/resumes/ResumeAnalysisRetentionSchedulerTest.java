package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.candidates.CandidateJobContact;
import ai.xzkj.recruitment.jobs.JobPosition;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Pageable;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class ResumeAnalysisRetentionSchedulerTest {
    @Test void purgesExpiredContentAndFeedbackButKeepsTheRunForAudit() {
        Instant now = Instant.parse("2026-08-30T08:00:00Z");
        AiAssistanceRunRepository runs = mock(AiAssistanceRunRepository.class);
        ResumeIntakeRepository intakes = mock(ResumeIntakeRepository.class);
        ResumeAnalysisFeedbackRepository feedback = mock(ResumeAnalysisFeedbackRepository.class);
        AuditService audit = mock(AuditService.class);
        ResumeAnalysisRetentionProperties properties = new ResumeAnalysisRetentionProperties();
        AiAssistanceRun run = expiredRun(now.minusSeconds(1));
        when(runs.findExpiredResumeAnalysisRuns(any(Instant.class), any(Pageable.class))).thenReturn(List.of(run));
        ResumeAnalysisRetentionScheduler scheduler = new ResumeAnalysisRetentionScheduler(runs, intakes, feedback, properties, audit,
                Clock.fixed(now, ZoneOffset.UTC));

        scheduler.purgeExpired();
        scheduler.purgeExpired();

        assertThat(run.getStructuredResult()).isNull();
        assertThat(run.getRationale()).isNull();
        assertThat(run.getResultPurgedAt()).isEqualTo(now);
        verify(feedback, times(1)).deleteByAnalysisRunId(run.getId());
        verify(audit, times(1)).systemSuccess(eq("PURGE_RESUME_ANALYSIS_RESULT"), eq("AI_ASSISTANCE_RUN"),
                eq(run.getId()), eq("内部简历事件"), contains("仅保留输入摘要和审计"));
    }

    @Test void doesNothingWhenRetentionIsDisabled() {
        AiAssistanceRunRepository runs = mock(AiAssistanceRunRepository.class);
        ResumeIntakeRepository intakes = mock(ResumeIntakeRepository.class);
        ResumeAnalysisRetentionProperties properties = new ResumeAnalysisRetentionProperties();
        properties.setEnabled(false);
        ResumeAnalysisRetentionScheduler scheduler = new ResumeAnalysisRetentionScheduler(runs, intakes,
                mock(ResumeAnalysisFeedbackRepository.class), properties, mock(AuditService.class), Clock.systemUTC());

        scheduler.purgeExpired();

        verifyNoInteractions(runs, intakes);
    }

    @Test void purgesSourcePdfsOnTheWeeklyCleanupPass() {
        Instant now = Instant.parse("2026-08-30T08:00:00Z");
        AiAssistanceRunRepository runs = mock(AiAssistanceRunRepository.class);
        ResumeIntakeRepository intakes = mock(ResumeIntakeRepository.class);
        ResumeIntake intake = mock(ResumeIntake.class);
        when(intake.getId()).thenReturn(java.util.UUID.randomUUID());
        when(intake.getDisplayLabel()).thenReturn("BOSS 简历");
        when(intakes.findSourcePdfsDueForPurge(any(Instant.class), any(Pageable.class))).thenReturn(List.of(intake));
        ResumeAnalysisRetentionScheduler scheduler = new ResumeAnalysisRetentionScheduler(runs, intakes,
                mock(ResumeAnalysisFeedbackRepository.class), new ResumeAnalysisRetentionProperties(),
                mock(AuditService.class), Clock.fixed(now, ZoneOffset.UTC));

        scheduler.purgeExpiredSourcePdfs();

        verify(intake).clearSourcePdf();
        verify(intakes).findSourcePdfsDueForPurge(eq(now.minusSeconds(90 * 24 * 60 * 60)), any(Pageable.class));
    }

    private AiAssistanceRun expiredRun(Instant expiresAt) {
        ResumeIntake intake = mock(ResumeIntake.class);
        CandidateJobContact contact = mock(CandidateJobContact.class);
        when(intake.getContact()).thenReturn(contact);
        when(intake.getDisplayLabel()).thenReturn("内部简历事件");
        when(contact.getJobPosition()).thenReturn(mock(JobPosition.class));
        return AiAssistanceRun.succeeded(intake, mock(SystemUser.class), "test-model", "a".repeat(64),
                "候选人摘要", "{\"summary\":\"候选人摘要\"}", expiresAt);
    }
}
