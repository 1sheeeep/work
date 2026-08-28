package ai.xzkj.recruitment.tasks;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.boss.BossAccountStatus;
import ai.xzkj.recruitment.boss.BossCapability;
import ai.xzkj.recruitment.boss.BossGateway;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobPositionRepository;
import ai.xzkj.recruitment.jobs.JobPositionStatus;
import ai.xzkj.recruitment.organization.Company;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class RecruitmentTaskService {
    private final RecruitmentTaskRepository taskRepository;
    private final RecruitmentTaskExecutionRepository executionRepository;
    private final JobPositionRepository jobRepository;
    private final CurrentUserService currentUserService;
    private final BossGateway gateway;
    private final AuditService auditService;

    public RecruitmentTaskService(RecruitmentTaskRepository taskRepository,
                                  RecruitmentTaskExecutionRepository executionRepository,
                                  JobPositionRepository jobRepository, CurrentUserService currentUserService,
                                  BossGateway gateway, AuditService auditService) {
        this.taskRepository = taskRepository;
        this.executionRepository = executionRepository;
        this.jobRepository = jobRepository;
        this.currentUserService = currentUserService;
        this.gateway = gateway;
        this.auditService = auditService;
    }

    @Transactional(readOnly = true)
    public List<RecruitmentTaskResponse> list(String keyword, UUID companyId, RecruitmentTaskStatus status) {
        SystemUser user = currentUserService.requireCurrentUser();
        Set<UUID> allowedIds = allowedCompanyIds(user);
        if (companyId != null && allowedIds != null && !allowedIds.contains(companyId)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "COMPANY_SCOPE_FORBIDDEN", "当前账号无权访问该企业数据");
        }
        String normalized = keyword == null ? "" : keyword.trim().toLowerCase(Locale.ROOT);
        return taskRepository.findAllByOrderByCreatedAtDesc().stream()
                .filter(task -> allowedIds == null || allowedIds.contains(task.getJobPosition().getCompany().getId()))
                .filter(task -> companyId == null || companyId.equals(task.getJobPosition().getCompany().getId()))
                .filter(task -> status == null || status == task.getStatus())
                .filter(task -> normalized.isBlank()
                        || task.getName().toLowerCase(Locale.ROOT).contains(normalized)
                        || task.getJobPosition().getTitle().toLowerCase(Locale.ROOT).contains(normalized)
                        || task.getBossAccount().getDisplayName().toLowerCase(Locale.ROOT).contains(normalized))
                .map(RecruitmentTaskResponse::from).toList();
    }

    @Transactional
    public RecruitmentTaskResponse create(RecruitmentTaskUpsertRequest request) {
        SystemUser user = requireManager();
        requireZone(cleanRequired(request.timezone()));
        JobPosition job = requireEligibleBinding(request.jobPositionId(), request.bossAccountId(), user);
        RecruitmentTask task = taskRepository.save(new RecruitmentTask(job, job.getBossAccount(),
                cleanRequired(request.name()), request.executionStrategy(), request.dailyQuota(), request.windowStart(),
                request.windowEnd(), cleanRequired(request.timezone()), request.requireManualReview(), request.mockOutcome()));
        auditService.success("CREATE_RECRUITMENT_TASK", "RECRUITMENT_TASK", task.getId(), task.getName(),
                "新增自动招聘任务草稿，职位 " + job.getTitle());
        return RecruitmentTaskResponse.from(task);
    }

    @Transactional
    public RecruitmentTaskResponse update(UUID id, RecruitmentTaskUpsertRequest request) {
        SystemUser user = requireManager();
        RecruitmentTask task = requireAccessibleTask(id, user);
        if (task.getStatus() != RecruitmentTaskStatus.DRAFT && task.getStatus() != RecruitmentTaskStatus.PAUSED
                && task.getStatus() != RecruitmentTaskStatus.FAILED
                && task.getStatus() != RecruitmentTaskStatus.NEEDS_ATTENTION) {
            throw new ApiException(HttpStatus.CONFLICT, "TASK_NOT_EDITABLE", "只能编辑草稿、已暂停、失败或需人工介入的任务");
        }
        if (!task.getJobPosition().getId().equals(request.jobPositionId())
                || !task.getBossAccount().getId().equals(request.bossAccountId())) {
            throw new ApiException(HttpStatus.CONFLICT, "TASK_BINDING_IMMUTABLE", "任务创建后不能更换职位或 BOSS 账号");
        }
        requireZone(cleanRequired(request.timezone()));
        requireEligibleBinding(request.jobPositionId(), request.bossAccountId(), user);
        task.update(cleanRequired(request.name()), request.executionStrategy(), request.dailyQuota(),
                request.windowStart(), request.windowEnd(), cleanRequired(request.timezone()),
                request.requireManualReview(), request.mockOutcome());
        auditService.success("UPDATE_RECRUITMENT_TASK", "RECRUITMENT_TASK", task.getId(), task.getName(),
                "更新任务策略、配额、时间窗口和审核设置");
        return RecruitmentTaskResponse.from(task);
    }

    @Transactional
    public RecruitmentTaskResponse changeStatus(UUID id, RecruitmentTaskStatus target) {
        SystemUser user = requireManager();
        RecruitmentTask task = requireAccessibleTask(id, user);
        if (task.getStatus() == target) return RecruitmentTaskResponse.from(task);
        validateTransition(task.getStatus(), target);
        if (target == RecruitmentTaskStatus.READY || target == RecruitmentTaskStatus.RUNNING) {
            requireEligibleBinding(task.getJobPosition().getId(), task.getBossAccount().getId(), user);
        }
        RecruitmentTaskStatus previous = task.getStatus();
        task.changeStatus(target);
        auditService.success("CHANGE_RECRUITMENT_TASK_STATUS", "RECRUITMENT_TASK", task.getId(), task.getName(),
                "任务状态由 " + previous.name() + " 变更为 " + target.name());
        return RecruitmentTaskResponse.from(task);
    }

    @Transactional(readOnly = true)
    public List<TaskExecutionResponse> listExecutions(UUID id) {
        SystemUser user = currentUserService.requireCurrentUser();
        requireAccessibleTask(id, user);
        return executionRepository.findTop20ByTaskIdOrderByStartedAtDesc(id).stream()
                .map(TaskExecutionResponse::from).toList();
    }

    @Transactional
    public TaskRunResponse run(UUID id, String idempotencyKey) {
        SystemUser user = requireManager();
        RecruitmentTask task = requireAccessibleTask(id, user);
        return execute(task, cleanIdempotencyKey(idempotencyKey), user, false, null, null);
    }

    @Transactional
    public TaskRunResponse retry(UUID id, String idempotencyKey) {
        SystemUser user = requireManager();
        RecruitmentTask task = requireAccessibleTask(id, user);
        String key = cleanIdempotencyKey(idempotencyKey);
        var existing = executionRepository.findByTaskIdAndIdempotencyKey(task.getId(), key);
        if (existing.isPresent()) {
            return new TaskRunResponse(RecruitmentTaskResponse.from(task), TaskExecutionResponse.from(existing.get()), true);
        }
        if (task.getStatus() != RecruitmentTaskStatus.FAILED
                && task.getStatus() != RecruitmentTaskStatus.NEEDS_ATTENTION) {
            throw new ApiException(HttpStatus.CONFLICT, "TASK_NOT_RETRYABLE", "只有失败或需人工介入的任务可以重试");
        }
        task.changeStatus(RecruitmentTaskStatus.RUNNING);
        return execute(task, key, user, true, null, null);
    }

    @Transactional
    public void runScheduled(UUID id, String idempotencyKey, String schedulerOwner, Instant nextAttemptAt) {
        RecruitmentTask task = taskRepository.findWithDetailsById(id).orElse(null);
        if (task == null || task.getStatus() != RecruitmentTaskStatus.RUNNING || !task.isSchedulerEnabled()) return;
        requireEligibleBinding(task.getJobPosition().getId(), task.getBossAccount().getId(), null);
        ZonedDateTime now = ZonedDateTime.now(requireZone(task.getTimezone()));
        if (!insideWindow(now.toLocalTime(), task.getWindowStart(), task.getWindowEnd())) {
            task.scheduleNext(Instant.now(), nextAttemptAt, schedulerOwner);
            return;
        }
        task.prepareQuota(now.toLocalDate());
        if (task.getDailyQuota() - task.getProcessedToday() <= 0) {
            task.changeStatus(RecruitmentTaskStatus.COMPLETED);
            task.scheduleNext(Instant.now(), null, schedulerOwner);
            return;
        }
        execute(task, cleanIdempotencyKey(idempotencyKey), null, false, schedulerOwner, nextAttemptAt);
    }

    private TaskRunResponse execute(RecruitmentTask task, String key, SystemUser user, boolean retry,
                                    String schedulerOwner, Instant nextAttemptAt) {
        var existing = executionRepository.findByTaskIdAndIdempotencyKey(task.getId(), key);
        if (existing.isPresent()) {
            if (schedulerOwner != null) task.scheduleNext(Instant.now(), nextAttemptAt, schedulerOwner);
            return new TaskRunResponse(RecruitmentTaskResponse.from(task), TaskExecutionResponse.from(existing.get()), true);
        }
        if (task.getStatus() != RecruitmentTaskStatus.RUNNING) {
            throw new ApiException(HttpStatus.CONFLICT, "TASK_NOT_RUNNING", "任务必须处于运行中才能执行");
        }
        requireEligibleBinding(task.getJobPosition().getId(), task.getBossAccount().getId(), user);
        ZoneId zone = requireZone(task.getTimezone());
        ZonedDateTime now = ZonedDateTime.now(zone);
        if (!insideWindow(now.toLocalTime(), task.getWindowStart(), task.getWindowEnd())) {
            throw new ApiException(HttpStatus.CONFLICT, "OUTSIDE_EXECUTION_WINDOW", "当前时间不在任务运行窗口内");
        }
        LocalDate today = now.toLocalDate();
        task.prepareQuota(today);
        int remaining = task.getDailyQuota() - task.getProcessedToday();
        if (remaining <= 0) {
            task.changeStatus(RecruitmentTaskStatus.COMPLETED);
            throw new ApiException(HttpStatus.CONFLICT, "DAILY_QUOTA_REACHED", "任务已达到当日配额");
        }
        int requested = Math.min(remaining, 5);
        Instant startedAt = Instant.now();
        var gatewayResult = gateway.executeRecruitmentCycle(task.getBossAccount(),
                new BossGateway.RecruitmentCycleRequest(task.getId(), key, requested,
                        task.getExecutionStrategy().name(), task.getMockOutcome().name()));
        TaskExecutionStatus executionStatus = TaskExecutionStatus.valueOf(gatewayResult.outcome().name());
        RecruitmentTaskExecution execution = executionRepository.save(new RecruitmentTaskExecution(task, key,
                Math.toIntExact(executionRepository.countByTaskId(task.getId()) + 1), requested,
                gatewayResult.processedCount(), executionStatus, gatewayResult.message(), startedAt, Instant.now()));
        switch (gatewayResult.outcome()) {
            case SUCCEEDED -> task.applySuccess(gatewayResult.processedCount(), Instant.now());
            case FAILED -> task.applyFailure(gatewayResult.message(), Instant.now());
            case NEEDS_ATTENTION -> task.applyNeedsAttention(gatewayResult.message(), Instant.now());
        }
        if (schedulerOwner != null) {
            task.scheduleNext(Instant.now(), task.getStatus() == RecruitmentTaskStatus.RUNNING ? nextAttemptAt : null, schedulerOwner);
            auditService.systemSuccess("SCHEDULE_RECRUITMENT_TASK", "RECRUITMENT_TASK", task.getId(), task.getName(),
                    "Gateway 执行结果 " + gatewayResult.outcome().name() + "，处理 " + gatewayResult.processedCount() + " 项");
        } else {
            auditService.success(retry ? "RETRY_RECRUITMENT_TASK" : "RUN_RECRUITMENT_TASK",
                    "RECRUITMENT_TASK", task.getId(), task.getName(),
                    "Gateway 执行结果 " + gatewayResult.outcome().name() + "，处理 " + gatewayResult.processedCount() + " 项");
        }
        return new TaskRunResponse(RecruitmentTaskResponse.from(task), TaskExecutionResponse.from(execution), false);
    }

    private void validateTransition(RecruitmentTaskStatus current, RecruitmentTaskStatus target) {
        boolean allowed = (current == RecruitmentTaskStatus.DRAFT && target == RecruitmentTaskStatus.READY)
                || (current == RecruitmentTaskStatus.READY && target == RecruitmentTaskStatus.RUNNING)
                || (current == RecruitmentTaskStatus.RUNNING && target == RecruitmentTaskStatus.PAUSED)
                || (current == RecruitmentTaskStatus.PAUSED && target == RecruitmentTaskStatus.RUNNING);
        if (!allowed) throw new ApiException(HttpStatus.CONFLICT, "INVALID_TASK_STATUS_TRANSITION",
                "任务状态不能从 " + current.name() + " 变更为 " + target.name());
    }

    private JobPosition requireEligibleBinding(UUID jobId, UUID bossAccountId, SystemUser user) {
        JobPosition job = jobRepository.findWithDetailsById(jobId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "JOB_POSITION_NOT_FOUND", "职位不存在"));
        if (user != null) requireCompanyAccess(job.getCompany().getId(), user);
        if (job.getStatus() != JobPositionStatus.ACTIVE) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "JOB_POSITION_NOT_ACTIVE", "任务只能绑定已启用职位");
        }
        BossAccount account = job.getBossAccount();
        if (!account.getId().equals(bossAccountId)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "TASK_BOSS_ACCOUNT_MISMATCH", "任务 BOSS 账号必须与职位绑定账号一致");
        }
        if (account.getStatus() != BossAccountStatus.ACTIVE) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "BOSS_ACCOUNT_INACTIVE", "任务 BOSS 账号已停用");
        }
        if (!account.getCapabilities().containsAll(Set.of(BossCapability.JOB_SYNC, BossCapability.CANDIDATE_READ))) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "TASK_CAPABILITIES_UNAVAILABLE",
                    "任务需要 BOSS 账号同时具备职位同步和候选人读取能力");
        }
        return job;
    }

    private RecruitmentTask requireAccessibleTask(UUID id, SystemUser user) {
        RecruitmentTask task = taskRepository.findWithDetailsById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "RECRUITMENT_TASK_NOT_FOUND", "招聘任务不存在"));
        requireCompanyAccess(task.getJobPosition().getCompany().getId(), user);
        return task;
    }

    private SystemUser requireManager() {
        SystemUser user = currentUserService.requireCurrentUser();
        if (user.getRole() != UserRole.SYSTEM_ADMIN && user.getRole() != UserRole.RECRUITMENT_ADMIN) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "当前账号没有自动招聘任务管理权限");
        }
        return user;
    }

    private void requireCompanyAccess(UUID companyId, SystemUser user) {
        Set<UUID> allowedIds = allowedCompanyIds(user);
        if (allowedIds != null && !allowedIds.contains(companyId)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "COMPANY_SCOPE_FORBIDDEN", "当前账号无权访问该企业数据");
        }
    }

    private Set<UUID> allowedCompanyIds(SystemUser user) {
        if (user.getRole() == UserRole.SYSTEM_ADMIN) return null;
        return user.getCompanyScopes().stream().map(Company::getId).collect(Collectors.toSet());
    }

    private boolean insideWindow(LocalTime now, LocalTime start, LocalTime end) {
        if (start.equals(end)) return true;
        if (start.isBefore(end)) return !now.isBefore(start) && !now.isAfter(end);
        return !now.isBefore(start) || !now.isAfter(end);
    }

    private ZoneId requireZone(String timezone) {
        try { return ZoneId.of(timezone); }
        catch (DateTimeException exception) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_TIMEZONE", "时区无效，请使用例如 Asia/Shanghai 的 IANA 时区");
        }
    }

    private String cleanIdempotencyKey(String value) {
        if (value == null || value.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_REQUIRED", "执行任务必须提供 Idempotency-Key");
        }
        String clean = value.trim();
        if (clean.length() > 100) throw new ApiException(HttpStatus.BAD_REQUEST, "IDEMPOTENCY_KEY_TOO_LONG", "Idempotency-Key 不能超过 100 个字符");
        return clean;
    }

    private String cleanRequired(String value) { return value.trim(); }
}
