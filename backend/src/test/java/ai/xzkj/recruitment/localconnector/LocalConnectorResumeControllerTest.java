package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.candidates.CandidateJobContact;
import ai.xzkj.recruitment.candidates.CandidateProfile;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobPositionRepository;
import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.resumes.AiAssistanceRun;
import ai.xzkj.recruitment.resumes.AiAssistanceRunRepository;
import ai.xzkj.recruitment.resumes.ResumeDocumentPipelineService;
import ai.xzkj.recruitment.resumes.ResumeDocumentProcessingResponse;
import ai.xzkj.recruitment.resumes.ResumeIntake;
import ai.xzkj.recruitment.resumes.ResumeIntakeRepository;
import org.junit.jupiter.api.Test;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class LocalConnectorResumeControllerTest {
    @Test
    void recordsSuccessfulPdfPipelineResultOnTheConversation() {
        LocalConnectorService connectors = mock(LocalConnectorService.class);
        BrowserUnreadObservationRepository observations = mock(BrowserUnreadObservationRepository.class);
        JobPositionRepository jobs = mock(JobPositionRepository.class);
        LocalConnectorActionTaskRepository tasks = mock(LocalConnectorActionTaskRepository.class);
        ResumeDocumentPipelineService pipeline = mock(ResumeDocumentPipelineService.class);
        ResumeIntakeRepository resumeIntakes = mock(ResumeIntakeRepository.class);
        AiAssistanceRunRepository analysisRuns = mock(AiAssistanceRunRepository.class);
        BrowserDevice device = mock(BrowserDevice.class);
        BrowserUnreadObservation observation = mock(BrowserUnreadObservation.class);
        BossAccount account = mock(BossAccount.class);
        JobPosition job = mock(JobPosition.class);
        MultipartFile file = mock(MultipartFile.class);
        UUID deviceId = UUID.randomUUID();
        UUID accountId = UUID.randomUUID();
        UUID observationId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        UUID intakeId = UUID.randomUUID();
        String digest = "a".repeat(64);
        ResumeDocumentProcessingResponse response = new ResumeDocumentProcessingResponse(intakeId, "候选人", "anonymous",
                "READY_FOR_AI", "PDF", true, "document", "text", null, null,
                "SUCCEEDED", null, null, null, Instant.now(), false, "SUCCEEDED", 1);

        when(connectors.authenticate("token")).thenReturn(device);
        when(device.getId()).thenReturn(deviceId);
        when(device.getBossAccount()).thenReturn(account);
        when(account.getId()).thenReturn(accountId);
        when(observations.findWithAccountById(observationId)).thenReturn(Optional.of(observation));
        when(observation.getDevice()).thenReturn(device);
        when(observation.getAccount()).thenReturn(account);
        when(observation.getMatchedJobPositionId()).thenReturn(jobId);
        when(observation.getChatDigest()).thenReturn("b".repeat(64));
        when(jobs.findWithDetailsById(jobId)).thenReturn(Optional.of(job));
        when(job.getBossAccount()).thenReturn(account);
        when(pipeline.processVisibleResume(eq(job), anyString(), eq(digest), isNull(), eq(file))).thenReturn(response);

        LocalConnectorResumeController controller = new LocalConnectorResumeController(connectors, observations, jobs, tasks,
                pipeline, resumeIntakes, analysisRuns, new ObjectMapper());
        assertThat(controller.receive("token", observationId, digest, null, file)).isEqualTo(response);
        verify(observation).markResumeImporting(any(Instant.class));
        verify(observation).recordResumePipelineResult(eq(intakeId), eq("READY_FOR_AI"), eq("SUCCEEDED"), isNull(), any(Instant.class));
        verify(observations, times(2)).saveAndFlush(observation);
    }

    @Test
    void returnsResumeAnalysisOnlyForThePairedDeviceAndCurrentConversation() {
        LocalConnectorService connectors = mock(LocalConnectorService.class);
        BrowserUnreadObservationRepository observations = mock(BrowserUnreadObservationRepository.class);
        JobPositionRepository jobs = mock(JobPositionRepository.class);
        LocalConnectorActionTaskRepository tasks = mock(LocalConnectorActionTaskRepository.class);
        ResumeDocumentPipelineService pipeline = mock(ResumeDocumentPipelineService.class);
        ResumeIntakeRepository resumeIntakes = mock(ResumeIntakeRepository.class);
        AiAssistanceRunRepository analysisRuns = mock(AiAssistanceRunRepository.class);
        BrowserDevice device = mock(BrowserDevice.class);
        BrowserUnreadObservation observation = mock(BrowserUnreadObservation.class);
        BossAccount account = mock(BossAccount.class);
        Company company = mock(Company.class);
        ResumeIntake intake = mock(ResumeIntake.class);
        CandidateJobContact contact = mock(CandidateJobContact.class);
        CandidateProfile candidate = mock(CandidateProfile.class);
        AiAssistanceRun run = mock(AiAssistanceRun.class);
        UUID accountId = UUID.randomUUID();
        UUID companyId = UUID.randomUUID();
        UUID intakeId = UUID.randomUUID();
        UUID deviceId = UUID.randomUUID();
        String digest = "c".repeat(64);
        Instant analyzedAt = Instant.now();

        when(connectors.authenticate("Device token")).thenReturn(device);
        when(device.getId()).thenReturn(deviceId);
        when(device.getBossAccount()).thenReturn(account);
        when(account.getId()).thenReturn(accountId);
        when(account.getCompany()).thenReturn(company);
        when(company.getId()).thenReturn(companyId);
        when(observations.findWithAccountAndDeviceByAccountIdAndChatDigest(accountId, digest))
                .thenReturn(Optional.of(observation));
        when(observation.getDevice()).thenReturn(device);
        when(observation.getResumeIntakeId()).thenReturn(intakeId);
        when(observation.getResumePipelineUpdatedAt()).thenReturn(analyzedAt);
        when(resumeIntakes.findWithDetailsById(intakeId)).thenReturn(Optional.of(intake));
        when(intake.getContact()).thenReturn(contact);
        when(contact.getBossAccount()).thenReturn(account);
        when(contact.getCandidate()).thenReturn(candidate);
        when(candidate.getCompany()).thenReturn(company);
        when(candidate.getDisplayName()).thenReturn("张三");
        when(intake.getProcessingStatus()).thenReturn("COMPLETED");
        when(intake.getAnalysisStatus()).thenReturn("SUCCEEDED");
        when(analysisRuns.findFirstByResumeIntakeIdOrderByCreatedAtDesc(intakeId)).thenReturn(Optional.of(run));
        when(run.isResultPurged()).thenReturn(false);
        when(run.getResultExpiresAt()).thenReturn(analyzedAt.plusSeconds(3_600));
        when(run.getStatus()).thenReturn("SUCCEEDED");
        when(run.getStructuredResult()).thenReturn("{\"recommendation\":\"PRIORITY_VIEW\",\"summary\":\"具备相关运营经验。\",\"evidence\":[{\"criterion\":\"跨境经验\",\"finding\":\"有独立站运营经历\",\"status\":\"FOUND\"}]} ");
        when(run.getCreatedAt()).thenReturn(analyzedAt);

        LocalConnectorResumeController controller = new LocalConnectorResumeController(connectors, observations, jobs,
                tasks, pipeline, resumeIntakes, analysisRuns, new ObjectMapper());
        CurrentResumeAnalysisResponse response = controller.currentResumeAnalysis("Device token", digest);

        assertThat(response.hasResume()).isTrue();
        assertThat(response.candidateName()).isEqualTo("张三");
        assertThat(response.recommendation()).isEqualTo("PRIORITY_VIEW");
        assertThat(response.summary()).isEqualTo("具备相关运营经验。");
        assertThat(response.evidence()).containsExactly("跨境经验：有独立站运营经历");
        verify(analysisRuns).findFirstByResumeIntakeIdOrderByCreatedAtDesc(intakeId);
    }

    @Test
    void doesNotReturnAnalysisWhenObservationBelongsToAnotherDevice() {
        LocalConnectorService connectors = mock(LocalConnectorService.class);
        BrowserUnreadObservationRepository observations = mock(BrowserUnreadObservationRepository.class);
        JobPositionRepository jobs = mock(JobPositionRepository.class);
        LocalConnectorActionTaskRepository tasks = mock(LocalConnectorActionTaskRepository.class);
        ResumeDocumentPipelineService pipeline = mock(ResumeDocumentPipelineService.class);
        ResumeIntakeRepository resumeIntakes = mock(ResumeIntakeRepository.class);
        AiAssistanceRunRepository analysisRuns = mock(AiAssistanceRunRepository.class);
        BrowserDevice currentDevice = mock(BrowserDevice.class);
        BrowserDevice otherDevice = mock(BrowserDevice.class);
        BrowserUnreadObservation observation = mock(BrowserUnreadObservation.class);
        BossAccount account = mock(BossAccount.class);
        UUID accountId = UUID.randomUUID();
        String digest = "d".repeat(64);

        when(connectors.authenticate("Device token")).thenReturn(currentDevice);
        when(currentDevice.getId()).thenReturn(UUID.randomUUID());
        when(currentDevice.getBossAccount()).thenReturn(account);
        when(account.getId()).thenReturn(accountId);
        when(observations.findWithAccountAndDeviceByAccountIdAndChatDigest(accountId, digest))
                .thenReturn(Optional.of(observation));
        when(observation.getDevice()).thenReturn(otherDevice);

        LocalConnectorResumeController controller = new LocalConnectorResumeController(connectors, observations, jobs,
                tasks, pipeline, resumeIntakes, analysisRuns, new ObjectMapper());
        CurrentResumeAnalysisResponse response = controller.currentResumeAnalysis("Device token", digest);

        assertThat(response.hasResume()).isFalse();
        assertThat(response.analysisStatus()).isEqualTo("NOT_FOUND");
        verifyNoInteractions(resumeIntakes, analysisRuns);
    }
}
