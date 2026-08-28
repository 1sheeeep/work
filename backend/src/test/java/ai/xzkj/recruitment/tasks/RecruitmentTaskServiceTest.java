package ai.xzkj.recruitment.tasks;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.boss.BossCapability;
import ai.xzkj.recruitment.boss.BossConnectionStatus;
import ai.xzkj.recruitment.boss.BossGateway;
import ai.xzkj.recruitment.boss.MockBossProfile;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobPositionRepository;
import ai.xzkj.recruitment.jobs.JobPositionStatus;
import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.organization.GroupProfile;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalTime;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RecruitmentTaskServiceTest {
    @Mock private RecruitmentTaskRepository taskRepository;
    @Mock private RecruitmentTaskExecutionRepository executionRepository;
    @Mock private JobPositionRepository jobRepository;
    @Mock private CurrentUserService currentUserService;
    @Mock private BossGateway gateway;
    @Mock private AuditService auditService;
    private RecruitmentTaskService service;
    private Company company;
    private BossAccount account;
    private JobPosition job;
    private SystemUser admin;

    @BeforeEach
    void setUp() {
        service = new RecruitmentTaskService(taskRepository, executionRepository, jobRepository,
                currentUserService, gateway, auditService);
        company = new Company(new GroupProfile("测试集团", "测试"), "测试企业", "TEST", null, null);
        account = new BossAccount(company, "完整能力账号", "boss-test", MockBossProfile.FULL);
        account.applyCapabilityCheck(BossConnectionStatus.CONNECTED,
                Set.of(BossCapability.JOB_SYNC, BossCapability.CANDIDATE_READ));
        job = new JobPosition(company, account, "Java 开发", "上海", 20, 30, 13,
                "3-5 年", "本科", "JD", null);
        job.changeStatus(JobPositionStatus.ACTIVE);
        admin = user(UserRole.RECRUITMENT_ADMIN);
    }

    @Test
    void createsDraftForEligibleJobAndAccount() {
        when(currentUserService.requireCurrentUser()).thenReturn(admin);
        when(jobRepository.findWithDetailsById(job.getId())).thenReturn(Optional.of(job));
        when(taskRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        RecruitmentTaskResponse response = service.create(request(MockExecutionOutcome.SUCCESS, 10));

        assertThat(response.status()).isEqualTo(RecruitmentTaskStatus.DRAFT);
        assertThat(response.jobPosition().id()).isEqualTo(job.getId());
        assertThat(response.bossAccount().id()).isEqualTo(account.getId());
    }

    @Test
    void recruiterCannotCreateTask() {
        when(currentUserService.requireCurrentUser()).thenReturn(user(UserRole.RECRUITER));
        assertThatThrownBy(() -> service.create(request(MockExecutionOutcome.SUCCESS, 10)))
                .isInstanceOf(ApiException.class)
                .hasMessage("当前账号没有自动招聘任务管理权限");
    }

    @Test
    void companyScopeCannotBeBypassedWithListFilter() {
        Company hidden = new Company(new GroupProfile("隐藏集团", "隐藏"), "未授权企业", "HIDDEN", null, null);
        when(currentUserService.requireCurrentUser()).thenReturn(admin);
        assertThatThrownBy(() -> service.list(null, hidden.getId(), null)).isInstanceOf(ApiException.class)
                .hasMessage("当前账号无权访问该企业数据");
        verify(taskRepository, never()).findAllByOrderByCreatedAtDesc();
    }

    @Test
    void successfulCycleCompletesQuota() {
        RecruitmentTask task = task(MockExecutionOutcome.SUCCESS, 2);
        task.changeStatus(RecruitmentTaskStatus.RUNNING);
        when(currentUserService.requireCurrentUser()).thenReturn(admin);
        when(taskRepository.findWithDetailsById(task.getId())).thenReturn(Optional.of(task));
        when(jobRepository.findWithDetailsById(job.getId())).thenReturn(Optional.of(job));
        when(executionRepository.findByTaskIdAndIdempotencyKey(task.getId(), "run-1")).thenReturn(Optional.empty());
        when(executionRepository.countByTaskId(task.getId())).thenReturn(0L);
        when(executionRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(gateway.executeRecruitmentCycle(any(), any())).thenReturn(new BossGateway.RecruitmentCycleResult(
                BossGateway.RecruitmentCycleOutcome.SUCCEEDED, 2, "ok"));

        TaskRunResponse response = service.run(task.getId(), "run-1");

        assertThat(response.task().status()).isEqualTo(RecruitmentTaskStatus.COMPLETED);
        assertThat(response.task().processedToday()).isEqualTo(2);
        assertThat(response.execution().status()).isEqualTo(TaskExecutionStatus.SUCCEEDED);
    }

    @Test
    void repeatedIdempotencyKeyReturnsExistingExecutionWithoutGatewayCall() {
        RecruitmentTask task = task(MockExecutionOutcome.SUCCESS, 10);
        task.changeStatus(RecruitmentTaskStatus.RUNNING);
        RecruitmentTaskExecution existing = new RecruitmentTaskExecution(task, "same-key", 1, 5, 5,
                TaskExecutionStatus.SUCCEEDED, "ok", Instant.now(), Instant.now());
        when(currentUserService.requireCurrentUser()).thenReturn(admin);
        when(taskRepository.findWithDetailsById(task.getId())).thenReturn(Optional.of(task));
        when(executionRepository.findByTaskIdAndIdempotencyKey(task.getId(), "same-key"))
                .thenReturn(Optional.of(existing));

        TaskRunResponse response = service.run(task.getId(), "same-key");

        assertThat(response.replayed()).isTrue();
        verify(gateway, never()).executeRecruitmentCycle(any(), any());
    }

    @Test
    void failedGatewayCycleMovesTaskToFailed() {
        RecruitmentTask task = task(MockExecutionOutcome.FAILURE, 10);
        task.changeStatus(RecruitmentTaskStatus.RUNNING);
        when(currentUserService.requireCurrentUser()).thenReturn(admin);
        when(taskRepository.findWithDetailsById(task.getId())).thenReturn(Optional.of(task));
        when(jobRepository.findWithDetailsById(job.getId())).thenReturn(Optional.of(job));
        when(executionRepository.findByTaskIdAndIdempotencyKey(task.getId(), "fail-1")).thenReturn(Optional.empty());
        when(executionRepository.countByTaskId(task.getId())).thenReturn(0L);
        when(executionRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(gateway.executeRecruitmentCycle(any(), any())).thenReturn(new BossGateway.RecruitmentCycleResult(
                BossGateway.RecruitmentCycleOutcome.FAILED, 0, "temporary failure"));

        TaskRunResponse response = service.run(task.getId(), "fail-1");

        assertThat(response.task().status()).isEqualTo(RecruitmentTaskStatus.FAILED);
        assertThat(response.task().lastError()).isEqualTo("temporary failure");
    }

    @Test
    void scheduledCycleRunsWithoutInteractiveUserAndRecordsSchedulerOwner() {
        RecruitmentTask task = task(MockExecutionOutcome.SUCCESS, 10);
        task.changeStatus(RecruitmentTaskStatus.RUNNING);
        when(taskRepository.findWithDetailsById(task.getId())).thenReturn(Optional.of(task));
        when(jobRepository.findWithDetailsById(job.getId())).thenReturn(Optional.of(job));
        when(executionRepository.findByTaskIdAndIdempotencyKey(task.getId(), "scheduled-1")).thenReturn(Optional.empty());
        when(executionRepository.countByTaskId(task.getId())).thenReturn(0L);
        when(executionRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(gateway.executeRecruitmentCycle(any(), any())).thenReturn(new BossGateway.RecruitmentCycleResult(
                BossGateway.RecruitmentCycleOutcome.SUCCEEDED, 5, "ok"));
        Instant next = Instant.now().plusSeconds(60);

        service.runScheduled(task.getId(), "scheduled-1", "node-a", next);

        assertThat(task.getLastSchedulerOwner()).isEqualTo("node-a");
        assertThat(task.getNextRunAt()).isEqualTo(next);
        verify(currentUserService, never()).requireCurrentUser();
        verify(auditService).systemSuccess(eq("SCHEDULE_RECRUITMENT_TASK"), eq("RECRUITMENT_TASK"),
                eq(task.getId()), eq(task.getName()), anyString());
    }

    private RecruitmentTask task(MockExecutionOutcome outcome, int quota) {
        return new RecruitmentTask(job, account, "自动招聘任务", ExecutionStrategy.BALANCED, quota,
                LocalTime.MIN, LocalTime.of(23, 59), "Asia/Shanghai", true, outcome);
    }

    private RecruitmentTaskUpsertRequest request(MockExecutionOutcome outcome, int quota) {
        return new RecruitmentTaskUpsertRequest(job.getId(), account.getId(), "自动招聘任务",
                ExecutionStrategy.BALANCED, quota, LocalTime.MIN, LocalTime.of(23, 59),
                "Asia/Shanghai", true, outcome);
    }

    private SystemUser user(UserRole role) {
        SystemUser user = new SystemUser(role.name().toLowerCase(), "hash", role.name(), role);
        user.assignCompanyScopes(Set.of(company));
        return user;
    }
}
