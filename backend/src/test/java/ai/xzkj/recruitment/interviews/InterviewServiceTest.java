package ai.xzkj.recruitment.interviews;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.boss.MockBossProfile;
import ai.xzkj.recruitment.candidates.*;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobPositionStatus;
import ai.xzkj.recruitment.notifications.*;
import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.organization.GroupProfile;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class InterviewServiceTest {
    @Mock InterviewScheduleRepository scheduleRepository;
    @Mock InterviewSlotRepository slotRepository;
    @Mock CandidateJobContactRepository contactRepository;
    @Mock HrNotificationRepository notificationRepository;
    @Mock NotificationAttemptRepository attemptRepository;
    @Mock CurrentUserService currentUserService;
    @Mock NotificationGateway notificationGateway;
    @Mock AuditService auditService;
    InterviewService service;
    Company company; CandidateJobContact contact; SystemUser recruiter;

    @BeforeEach void setUp() {
        service = new InterviewService(scheduleRepository, slotRepository, contactRepository, notificationRepository,
                attemptRepository, currentUserService, notificationGateway, auditService);
        company = new Company(new GroupProfile("测试集团", "测试"), "测试企业", "TEST", null, null);
        BossAccount account = new BossAccount(company, "全能力账号", "boss-full", MockBossProfile.FULL);
        JobPosition job = new JobPosition(company, account, "Java 开发", "上海", 20, 30, 13, "3 年", "本科", "JD", "Spring");
        job.changeStatus(JobPositionStatus.ACTIVE);
        CandidateProfile profile = new CandidateProfile(company, CandidateSource.BOSS_MOCK, "a".repeat(64), "张三", "Java 开发", 5, "本科", "Spring");
        contact = new CandidateJobContact(profile, job, account);
        contact.applyScreening(ScreeningOutcome.PASS, ScreeningOutcome.PASS);
        recruiter = new SystemUser("recruiter", "hash", "招聘专员", UserRole.RECRUITER);
        recruiter.assignCompanyScopes(Set.of(company));
        when(currentUserService.requireCurrentUser()).thenReturn(recruiter);
        lenient().when(notificationGateway.channel()).thenReturn(NotificationChannel.IN_APP_MOCK);
    }

    @Test void createsScheduleWithTwoFutureSlots() {
        when(contactRepository.findWithDetailsById(contact.getId())).thenReturn(Optional.of(contact));
        when(scheduleRepository.findByContactIdOrderByCreatedAtDesc(contact.getId())).thenReturn(List.of());
        when(scheduleRepository.save(any())).thenAnswer(i -> i.getArgument(0));
        when(slotRepository.save(any())).thenAnswer(i -> i.getArgument(0));
        when(slotRepository.findByScheduleIdAndRoundNumberOrderByStartsAtAsc(any(), eq(1))).thenReturn(List.of());

        var response = service.create(createRequest());

        assertThat(response.status()).isEqualTo(InterviewStatus.PROPOSING);
        verify(slotRepository, times(2)).save(any(InterviewSlot.class));
    }

    @Test void rejectsCandidateWhoHasNotPassedScreening() {
        CandidateProfile profile = contact.getCandidate();
        CandidateJobContact screening = new CandidateJobContact(profile, contact.getJobPosition(), contact.getBossAccount());
        when(contactRepository.findWithDetailsById(screening.getId())).thenReturn(Optional.of(screening));

        assertThatThrownBy(() -> service.create(new InterviewCreateRequest(screening.getId(), "Asia/Shanghai",
                MockNotificationOutcome.SUCCESS, futureSlots()))).isInstanceOf(ApiException.class)
                .hasMessage("只有已通过或沟通中的候选人可以安排面试");
    }

    @Test void rejectsInterviewFromCompanyOutsideUserScope() {
        Company hidden = new Company(new GroupProfile("隐藏集团", "隐藏"), "未授权企业", "HIDDEN", null, null);
        BossAccount account = new BossAccount(hidden, "隐藏账号", "hidden", MockBossProfile.FULL);
        JobPosition job = new JobPosition(hidden, account, "隐藏职位", "北京", 10, 20, 12, "1 年", "本科", "JD", null);
        CandidateProfile profile = new CandidateProfile(hidden, CandidateSource.MANUAL, "b".repeat(64), "隐藏候选人", "开发", 2, "本科", "Java");
        CandidateJobContact hiddenContact = new CandidateJobContact(profile, job, account);
        InterviewSchedule hiddenSchedule = new InterviewSchedule(hiddenContact, recruiter, "Asia/Shanghai", MockNotificationOutcome.SUCCESS);
        when(scheduleRepository.findWithDetailsById(hiddenSchedule.getId())).thenReturn(Optional.of(hiddenSchedule));

        assertThatThrownBy(() -> service.detail(hiddenSchedule.getId())).isInstanceOf(ApiException.class)
                .hasMessage("当前账号无权访问该企业数据");
    }

    @Test void expiredSlotMovesScheduleToRescheduleRequired() {
        InterviewSchedule schedule = schedule();
        InterviewSlot expired = new InterviewSlot(schedule, 1, Instant.now().minusSeconds(120), Instant.now().minusSeconds(60));
        arrangeConfirmation(schedule, expired);

        var response = service.confirm(schedule.getId(), expired.getId(), "confirm-expired");

        assertThat(response.result()).isEqualTo(InterviewConfirmationResult.EXPIRED);
        assertThat(schedule.getStatus()).isEqualTo(InterviewStatus.RESCHEDULE_REQUIRED);
        assertThat(expired.getStatus()).isEqualTo(InterviewSlotStatus.EXPIRED);
        verifyNoInteractions(notificationGateway);
    }

    @Test void successfulConfirmationRecordsFailedNotification() {
        InterviewSchedule schedule = schedule();
        schedule.updateMockOutcome(MockNotificationOutcome.FAILURE);
        InterviewSlot selected = new InterviewSlot(schedule, 1, Instant.now().plusSeconds(7200), Instant.now().plusSeconds(10800));
        arrangeConfirmation(schedule, selected);
        when(scheduleRepository.findByOwnerHrIdAndStatus(recruiter.getId(), InterviewStatus.CONFIRMED)).thenReturn(List.of());
        when(notificationRepository.findByScheduleIdAndConfirmationRound(schedule.getId(), 1)).thenReturn(Optional.empty());
        when(notificationRepository.save(any())).thenAnswer(i -> i.getArgument(0));
        when(attemptRepository.findByNotificationIdAndIdempotencyKey(any(), eq("confirm-1"))).thenReturn(Optional.empty());
        when(attemptRepository.save(any())).thenAnswer(i -> i.getArgument(0));
        when(attemptRepository.findByNotificationIdOrderByAttemptedAtDesc(any())).thenReturn(List.of());
        when(notificationGateway.notifyInterview(any())).thenReturn(new NotificationGateway.NotificationResult(false, "Mock 通知失败"));

        var response = service.confirm(schedule.getId(), selected.getId(), "confirm-1");

        assertThat(response.result()).isEqualTo(InterviewConfirmationResult.CONFIRMED);
        assertThat(response.notification().status()).isEqualTo(NotificationStatus.FAILED);
        assertThat(response.notification().attemptCount()).isOne();
    }

    @Test void confirmationReplayAndRetryOfSentNotificationDoNotCallGatewayAgain() {
        InterviewSchedule schedule = schedule();
        InterviewSlot selected = new InterviewSlot(schedule, 1, Instant.now().plusSeconds(7200), Instant.now().plusSeconds(10800));
        HrNotification[] saved = new HrNotification[1];
        arrangeConfirmation(schedule, selected);
        when(scheduleRepository.findByOwnerHrIdAndStatus(recruiter.getId(), InterviewStatus.CONFIRMED)).thenReturn(List.of());
        when(notificationRepository.findByScheduleIdAndConfirmationRound(schedule.getId(), 1))
                .thenReturn(Optional.empty()).thenAnswer(i -> Optional.of(saved[0]));
        when(notificationRepository.save(any())).thenAnswer(i -> saved[0] = i.getArgument(0));
        when(attemptRepository.findByNotificationIdAndIdempotencyKey(any(), eq("same-key"))).thenReturn(Optional.empty());
        when(attemptRepository.save(any())).thenAnswer(i -> i.getArgument(0));
        when(attemptRepository.findByNotificationIdOrderByAttemptedAtDesc(any())).thenReturn(List.of());
        when(notificationGateway.notifyInterview(any())).thenReturn(new NotificationGateway.NotificationResult(true, "Mock 通知成功"));

        service.confirm(schedule.getId(), selected.getId(), "same-key");
        var replay = service.confirm(schedule.getId(), selected.getId(), "same-key");
        when(notificationRepository.findWithRecipientById(saved[0].getId())).thenReturn(Optional.of(saved[0]));
        var sentRetry = service.retryNotification(schedule.getId(), saved[0].getId(), "new-retry-key");

        assertThat(replay.replayed()).isTrue();
        assertThat(sentRetry.replayed()).isTrue();
        assertThat(sentRetry.notification().status()).isEqualTo(NotificationStatus.SENT);
        verify(notificationGateway, times(1)).notifyInterview(any());
    }

    private InterviewCreateRequest createRequest() {
        return new InterviewCreateRequest(contact.getId(), "Asia/Shanghai", MockNotificationOutcome.SUCCESS, futureSlots());
    }
    private List<InterviewSlotRequest> futureSlots() {
        Instant first = Instant.now().plusSeconds(7200);
        return List.of(new InterviewSlotRequest(first, first.plusSeconds(3600)),
                new InterviewSlotRequest(first.plusSeconds(7200), first.plusSeconds(10800)));
    }
    private InterviewSchedule schedule() { return new InterviewSchedule(contact, recruiter, "Asia/Shanghai", MockNotificationOutcome.SUCCESS); }
    private void arrangeConfirmation(InterviewSchedule schedule, InterviewSlot slot) {
        when(scheduleRepository.findWithDetailsById(schedule.getId())).thenReturn(Optional.of(schedule));
        when(slotRepository.findByIdAndScheduleId(slot.getId(), schedule.getId())).thenReturn(Optional.of(slot));
        when(slotRepository.findByScheduleIdAndRoundNumberOrderByStartsAtAsc(schedule.getId(), 1)).thenReturn(List.of(slot));
    }
}
