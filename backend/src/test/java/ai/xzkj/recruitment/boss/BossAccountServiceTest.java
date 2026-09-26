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
    @Mock private AuditService auditService;

    private BossAccountService service;
    private Company allowedCompany;
    private Company hiddenCompany;

    @BeforeEach
    void setUp() {
        service = new BossAccountService(accountRepository, companyRepository, currentUserService, auditService);
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
                allowedCompany.getId(), " 上海招聘账号 ", " boss-sh-01 "));

        assertThat(response.displayName()).isEqualTo("上海招聘账号");
        assertThat(response.externalIdentifier()).isEqualTo("boss-sh-01");
        assertThat(response.connectionStatus()).isEqualTo(BossConnectionStatus.UNVERIFIED);
        verify(auditService).success("CREATE_BOSS_ACCOUNT", "BOSS_ACCOUNT", response.id(), "上海招聘账号",
                "新增本地 CDP 连接器 BOSS 账号，归属企业 ALLOWED");
    }

    @Test
    void recruiterCannotManageAccounts() {
        when(currentUserService.requireCurrentUser()).thenReturn(user(UserRole.RECRUITER, allowedCompany));

        assertThatThrownBy(() -> service.create(new BossAccountUpsertRequest(
                allowedCompany.getId(), "账号", "boss-01")))
                .isInstanceOf(ApiException.class)
                .hasMessage("当前账号没有 BOSS 账号管理权限");
        verify(accountRepository, never()).save(any());
    }

    @Test
    void listOnlyReturnsAccountsInsideCompanyScope() {
        SystemUser recruiter = user(UserRole.RECRUITER, allowedCompany);
        when(currentUserService.requireCurrentUser()).thenReturn(recruiter);
        BossAccount visible = new BossAccount(allowedCompany, "可见账号", "visible");
        visible.assignRecruiters(Set.of(recruiter.getId()));
        when(accountRepository.findAllByOrderByCreatedAtDesc()).thenReturn(List.of(
                new BossAccount(hiddenCompany, "隐藏账号", "hidden"),
                visible, new BossAccount(allowedCompany, "未分配账号", "unassigned")));

        List<BossAccountResponse> response = service.list(null, null, null, null);

        assertThat(response).extracting(BossAccountResponse::displayName).containsExactly("可见账号");
    }

    private SystemUser user(UserRole role, Company company) {
        SystemUser user = new SystemUser(role.name().toLowerCase(), "hash", role.name(), role);
        user.assignCompanyScopes(Set.of(company));
        return user;
    }

    @Test
    void recruiterSeesNamesButOnlyClaimsAnUnboundAccountInTheirCompany() {
        SystemUser recruiter = user(UserRole.RECRUITER, allowedCompany);
        when(currentUserService.requireCurrentUser()).thenReturn(recruiter);
        BossAccount free = new BossAccount(allowedCompany, "可绑定", "free");
        BossAccount occupied = new BossAccount(allowedCompany, "已绑定", "occupied");
        occupied.assignRecruiters(Set.of(java.util.UUID.randomUUID()));
        BossAccount foreign = new BossAccount(hiddenCompany, "跨企业", "foreign");
        when(accountRepository.findAllByOrderByCreatedAtDesc()).thenReturn(List.of(free, occupied, foreign));
        assertThat(service.bindableAccounts()).extracting(BossAccountService.BindableAccount::bindingStatus)
                .containsExactly("AVAILABLE", "BOUND");
        assertThat(service.list(null, null, null, null)).isEmpty();
        when(accountRepository.findForUpdateById(occupied.getId())).thenReturn(Optional.of(occupied));
        assertThatThrownBy(() -> service.claim(occupied.getId())).hasMessageContaining("其他专员");
        when(accountRepository.findForUpdateById(foreign.getId())).thenReturn(Optional.of(foreign));
        assertThatThrownBy(() -> service.claim(foreign.getId())).isInstanceOf(ApiException.class);
        when(accountRepository.findForUpdateById(free.getId())).thenReturn(Optional.of(free));
        jakarta.persistence.EntityManager em = org.mockito.Mockito.mock(jakarta.persistence.EntityManager.class);
        jakarta.persistence.Query query = org.mockito.Mockito.mock(jakarta.persistence.Query.class, org.mockito.Mockito.RETURNS_SELF);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "entityManager", em);
        when(em.find(SystemUser.class, recruiter.getId())).thenReturn(recruiter);
        when(em.createQuery(any(String.class))).thenReturn(query);
        assertThat(service.claim(free.getId()).id()).isEqualTo(free.getId());
        assertThat(service.claim(free.getId()).id()).isEqualTo(free.getId());
        assertThat(service.list(null, null, null, null)).extracting(BossAccountResponse::id).containsExactly(free.getId());
        verify(query).executeUpdate();
    }

    @Test
    void deleteHidesAccountRevokesDevicesAndCannotBeReactivated() {
        when(currentUserService.requireCurrentUser()).thenReturn(user(UserRole.RECRUITMENT_ADMIN, allowedCompany));
        BossAccount account = new BossAccount(allowedCompany, "账号", "existing");
        when(accountRepository.findWithDetailsById(account.getId())).thenReturn(Optional.of(account));
        jakarta.persistence.EntityManager em = org.mockito.Mockito.mock(jakarta.persistence.EntityManager.class);
        jakarta.persistence.Query query = org.mockito.Mockito.mock(jakarta.persistence.Query.class, org.mockito.Mockito.RETURNS_SELF);
        org.springframework.test.util.ReflectionTestUtils.setField(service, "entityManager", em);
        when(em.createQuery(any(String.class))).thenReturn(query);
        service.delete(account.getId());
        assertThat(account.isDeleted()).isTrue();
        assertThat(account.getStatus()).isEqualTo(BossAccountStatus.INACTIVE);
        verify(query).executeUpdate();
        when(accountRepository.findAllByOrderByCreatedAtDesc()).thenReturn(List.of(account));
        assertThat(service.list(null, null, null, null)).isEmpty();
        assertThatThrownBy(() -> service.changeStatus(account.getId(), BossAccountStatus.ACTIVE)).isInstanceOf(ApiException.class);
    }

    @Test
    void deleteRejectsRecruiterAndForeignCompany() {
        BossAccount account = new BossAccount(hiddenCompany, "其他企业账号", "foreign");
        when(currentUserService.requireCurrentUser()).thenReturn(user(UserRole.RECRUITER, allowedCompany));
        assertThatThrownBy(() -> service.delete(account.getId())).isInstanceOf(ApiException.class);
        when(currentUserService.requireCurrentUser()).thenReturn(user(UserRole.RECRUITMENT_ADMIN, allowedCompany));
        when(accountRepository.findWithDetailsById(account.getId())).thenReturn(Optional.of(account));
        assertThatThrownBy(() -> service.delete(account.getId())).isInstanceOf(ApiException.class);
        assertThat(account.isDeleted()).isFalse();
    }
}
