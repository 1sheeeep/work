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
import java.util.UUID;
import java.util.Optional;

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
    ConversationMessage savedMessage;

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
        when(candidates.findByCompanyIdAndSourceAndDedupKey(company.getId(), CandidateSource.BOSS, "a".repeat(64)))
                .thenReturn(Optional.of(profile));
        when(contacts.findByCandidateIdAndJobPositionId(profile.getId(), job.getId())).thenReturn(Optional.of(contact));
        when(messages.findByContactIdAndExternalMessageId(any(), any())).thenAnswer(invocation -> Optional.ofNullable(savedMessage));
        when(messages.save(any())).thenAnswer(invocation -> {
            savedMessage = invocation.getArgument(0);
            return savedMessage;
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
}
