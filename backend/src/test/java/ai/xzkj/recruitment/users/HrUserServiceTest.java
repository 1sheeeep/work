package ai.xzkj.recruitment.users;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.SystemUserRepository;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.organization.CompanyRepository;
import ai.xzkj.recruitment.organization.GroupProfile;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

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
class HrUserServiceTest {
    @Mock private SystemUserRepository userRepository;
    @Mock private CompanyRepository companyRepository;
    @Mock private PasswordEncoder passwordEncoder;
    @Mock private AuditService auditService;

    private HrUserService service;
    private Company company;

    @BeforeEach
    void setUp() {
        service = new HrUserService(userRepository, companyRepository, passwordEncoder, auditService);
        company = new Company(new GroupProfile("测试集团", "测试"), "上海公司", "SH", null, null);
    }

    @Test
    void createNormalizesUsernameAssignsScopeAndWritesAudit() {
        when(userRepository.existsByUsernameIgnoreCase("zhang.san")).thenReturn(false);
        when(companyRepository.findAllById(Set.of(company.getId()))).thenReturn(List.of(company));
        when(passwordEncoder.encode("SecurePass123")).thenReturn("{bcrypt}encoded");
        when(userRepository.save(any(SystemUser.class))).thenAnswer(invocation -> invocation.getArgument(0));

        HrUserResponse response = service.create(new HrUserCreateRequest(
                " Zhang.San ", " 张三 ", UserRole.RECRUITER, "SecurePass123", Set.of(company.getId())));

        assertThat(response.username()).isEqualTo("zhang.san");
        assertThat(response.displayName()).isEqualTo("张三");
        assertThat(response.companies()).extracting(HrUserResponse.CompanyScopeResponse::id)
                .containsExactly(company.getId());
        ArgumentCaptor<SystemUser> userCaptor = ArgumentCaptor.forClass(SystemUser.class);
        verify(userRepository).save(userCaptor.capture());
        assertThat(userCaptor.getValue().getPasswordHash()).isEqualTo("{bcrypt}encoded");
        verify(auditService).success("CREATE_HR_USER", "SYSTEM_USER", response.id(), "张三",
                "新增 HR 用户，授权企业 1 家");
    }

    @Test
    void createRejectsSystemAdministratorRole() {
        assertThatThrownBy(() -> service.create(new HrUserCreateRequest(
                "admin2", "管理员", UserRole.SYSTEM_ADMIN, "SecurePass123", Set.of(company.getId()))))
                .isInstanceOf(ApiException.class)
                .hasMessage("HR 用户角色只能是招聘管理员或招聘专员");
        verify(userRepository, never()).save(any());
    }

    @Test
    void updateRejectsProtectedSystemAdministrator() {
        SystemUser administrator = new SystemUser("root", "hash", "系统管理员", UserRole.SYSTEM_ADMIN);
        when(userRepository.findWithCompanyScopesById(administrator.getId())).thenReturn(Optional.of(administrator));

        assertThatThrownBy(() -> service.update(administrator.getId(), new HrUserUpdateRequest(
                "新名称", UserRole.RECRUITER, Set.of(company.getId()))))
                .isInstanceOf(ApiException.class)
                .hasMessage("系统管理员不能在 HR 用户模块中修改");
        verify(companyRepository, never()).findAllById(any());
    }

    @Test
    void changeStatusKeepsScopesAndAuditsChange() {
        SystemUser recruiter = new SystemUser("recruiter", "hash", "招聘专员", UserRole.RECRUITER);
        recruiter.assignCompanyScopes(Set.of(company));
        when(userRepository.findWithCompanyScopesById(recruiter.getId())).thenReturn(Optional.of(recruiter));

        HrUserResponse response = service.changeStatus(recruiter.getId(), false);

        assertThat(response.enabled()).isFalse();
        assertThat(response.companies()).hasSize(1);
        verify(auditService).success("CHANGE_HR_USER_STATUS", "SYSTEM_USER", recruiter.getId(), "招聘专员",
                "停用 HR 用户");
    }
}
