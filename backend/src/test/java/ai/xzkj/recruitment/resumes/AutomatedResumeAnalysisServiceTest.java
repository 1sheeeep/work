package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.candidates.CandidateJobContact;
import ai.xzkj.recruitment.candidates.CandidateProfile;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.organization.Company;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class AutomatedResumeAnalysisServiceTest {
    @Test
    void keepsExtractedTextInMemoryAndStoresSuccessfulStructuredResult() {
        Fixture f = new Fixture(true, true);
        when(f.client.analyze(eq(f.job), eq("Java 项目经验"), any())).thenReturn(new ResumeAnalysisResult(
                "NORMAL_VIEW", "具备相关项目经验", List.of(new ResumeAnalysisEvidence("Java", "简历中已体现", "FOUND")),
                List.of(), List.of(), List.of("负责范围？", "项目规模？", "离职原因？")));

        f.service.analyzeInMemory(f.intake, "Java 项目经验");

        assertThat(f.intake.getAnalysisStatus()).isEqualTo("SUCCEEDED");
        assertThat(f.intake.getAnalysisFailureCode()).isNull();
        verify(f.runs).save(argThat(run -> "UNATTENDED".equals(run.getOrigin()) && "SUCCEEDED".equals(run.getStatus())
                && run.getCreatedBy() == null && !run.getInputHash().contains("Java")));
    }

    @Test
    void doesNotCallExternalAiWithoutCompanyAuthorization() {
        Fixture f = new Fixture(false, true);

        f.service.analyzeInMemory(f.intake, "不得发送的文本");

        assertThat(f.intake.getAnalysisStatus()).isEqualTo("NOT_AUTHORIZED");
        assertThat(f.intake.getAnalysisFailureCode()).isEqualTo("COMPANY_AI_AUTO_ANALYSIS_DISABLED");
        verifyNoInteractions(f.client, f.runs);
    }

    private static final class Fixture {
        final AiAssistanceRunRepository runs=mock(AiAssistanceRunRepository.class);
        final OpenAiResumeClient client=mock(OpenAiResumeClient.class);
        final OpenAiProperties properties=mock(OpenAiProperties.class);
        final ResumeAnalysisRetentionProperties retention=mock(ResumeAnalysisRetentionProperties.class);
        final AuditService audit=mock(AuditService.class);
        final Company company=mock(Company.class);
        final CandidateProfile candidate=mock(CandidateProfile.class);
        final CandidateJobContact contact=mock(CandidateJobContact.class);
        final JobPosition job=mock(JobPosition.class);
        final ResumeIntake intake;
        final AutomatedResumeAnalysisService service;

        Fixture(boolean authorized, boolean configured) {
            when(company.isAiAutoAnalysisEnabled()).thenReturn(authorized);
            when(company.getId()).thenReturn(java.util.UUID.randomUUID());
            when(candidate.getCompany()).thenReturn(company);
            when(contact.getCandidate()).thenReturn(candidate);
            when(contact.getJobPosition()).thenReturn(job);
            when(properties.isEnabled()).thenReturn(configured);
            when(properties.getApiKey()).thenReturn(configured ? "configured" : "");
            when(properties.getModel()).thenReturn(configured ? "gpt-4o-mini" : "");
            when(properties.isOfficialEndpoint()).thenReturn(configured);
            when(retention.expiresFrom(any())).thenReturn(Instant.now().plusSeconds(3600));
            when(runs.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
            intake = new ResumeIntake(contact, ResumeIntakeSource.BOSS_VISIBLE, "a".repeat(64), "BOSS 简历", Instant.now());
            service = new AutomatedResumeAnalysisService(runs, client, properties, retention, new ObjectMapper(), audit);
        }
    }
}
