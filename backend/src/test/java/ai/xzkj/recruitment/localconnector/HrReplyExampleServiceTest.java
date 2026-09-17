package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobPositionRepository;
import ai.xzkj.recruitment.jobs.JobPositionStatus;
import ai.xzkj.recruitment.boss.BossAccount;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class HrReplyExampleServiceTest {
    @Test
    void deviceImportDoesNotLearnItsOwnAiReplyAsAnHrExample() {
        HrReplyExampleRepository examples = mock(HrReplyExampleRepository.class);
        InboundAiReplyTaskRepository aiReplies = mock(InboundAiReplyTaskRepository.class);
        JobPositionRepository jobs = mock(JobPositionRepository.class);
        HrReplyExampleService service = new HrReplyExampleService(examples, aiReplies, jobs,
                mock(CurrentUserService.class));
        UUID accountId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        String chatDigest = "a".repeat(64);
        BossAccount account = mock(BossAccount.class);
        BrowserDevice device = mock(BrowserDevice.class);
        JobPosition job = mock(JobPosition.class);
        InboundAiReplyTask aiReply = mock(InboundAiReplyTask.class);
        when(device.getBossAccount()).thenReturn(account);
        when(account.getId()).thenReturn(accountId);
        when(job.getId()).thenReturn(jobId);
        when(job.getTitle()).thenReturn("运营助理");
        when(jobs.findAllByBossAccountIdAndStatus(accountId, JobPositionStatus.ACTIVE))
                .thenReturn(List.of(job));
        when(aiReplies.findTop500ByAccountIdAndChatDigestAndSendStatusOrderBySendCompletedAtDesc(
                accountId, chatDigest, "SUCCEEDED")).thenReturn(List.of(aiReply));
        when(aiReply.getJobPositionId()).thenReturn(jobId);
        when(aiReply.getReplyContent()).thenReturn("好的，稍后联系您。");

        HrReplyExampleImportResponse result = service.importTranscriptFromDevice(device,
                new HrReplyExampleImportRequest("""
                        岗位：运营助理
                        候选人：可以聊聊吗
                        HR：好的，稍后联系您。
                        """, chatDigest));

        assertThat(result.created()).isZero();
        assertThat(result.skipped()).isEqualTo(1);
    }
}
