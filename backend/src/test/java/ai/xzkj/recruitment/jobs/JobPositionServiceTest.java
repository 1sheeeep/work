package ai.xzkj.recruitment.jobs;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.boss.BossAccountRepository;
import ai.xzkj.recruitment.boss.BossCapability;
import ai.xzkj.recruitment.boss.BossConnectionStatus;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.organization.CompanyRepository;
import ai.xzkj.recruitment.organization.GroupProfile;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class JobPositionServiceTest {
    @Mock private JobPositionRepository jobRepository;
    @Mock private CompanyRepository companyRepository;
    @Mock private BossAccountRepository bossAccountRepository;
    @Mock private CurrentUserService currentUserService;
    @Mock private AuditService auditService;

    private JobPositionService service;
    private Company allowedCompany;
    private Company hiddenCompany;
    private BossAccount eligibleAccount;

    @BeforeEach
    void setUp() {
        service = new JobPositionService(jobRepository, companyRepository, bossAccountRepository,
                currentUserService, auditService);
        GroupProfile group = new GroupProfile("测试集团", "测试");
        allowedCompany = new Company(group, "已授权企业", "ALLOWED", null, null);
        hiddenCompany = new Company(group, "未授权企业", "HIDDEN", null, null);
        eligibleAccount = account(allowedCompany, "可用账号");
    }

    @Test
    void recruitmentAdminCreatesDraftWithEligibleAccount() {
        SystemUser admin = user(UserRole.RECRUITMENT_ADMIN, allowedCompany);
        when(currentUserService.requireCurrentUser()).thenReturn(admin);
        when(companyRepository.findById(allowedCompany.getId())).thenReturn(Optional.of(allowedCompany));
        when(bossAccountRepository.findWithDetailsById(eligibleAccount.getId())).thenReturn(Optional.of(eligibleAccount));
        when(jobRepository.save(any(JobPosition.class))).thenAnswer(invocation -> invocation.getArgument(0));

        JobPositionResponse response = service.create(request(allowedCompany, eligibleAccount));

        assertThat(response.title()).isEqualTo("Java 开发工程师");
        assertThat(response.status()).isEqualTo(JobPositionStatus.DRAFT);
        assertThat(response.salaryMinK()).isEqualTo(20);
        assertThat(response.bossAccount().id()).isEqualTo(eligibleAccount.getId());
        verify(auditService).success("CREATE_JOB_POSITION", "JOB_POSITION", response.id(), "Java 开发工程师",
                "新增职位草稿，归属企业 ALLOWED，绑定 BOSS 账号 可用账号");
    }

    @Test
    void recruiterCannotCreateJob() {
        when(currentUserService.requireCurrentUser()).thenReturn(user(UserRole.RECRUITER, allowedCompany));

        assertThatThrownBy(() -> service.create(request(allowedCompany, eligibleAccount)))
                .isInstanceOf(ApiException.class)
                .hasMessage("当前账号没有职位管理权限");
        verify(jobRepository, never()).save(any());
    }

    @Test
    void rejectsBossAccountFromAnotherCompany() {
        BossAccount wrongAccount = account(hiddenCompany, "跨企业账号");
        SystemUser admin = user(UserRole.SYSTEM_ADMIN, allowedCompany);
        when(currentUserService.requireCurrentUser()).thenReturn(admin);
        when(companyRepository.findById(allowedCompany.getId())).thenReturn(Optional.of(allowedCompany));
        when(bossAccountRepository.findWithDetailsById(wrongAccount.getId())).thenReturn(Optional.of(wrongAccount));

        assertThatThrownBy(() -> service.create(request(allowedCompany, wrongAccount)))
                .isInstanceOf(ApiException.class)
                .hasMessage("BOSS 账号与职位必须归属同一企业");
    }

    @Test
    void rejectsAccountWithoutJobSyncCapability() {
        BossAccount uncheckedAccount = new BossAccount(allowedCompany, "未检查账号", "unchecked");
        SystemUser admin = user(UserRole.RECRUITMENT_ADMIN, allowedCompany);
        when(currentUserService.requireCurrentUser()).thenReturn(admin);
        when(companyRepository.findById(allowedCompany.getId())).thenReturn(Optional.of(allowedCompany));
        when(bossAccountRepository.findWithDetailsById(uncheckedAccount.getId())).thenReturn(Optional.of(uncheckedAccount));

        assertThatThrownBy(() -> service.create(request(allowedCompany, uncheckedAccount)))
                .isInstanceOf(ApiException.class)
                .hasMessage("请先完成 BOSS 账号能力检查，并确认具备职位同步能力");
    }

    @Test
    void listOnlyReturnsJobsInsideCompanyScope() {
        BossAccount hiddenAccount = account(hiddenCompany, "隐藏账号");
        when(currentUserService.requireCurrentUser()).thenReturn(user(UserRole.RECRUITER, allowedCompany));
        when(jobRepository.findAllByOrderByCreatedAtDesc()).thenReturn(List.of(
                job(hiddenCompany, hiddenAccount, "隐藏职位"),
                job(allowedCompany, eligibleAccount, "可见职位")));

        List<JobPositionResponse> response = service.list(null, null, null, null);

        assertThat(response).extracting(JobPositionResponse::title).containsExactly("可见职位");
    }

    @Test
    void closedJobIsTerminalAndCannotBeEdited() {
        SystemUser admin = user(UserRole.RECRUITMENT_ADMIN, allowedCompany);
        JobPosition job = job(allowedCompany, eligibleAccount, "终态职位");
        job.changeStatus(JobPositionStatus.CLOSED);
        when(currentUserService.requireCurrentUser()).thenReturn(admin);
        when(jobRepository.findWithDetailsById(job.getId())).thenReturn(Optional.of(job));

        assertThatThrownBy(() -> service.changeStatus(job.getId(), JobPositionStatus.ACTIVE))
                .isInstanceOf(ApiException.class)
                .hasMessage("职位状态不能从 CLOSED 变更为 ACTIVE");
        assertThatThrownBy(() -> service.update(job.getId(), request(allowedCompany, eligibleAccount)))
                .isInstanceOf(ApiException.class)
                .hasMessage("已关闭职位不能再编辑");
    }

    @Test
    void previewUsesOnlyApprovedCompanyAndJobKnowledge() {
        SystemUser recruiter = user(UserRole.RECRUITER, allowedCompany);
        JobPosition job = job(allowedCompany, eligibleAccount, "Java 开发工程师");
        allowedCompany.updateKnowledge("企业软件服务", "100-499人", "专注于企业数字化产品", true);
        job.updateKnowledge("负责稳定的后端服务开发", "20-35K·13薪", true);
        when(currentUserService.requireCurrentUser()).thenReturn(recruiter);
        when(jobRepository.findWithDetailsById(job.getId())).thenReturn(Optional.of(job));

        ReplyPreviewResponse response = service.previewReply(job.getId());

        assertThat(response.mode()).isEqualTo("KNOWLEDGE");
        assertThat(response.content()).contains("Java 开发工程师", "企业软件服务", "负责稳定的后端服务开发");
        assertThat(response.missingFields()).isEmpty();
    }

    @Test
    void previewFallsBackWhenKnowledgeIsMissingOrUnapproved() {
        SystemUser recruiter = user(UserRole.RECRUITER, allowedCompany);
        JobPosition job = job(allowedCompany, eligibleAccount, "Java 开发工程师");
        when(currentUserService.requireCurrentUser()).thenReturn(recruiter);
        when(jobRepository.findWithDetailsById(job.getId())).thenReturn(Optional.of(job));

        ReplyPreviewResponse response = service.previewReply(job.getId());

        assertThat(response.mode()).isEqualTo("GENERIC");
        assertThat(response.content()).doesNotContain("Java 开发工程师", allowedCompany.getName());
        assertThat(response.missingFields()).contains("公司知识未审核", "岗位知识未审核");
    }

    @Test
    void reviewsAnObservedDraftAtomicallyAndActivatesIt() {
        SystemUser admin = user(UserRole.RECRUITMENT_ADMIN, allowedCompany);
        JobPosition job = job(allowedCompany, eligibleAccount, "Java 开发工程师");
        job.markUnreadObservation("a".repeat(64), true);
        allowedCompany.updateKnowledge("企业软件服务", "100-499人", "专注于企业数字化产品", true);
        when(currentUserService.requireCurrentUser()).thenReturn(admin);
        when(jobRepository.findWithDetailsById(job.getId())).thenReturn(Optional.of(job));
        when(companyRepository.findById(allowedCompany.getId())).thenReturn(Optional.of(allowedCompany));
        when(bossAccountRepository.findWithDetailsById(eligibleAccount.getId())).thenReturn(Optional.of(eligibleAccount));
        when(jobRepository.findAllByBossAccountIdAndStatus(eligibleAccount.getId(), JobPositionStatus.ACTIVE)).thenReturn(List.of());

        JobPositionResponse response = service.reviewAndActivate(job.getId(), reviewRequest());

        assertThat(response.status()).isEqualTo(JobPositionStatus.ACTIVE);
        assertThat(response.captureVerified()).isTrue();
        assertThat(response.knowledgeApproved()).isTrue();
        assertThat(response.safeReplyReady()).isTrue();
        assertThat(response.reviewReadiness().blockers()).isEmpty();
        verify(auditService).success("REVIEW_AND_ACTIVATE_IMPORTED_JOB", "JOB_POSITION", job.getId(),
                "Java 开发工程师", "HR 逐项核对真实岗位资料、批准岗位知识并启用；企业知识版本 v1，岗位知识版本 v1");
    }

    @Test
    void refusesObservedDraftActivationUntilCompanyKnowledgeIsApproved() {
        SystemUser admin = user(UserRole.RECRUITMENT_ADMIN, allowedCompany);
        JobPosition job = job(allowedCompany, eligibleAccount, "Java 开发工程师");
        job.markUnreadObservation("a".repeat(64), true);
        when(currentUserService.requireCurrentUser()).thenReturn(admin);
        when(jobRepository.findWithDetailsById(job.getId())).thenReturn(Optional.of(job));
        when(companyRepository.findById(allowedCompany.getId())).thenReturn(Optional.of(allowedCompany));
        when(bossAccountRepository.findWithDetailsById(eligibleAccount.getId())).thenReturn(Optional.of(eligibleAccount));

        assertThatThrownBy(() -> service.reviewAndActivate(job.getId(), reviewRequest()))
                .isInstanceOf(ApiException.class)
                .hasMessage("请先由系统管理员填写并审核企业回复知识");
        assertThat(job.getStatus()).isEqualTo(JobPositionStatus.DRAFT);
        assertThat(job.isCaptureVerified()).isFalse();
    }

    @Test
    void blocksLegacyActivationPathForAnIncompleteImportedDraft() {
        SystemUser admin = user(UserRole.RECRUITMENT_ADMIN, allowedCompany);
        JobPosition job = job(allowedCompany, eligibleAccount, "Java 开发工程师");
        job.markUnreadObservation("a".repeat(64), true);
        job.verifyVisiblePageCapture();
        when(currentUserService.requireCurrentUser()).thenReturn(admin);
        when(jobRepository.findWithDetailsById(job.getId())).thenReturn(Optional.of(job));
        when(companyRepository.findById(allowedCompany.getId())).thenReturn(Optional.of(allowedCompany));
        when(bossAccountRepository.findWithDetailsById(eligibleAccount.getId())).thenReturn(Optional.of(eligibleAccount));

        assertThatThrownBy(() -> service.changeStatus(job.getId(), JobPositionStatus.ACTIVE))
                .isInstanceOf(ApiException.class)
                .hasMessage("采集岗位必须完成企业知识、岗位知识和页面资料审核后才能启用");
        assertThat(job.getStatus()).isEqualTo(JobPositionStatus.DRAFT);
    }

    private BossAccount account(Company company, String name) {
        BossAccount account = new BossAccount(company, name, name + "-id");
        account.applyCapabilityCheck(BossConnectionStatus.CONNECTED, Set.of(BossCapability.JOB_SYNC));
        return account;
    }

    private JobPosition job(Company company, BossAccount account, String title) {
        return new JobPosition(company, account, title, "上海", 20, 35, 13,
                "3-5 年", "本科", "负责后端系统开发", "Java 基础扎实");
    }

    private JobPositionUpsertRequest request(Company company, BossAccount account) {
        return new JobPositionUpsertRequest(company.getId(), account.getId(), " Java 开发工程师 ", " 上海 ",
                20, 35, 13, " 3-5 年 ", " 本科 ", " 负责后端系统开发 ", " Java 基础扎实 ");
    }

    private JobPositionReviewRequest reviewRequest() {
        return new JobPositionReviewRequest("上海·徐汇", 20, 35, 13, "3-5 年", "本科及以上",
                "负责企业招聘产品的后端服务开发", "Java 基础扎实", "负责稳定的后端服务开发",
                "20-35K·13薪，具体以面试沟通为准", true, true, true);
    }

    private SystemUser user(UserRole role, Company company) {
        SystemUser user = new SystemUser(role.name().toLowerCase(), "hash", role.name(), role);
        user.assignCompanyScopes(Set.of(company));
        return user;
    }
}
