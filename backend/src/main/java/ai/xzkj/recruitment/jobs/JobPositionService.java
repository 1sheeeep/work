package ai.xzkj.recruitment.jobs;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.boss.BossAccountRepository;
import ai.xzkj.recruitment.boss.BossAccountStatus;
import ai.xzkj.recruitment.boss.BossCapability;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.organization.CompanyRepository;
import ai.xzkj.recruitment.organization.CompanyStatus;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class JobPositionService {
    private final JobPositionRepository jobRepository;
    private final CompanyRepository companyRepository;
    private final BossAccountRepository bossAccountRepository;
    private final CurrentUserService currentUserService;
    private final AuditService auditService;

    public JobPositionService(JobPositionRepository jobRepository, CompanyRepository companyRepository,
                              BossAccountRepository bossAccountRepository, CurrentUserService currentUserService,
                              AuditService auditService) {
        this.jobRepository = jobRepository;
        this.companyRepository = companyRepository;
        this.bossAccountRepository = bossAccountRepository;
        this.currentUserService = currentUserService;
        this.auditService = auditService;
    }

    @Transactional(readOnly = true)
    public List<JobPositionResponse> list(String keyword, UUID companyId, UUID bossAccountId, JobPositionStatus status) {
        SystemUser user = currentUserService.requireCurrentUser();
        Set<UUID> allowedIds = allowedCompanyIds(user);
        if (companyId != null && allowedIds != null && !allowedIds.contains(companyId)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "COMPANY_SCOPE_FORBIDDEN", "当前账号无权访问该企业数据");
        }
        String normalized = keyword == null ? "" : keyword.trim().toLowerCase(Locale.ROOT);
        return jobRepository.findAllByOrderByCreatedAtDesc().stream()
                .filter(job -> allowedIds == null || allowedIds.contains(job.getCompany().getId()))
                .filter(job -> companyId == null || companyId.equals(job.getCompany().getId()))
                .filter(job -> bossAccountId == null || bossAccountId.equals(job.getBossAccount().getId()))
                .filter(job -> status == null || status == job.getStatus())
                .filter(job -> normalized.isBlank()
                        || job.getTitle().toLowerCase(Locale.ROOT).contains(normalized)
                        || job.getLocation().toLowerCase(Locale.ROOT).contains(normalized)
                        || job.getBossAccount().getDisplayName().toLowerCase(Locale.ROOT).contains(normalized))
                .map(JobPositionResponse::from)
                .toList();
    }

    @Transactional
    public JobPositionResponse create(JobPositionUpsertRequest request) {
        SystemUser user = requireManager();
        validateSalary(request);
        Company company = requireActiveAccessibleCompany(request.companyId(), user);
        BossAccount account = requireEligibleBossAccount(request.bossAccountId(), company, user);
        JobPosition job = jobRepository.save(new JobPosition(
                company, account, cleanRequired(request.title()), cleanRequired(request.location()),
                request.salaryMinK(), request.salaryMaxK(), request.salaryMonths(),
                cleanRequired(request.experienceRequirement()), cleanRequired(request.educationRequirement()),
                cleanRequired(request.description()), cleanOptional(request.screeningRequirements())));
        auditService.success("CREATE_JOB_POSITION", "JOB_POSITION", job.getId(), job.getTitle(),
                "新增职位草稿，归属企业 " + company.getCode() + "，绑定 BOSS 账号 " + account.getDisplayName());
        return JobPositionResponse.from(job);
    }

    @Transactional
    public JobPositionResponse update(UUID id, JobPositionUpsertRequest request) {
        SystemUser user = requireManager();
        JobPosition job = requireAccessibleJob(id, user);
        if (job.getStatus() == JobPositionStatus.CLOSED) {
            throw new ApiException(HttpStatus.CONFLICT, "JOB_POSITION_CLOSED", "已关闭职位不能再编辑");
        }
        validateSalary(request);
        Company company = requireActiveAccessibleCompany(request.companyId(), user);
        BossAccount account = requireEligibleBossAccount(request.bossAccountId(), company, user);
        job.update(company, account, cleanRequired(request.title()), cleanRequired(request.location()),
                request.salaryMinK(), request.salaryMaxK(), request.salaryMonths(),
                cleanRequired(request.experienceRequirement()), cleanRequired(request.educationRequirement()),
                cleanRequired(request.description()), cleanOptional(request.screeningRequirements()));
        auditService.success("UPDATE_JOB_POSITION", "JOB_POSITION", job.getId(), job.getTitle(),
                "更新职位资料和 BOSS 账号绑定");
        return JobPositionResponse.from(job);
    }

    @Transactional
    public JobPositionResponse changeStatus(UUID id, JobPositionStatus targetStatus) {
        SystemUser user = requireManager();
        JobPosition job = requireAccessibleJob(id, user);
        if (job.getStatus() == targetStatus) return JobPositionResponse.from(job);
        validateTransition(job.getStatus(), targetStatus);
        if (targetStatus == JobPositionStatus.ACTIVE) {
            Company company = requireActiveAccessibleCompany(job.getCompany().getId(), user);
            requireEligibleBossAccount(job.getBossAccount().getId(), company, user);
        }
        JobPositionStatus previous = job.getStatus();
        job.changeStatus(targetStatus);
        auditService.success("CHANGE_JOB_POSITION_STATUS", "JOB_POSITION", job.getId(), job.getTitle(),
                "职位状态由 " + previous.name() + " 变更为 " + targetStatus.name());
        return JobPositionResponse.from(job);
    }

    @Transactional
    public JobPositionResponse updateKnowledge(UUID id, JobKnowledgeRequest request) {
        SystemUser user = requireManager();
        JobPosition job = requireAccessibleJob(id, user);
        String summary = cleanOptional(request.replySummary());
        String salary = cleanOptional(request.salaryDisplay());
        if (request.approved() && summary == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INCOMPLETE_JOB_KNOWLEDGE", "审核通过前请填写岗位简介");
        }
        job.updateKnowledge(summary, salary, request.approved());
        auditService.success("UPDATE_JOB_KNOWLEDGE", "JOB_POSITION", job.getId(), job.getTitle(),
                request.approved() ? "更新并审核通过岗位回复知识" : "更新岗位回复知识（未审核）");
        return JobPositionResponse.from(job);
    }

    @Transactional
    public JobPositionResponse verifyVisiblePageCapture(UUID id) {
        SystemUser user = requireManager();
        JobPosition job = requireAccessibleJob(id, user);
        if (!"VISIBLE_PAGE".equals(job.getCaptureSource())) {
            throw new ApiException(HttpStatus.CONFLICT, "JOB_CAPTURE_NOT_VISIBLE_PAGE", "该职位不是从页面采集，无需执行页面核对");
        }
        if (!job.isCaptureVerified()) {
            job.verifyVisiblePageCapture();
            auditService.success("VERIFY_JOB_CAPTURE", "JOB_POSITION", job.getId(), job.getTitle(),
                    "HR 已人工核对页面采集的岗位资料；页面 URL 和 Cookie 均未记录");
        }
        return JobPositionResponse.from(job);
    }

    @Transactional(readOnly = true)
    public ReplyPreviewResponse previewReply(UUID id) {
        SystemUser user = currentUserService.requireCurrentUser();
        JobPosition job = requireAccessibleJob(id, user);
        Company company = job.getCompany();
        SafeReplyComposer.Composition result = SafeReplyComposer.compose(job);
        return new ReplyPreviewResponse(result.mode(), result.content(), result.missingFields(),
                company.getKnowledgeVersion(), job.getKnowledgeVersion());
    }

    private void validateTransition(JobPositionStatus current, JobPositionStatus target) {
        boolean allowed = (current == JobPositionStatus.DRAFT
                && (target == JobPositionStatus.ACTIVE || target == JobPositionStatus.CLOSED))
                || (current == JobPositionStatus.ACTIVE && target == JobPositionStatus.CLOSED);
        if (!allowed) {
            throw new ApiException(HttpStatus.CONFLICT, "INVALID_JOB_STATUS_TRANSITION",
                    "职位状态不能从 " + current.name() + " 变更为 " + target.name());
        }
    }

    private void validateSalary(JobPositionUpsertRequest request) {
        if (request.salaryMaxK() < request.salaryMinK()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_SALARY_RANGE", "月薪上限不能低于月薪下限");
        }
    }

    private SystemUser requireManager() {
        SystemUser user = currentUserService.requireCurrentUser();
        if (user.getRole() != UserRole.SYSTEM_ADMIN && user.getRole() != UserRole.RECRUITMENT_ADMIN) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "当前账号没有职位管理权限");
        }
        return user;
    }

    private JobPosition requireAccessibleJob(UUID id, SystemUser user) {
        JobPosition job = jobRepository.findWithDetailsById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "JOB_POSITION_NOT_FOUND", "职位不存在"));
        requireCompanyAccess(job.getCompany().getId(), user);
        return job;
    }

    private Company requireActiveAccessibleCompany(UUID id, SystemUser user) {
        requireCompanyAccess(id, user);
        Company company = companyRepository.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "COMPANY_NOT_FOUND", "企业不存在"));
        if (company.getStatus() != CompanyStatus.ACTIVE) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INACTIVE_COMPANY", "已停用企业不能配置职位");
        }
        return company;
    }

    private BossAccount requireEligibleBossAccount(UUID id, Company company, SystemUser user) {
        BossAccount account = bossAccountRepository.findWithDetailsById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "BOSS_ACCOUNT_NOT_FOUND", "BOSS 账号不存在"));
        requireCompanyAccess(account.getCompany().getId(), user);
        if (!account.getCompany().getId().equals(company.getId())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "BOSS_ACCOUNT_COMPANY_MISMATCH", "BOSS 账号与职位必须归属同一企业");
        }
        if (account.getStatus() != BossAccountStatus.ACTIVE) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "BOSS_ACCOUNT_INACTIVE", "职位只能绑定已启用的 BOSS 账号");
        }
        if (!account.getCapabilities().contains(BossCapability.JOB_SYNC)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "BOSS_JOB_SYNC_UNAVAILABLE", "请先完成 BOSS 账号能力检查，并确认具备职位同步能力");
        }
        return account;
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

    private String cleanRequired(String value) { return value.trim(); }

    private String cleanOptional(String value) {
        if (value == null || value.isBlank()) return null;
        return value.trim();
    }

}
