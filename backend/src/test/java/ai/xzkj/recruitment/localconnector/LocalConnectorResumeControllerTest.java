package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobPositionRepository;
import ai.xzkj.recruitment.resumes.ResumeDocumentPipelineService;
import ai.xzkj.recruitment.resumes.ResumeDocumentProcessingResponse;
import org.junit.jupiter.api.Test;
import org.springframework.web.multipart.MultipartFile;

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

        LocalConnectorResumeController controller = new LocalConnectorResumeController(connectors, observations, jobs, tasks, pipeline);
        assertThat(controller.receive("token", observationId, digest, null, file)).isEqualTo(response);
        verify(observation).markResumeImporting(any(Instant.class));
        verify(observation).recordResumePipelineResult(eq(intakeId), eq("SUCCEEDED"), isNull(), any(Instant.class));
        verify(observations, times(2)).saveAndFlush(observation);
    }
}
