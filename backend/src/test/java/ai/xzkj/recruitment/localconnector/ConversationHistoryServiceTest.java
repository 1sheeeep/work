package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.candidates.ConversationTimelineService;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobPositionRepository;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ConversationHistoryServiceTest {
    @Test
    void importsTheSameTranscriptIntoTheAccountScopedTimeline() {
        JobPositionRepository jobs = mock(JobPositionRepository.class);
        ConversationTimelineService timeline = mock(ConversationTimelineService.class);
        BrowserDevice device = mock(BrowserDevice.class);
        BossAccount account = mock(BossAccount.class);
        JobPosition job = mock(JobPosition.class);
        UUID accountId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        String chatDigest = "a".repeat(64);
        Instant observedAt = Instant.now().minusSeconds(2);

        when(device.getBossAccount()).thenReturn(account);
        when(account.getId()).thenReturn(accountId);
        when(job.getId()).thenReturn(jobId);
        when(job.getTitle()).thenReturn("跨境电商运营助理");
        when(jobs.findAllByBossAccountId(accountId)).thenReturn(List.of(job));
        when(timeline.recordObservedMessages(eq(account), eq(job), eq(chatDigest), anyList(), eq(observedAt), eq(true)))
                .thenReturn(new ConversationTimelineService.HistoryImportResult(2, 1, 0));

        ConversationHistoryImportRequest request = new ConversationHistoryImportRequest(
                chatDigest, "跨境电商运营助理", List.of(
                new ConversationHistoryMessage("b".repeat(64), "INBOUND", observedAt, "您好"),
                new ConversationHistoryMessage("c".repeat(64), "OUTBOUND", observedAt, "您好，收到")),
                observedAt, false);

        ConversationHistoryImportResponse response = new ConversationHistoryService(jobs, timeline)
                .importFromDevice(device, request);

        assertThat(response.jobPositionId()).isEqualTo(jobId);
        assertThat(response.created()).isEqualTo(2);
        assertThat(response.duplicates()).isEqualTo(1);
        assertThat(response.skipped()).isZero();
        verify(timeline).recordObservedMessages(eq(account), eq(job), eq(chatDigest), anyList(), eq(observedAt), eq(true));
    }
}
