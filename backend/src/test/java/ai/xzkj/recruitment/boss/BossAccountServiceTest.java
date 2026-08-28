package ai.xzkj.recruitment.boss;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
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
class BossAccountServiceTest {
    @Mock private BossAccountRepository accountRepository;
    @Mock private CompanyRepository companyRepository;
    @Mock private CurrentUserService currentUserService;
    @Mock private BossGateway gateway;
    @Mock private AuditService auditService;

    private BossAccountService service;
    private Company allowedCompany;
    private Company hiddenCompany;

    @BeforeEach
    void setUp() {
        service = new BossAccountService(accountRepository, companyRepository, currentUserService, gateway, auditService);
        GroupProfile group = new GroupProfile("测试集团", "测试");
        allowedCompany = new Company(group, "已授权企业", "ALLOWED", null, null);
        hiddenCompany = new Company(group, "未授权企业", "HIDDEN", null, null);
    }

    @Test
    void recruitmentAdminCreatesAccountInsideCompanyScope() {
        SystemUser admin = user(UserRole.RECRUITMENT_ADMIN, allowedCompany);
        when(currentUserService.requireCurrentUser()).thenReturn(admin);
        when(companyRepository.findById(allowedCompany.getId())).thenReturn(Optional.of(allowedCompany));
        when(accountRepository.existsByCompanyIdAndExternalIdentifierIgnoreCase(allowedCompany.getId(), "boss-sh-01"))
                .thenReturn(false);
        when(accountRepository.save(any(BossAccount.class))).thenAnswer(invocation -> invocation.getArgument(0));

        BossAccountResponse response = service.create(new BossAccountUpsertRequest(
                allowedCompany.getId(), " 上海招聘账号 ", " boss-sh-01 ", MockBossProfile.FULL));

        assertThat(response.displayName()).isEqualTo("上海招聘账号");
        assertThat(response.externalIdentifier()).isEqualTo("boss-sh-01");
        assertThat(response.connectionStatus()).isEqualTo(BossConnectionStatus.UNVERIFIED);
        verify(auditService).success("CREATE_BOSS_ACCOUNT", "BOSS_ACCOUNT", response.id(), "上海招聘账号",
                "新增 Mock BOSS 账号，归属企业 ALLOWED");
    }

    @Test
    void recruiterCannotManageAccounts() {
        when(currentUserService.requireCurrentUser()).thenReturn(user(UserRole.RECRUITER, allowedCompany));

        assertThatThrownBy(() -> service.create(new BossAccountUpsertRequest(
                allowedCompany.getId(), "账号", "boss-01", MockBossProfile.FULL)))
                .isInstanceOf(ApiException.class)
                .hasMessage("当前账号没有 BOSS 账号管理权限");
        verify(accountRepository, never()).save(any());
    }

    @Test
    void listOnlyReturnsAccountsInsideCompanyScope() {
        when(currentUserService.requireCurrentUser()).thenReturn(user(UserRole.RECRUITER, allowedCompany));
        when(accountRepository.findAllByOrderByCreatedAtDesc()).thenReturn(List.of(
                new BossAccount(hiddenCompany, "隐藏账号", "hidden", MockBossProfile.FULL),
                new BossAccount(allowedCompany, "可见账号", "visible", MockBossProfile.FULL)));

        List<BossAccountResponse> response = service.list(null, null, null, null);

        assertThat(response).extracting(BossAccountResponse::displayName).containsExactly("可见账号");
    }

    @Test
    void capabilityCheckPersistsGatewayResultAndAudit() {
        SystemUser admin = user(UserRole.RECRUITMENT_ADMIN, allowedCompany);
        BossAccount account = new BossAccount(allowedCompany, "完整能力账号", "full", MockBossProfile.FULL);
        when(currentUserService.requireCurrentUser()).thenReturn(admin);
        when(accountRepository.findWithDetailsById(account.getId())).thenReturn(Optional.of(account));
        when(gateway.inspect(account)).thenReturn(new BossGateway.BossCapabilityCheckResult(
                BossConnectionStatus.CONNECTED, Set.of(BossCapability.JOB_SYNC, BossCapability.MESSAGE_SEND)));

        BossAccountResponse response = service.checkCapabilities(account.getId());

        assertThat(response.connectionStatus()).isEqualTo(BossConnectionStatus.CONNECTED);
        assertThat(response.capabilities()).containsExactly(BossCapability.JOB_SYNC, BossCapability.MESSAGE_SEND);
        assertThat(response.lastCheckedAt()).isNotNull();
        verify(auditService).success("CHECK_BOSS_CAPABILITIES", "BOSS_ACCOUNT", account.getId(), "完整能力账号",
                "能力检查结果 CONNECTED，可用能力 2 项");
    }

    private SystemUser user(UserRole role, Company company) {
        SystemUser user = new SystemUser(role.name().toLowerCase(), "hash", role.name(), role);
        user.assignCompanyScopes(Set.of(company));
        return user;
    }
}
