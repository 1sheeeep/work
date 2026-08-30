package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.audit.AuditService;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class OpenAiConfigurationServiceTest {
    @Test
    void reportsEveryMissingServerSettingWithoutExposingAKey() {
        OpenAiProperties properties = new OpenAiProperties();
        ResumeAnalysisRetentionProperties retention = new ResumeAnalysisRetentionProperties();
        OpenAiConfigurationService service = new OpenAiConfigurationService(properties, retention,
                mock(OpenAiResumeClient.class), mock(AuditService.class));

        OpenAiConfigurationStatusResponse status = service.status();

        assertThat(status.ready()).isFalse();
        assertThat(status.apiKeyConfigured()).isFalse();
        assertThat(status.missingConfiguration()).contains("APP_OPENAI_ENABLED", "OPENAI_API_KEY", "OPENAI_MODEL");
        assertThat(status.resultRetentionDays()).isEqualTo(90);
        assertThat(status.requestStorageDisabled()).isTrue();
    }

    @Test
    void returnsAuditedConnectionTestMetadataWithoutCandidateData() {
        OpenAiProperties properties = new OpenAiProperties();
        properties.setEnabled(true);
        properties.setApiKey("server-secret");
        properties.setModel("configured-model");
        ResumeAnalysisRetentionProperties retention = new ResumeAnalysisRetentionProperties();
        OpenAiResumeClient client = mock(OpenAiResumeClient.class);
        AuditService audit = mock(AuditService.class);
        Instant checkedAt = Instant.parse("2026-08-30T08:00:00Z");
        when(client.testConnection()).thenReturn(new OpenAiResumeClient.ConnectionCheck(
                "configured-model", "req-safe-id", 240, checkedAt));
        OpenAiConfigurationService service = new OpenAiConfigurationService(properties, retention, client, audit);

        OpenAiConnectionTestResponse response = service.testConnection();

        assertThat(response.success()).isTrue();
        assertThat(response.requestId()).isEqualTo("req-safe-id");
        assertThat(response.message()).contains("Structured Outputs");
        verify(audit).success(eq("TEST_OPENAI_CONNECTION"), eq("AI_CONFIGURATION"), isNull(), eq("OpenAI"),
                contains("未发送候选人或简历数据"));
    }
}
