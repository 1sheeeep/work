package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.organization.GroupProfile;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ConversationTimelineServiceTest {
    @Mock CandidateProfileRepository candidates;
    @Mock CandidateJobContactRepository contacts;
    @Mock ConversationMessageRepository messages;

    ConversationTimelineService service;
    Company company;
    BossAccount account;
    JobPosition job;
    CandidateProfile profile;
    CandidateJobContact contact;
    List<ConversationMessage> stored;

    @BeforeEach
    void setUp() {
        service = new ConversationTimelineService(candidates, contacts, messages);
        company = new Company(new GroupProfile("测试集团", "测试"), "测试企业", "TEST", null, null);
        account = new BossAccount(company, "招聘账号", "boss-1");
        job = new JobPosition(company, account, "Java 开发", "上海", 10, 20, 12,
                "不限", "本科", "负责 Java 服务开发", "Java");
        profile = new CandidateProfile(company, CandidateSource.BOSS, "a".repeat(64),
                "匿名候选人", null, null, null, null);
        contact = new CandidateJobContact(profile, job, account);
        stored = new ArrayList<>();
        when(candidates.findByCompanyIdAndSourceAndDedupKey(company.getId(), CandidateSource.BOSS, "a".repeat(64)))
                .thenReturn(Optional.of(profile));
        when(contacts.findByCandidateIdAndJobPositionId(profile.getId(), job.getId())).thenReturn(Optional.of(contact));
        when(messages.findByContactIdAndExternalMessageId(any(), any())).thenAnswer(invocation -> stored.stream()
                .filter(message -> message.getExternalMessageId().equals(invocation.getArgument(1)))
                .findFirst());
        lenient().when(messages.findByContactIdOrderByCreatedAtAsc(any())).thenAnswer(invocation -> new ArrayList<>(stored));
        when(messages.save(any())).thenAnswer(invocation -> {
            ConversationMessage message = invocation.getArgument(0);
            stored.add(message);
            return message;
        });
    }

    @Test
    void observedMessagesAreIdempotentByExternalDigest() {
        service.recordObservedMessage(account, job, "a".repeat(64), "b".repeat(64),
                MessageDirection.INBOUND, "您好，我对岗位感兴趣", Instant.now());
        service.recordObservedMessage(account, job, "a".repeat(64), "b".repeat(64),
                MessageDirection.INBOUND, "您好，我对岗位感兴趣", Instant.now());

        verify(messages, times(2)).findByContactIdAndExternalMessageId(contact.getId(), "boss:" + "b".repeat(64));
        verify(messages, times(1)).save(any(ConversationMessage.class));
    }

    @Test
    void aiReplyIsPendingUntilSuccessfulSendReceipt() {
        service.recordAiReply(account.getId(), job.getId(), "a".repeat(64),
                UUID.randomUUID(), true, "可以，欢迎发简历了解。", Instant.now(), job);

        verify(messages).save(argThat(message -> message.getSenderType() == MessageSenderType.AI
                && message.getDeliveryStatus() == MessageDeliveryStatus.PENDING_REVIEW));
    }

    @Test
    void fullTranscriptReusesARecentSnapshotWithADifferentDigest() {
        Instant at = Instant.parse("2026-09-17T11:03:00Z");
        service.recordObservedMessage(account, job, "a".repeat(64), "b".repeat(64),
                MessageDirection.INBOUND, "嗯嗯嗯", at);

        var result = service.recordObservedMessages(account, job, "a".repeat(64),
                List.of(new ConversationTimelineService.HistoryMessage("c".repeat(64),
                        MessageDirection.INBOUND, "嗯嗯嗯", at)), at, true);

        assertThat(result.created()).isZero();
        assertThat(result.duplicates()).isEqualTo(1);
        assertThat(stored).hasSize(1);
        assertThat(stored.getFirst().getSupersededAt()).isNull();
    }

    @Test
    void preservesTwoRealIdenticalTurnsInOneBossCapture() {
        Instant at = Instant.parse("2026-09-17T11:03:00Z");
        service.recordObservedMessage(account, job, "a".repeat(64), "b".repeat(64),
                MessageDirection.INBOUND, "嗯嗯嗯", at);

        var result = service.recordObservedMessages(account, job, "a".repeat(64), List.of(
                new ConversationTimelineService.HistoryMessage("c".repeat(64), MessageDirection.INBOUND, "嗯嗯嗯", at),
                new ConversationTimelineService.HistoryMessage("d".repeat(64), MessageDirection.INBOUND, "嗯嗯嗯", at)
        ), at, true);

        assertThat(result.created()).isEqualTo(1);
        assertThat(stored.stream().filter(message -> message.getSupersededAt() == null)).hasSize(2);
    }

    @Test
    void fullCaptureSuppressesExtraBossRowsAndTheSentAiShadowWithoutDeletingThem() {
        Instant at = Instant.now().truncatedTo(ChronoUnit.MINUTES);
        String reply = "好的，我先看一下您的简历，了解后再和您联系。";
        service.recordObservedMessage(account, job, "a".repeat(64), "b".repeat(64),
                MessageDirection.OUTBOUND, reply, at);
        service.recordObservedMessage(account, job, "a".repeat(64), "c".repeat(64),
                MessageDirection.OUTBOUND, reply, at);
        UUID taskId = UUID.randomUUID();
        service.recordAiReply(account.getId(), job.getId(), "a".repeat(64), taskId, true, reply, at, job);
        service.recordAiSendReceipt(account.getId(), job.getId(), "a".repeat(64), taskId, "SUCCEEDED", job);

        service.recordObservedMessages(account, job, "a".repeat(64),
                List.of(new ConversationTimelineService.HistoryMessage("d".repeat(64),
                        MessageDirection.OUTBOUND, reply, at)), at, true);

        assertThat(stored).hasSize(3);
        assertThat(stored.stream().filter(message -> message.getSupersededAt() == null)).hasSize(1);
        assertThat(stored.stream().filter(message -> message.getSupersededAt() == null).findFirst().orElseThrow().getSenderType())
                .isEqualTo(MessageSenderType.HR);
    }

    @Test
    void partialCaptureNeverHidesUnseenBossMessages() {
        Instant at = Instant.parse("2026-09-17T11:03:00Z");
        service.recordObservedMessage(account, job, "a".repeat(64), "b".repeat(64),
                MessageDirection.INBOUND, "第一条", at);
        service.recordObservedMessage(account, job, "a".repeat(64), "c".repeat(64),
                MessageDirection.INBOUND, "第二条", at.plusSeconds(60));

        service.recordObservedMessages(account, job, "a".repeat(64),
                List.of(new ConversationTimelineService.HistoryMessage("d".repeat(64),
                        MessageDirection.INBOUND, "第二条", at.plusSeconds(60))), at, false);

        assertThat(stored.stream().filter(message -> message.getSupersededAt() == null)).hasSize(2);
    }

    @Test
    void apparentlyCompleteCaptureDoesNotPruneOlderTurnsItDidNotRead() {
        Instant at = Instant.parse("2026-09-17T11:03:00Z");
        service.recordObservedMessage(account, job, "a".repeat(64), "b".repeat(64),
                MessageDirection.INBOUND, "昨天的独立消息", at.minusSeconds(86_400));
        service.recordObservedMessage(account, job, "a".repeat(64), "c".repeat(64),
                MessageDirection.INBOUND, "今天的消息", at);

        service.recordObservedMessages(account, job, "a".repeat(64),
                List.of(new ConversationTimelineService.HistoryMessage("d".repeat(64),
                        MessageDirection.INBOUND, "今天的消息", at)), at, true);

        assertThat(stored.stream().filter(message -> message.getSupersededAt() == null)).hasSize(2);
    }

    @Test
    void transcriptNormalizesResumePreviewButtonTextBeforeReconciling() {
        Instant at = Instant.parse("2026-09-17T11:03:00Z");
        service.recordObservedMessage(account, job, "a".repeat(64), "b".repeat(64),
                MessageDirection.INBOUND, "简历.pdf 点击预览附件简历", at);

        var result = service.recordObservedMessages(account, job, "a".repeat(64),
                List.of(new ConversationTimelineService.HistoryMessage("c".repeat(64),
                        MessageDirection.INBOUND, "简历.pdf", at)), at, true);

        assertThat(result.duplicates()).isEqualTo(1);
        assertThat(stored).hasSize(1);
        assertThat(stored.getFirst().getContent()).isEqualTo("简历.pdf");
    }

    @Test
    void partialCaptureDoesNotMergeSameTextFromDifferentMinutes() {
        Instant at = Instant.parse("2026-09-17T11:03:00Z");
        service.recordObservedMessage(account, job, "a".repeat(64), "b".repeat(64),
                MessageDirection.INBOUND, "好的", at);

        service.recordObservedMessages(account, job, "a".repeat(64),
                List.of(new ConversationTimelineService.HistoryMessage("c".repeat(64),
                        MessageDirection.INBOUND, "好的", at.plusSeconds(60))), at.plusSeconds(60), false);

        assertThat(stored.stream().filter(message -> message.getSupersededAt() == null)).hasSize(2);
    }
}
