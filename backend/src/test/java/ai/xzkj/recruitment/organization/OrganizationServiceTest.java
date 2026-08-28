package ai.xzkj.recruitment.organization;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.common.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class OrganizationServiceTest {
    @Mock
    private GroupProfileRepository groupRepository;
    @Mock
    private CompanyRepository companyRepository;
    @Mock
    private AuditService auditService;
    @Mock
    private CurrentUserService currentUserService;

    private OrganizationService service;
    private GroupProfile group;

    @BeforeEach
    void setUp() {
        service = new OrganizationService(groupRepository, companyRepository, auditService, currentUserService);
        group = new GroupProfile("测试集团", "测试总部");
    }

    @Test
    void createCompanyNormalizesCodeAndWritesAuditLog() {
        when(groupRepository.findAll()).thenReturn(List.of(group));
        when(companyRepository.existsByGroupIdAndNameIgnoreCase(group.getId(), "上海招聘科技有限公司"))
                .thenReturn(false);
        when(companyRepository.existsByGroupIdAndCodeIgnoreCase(group.getId(), "SH_TECH"))
                .thenReturn(false);
        when(companyRepository.save(any(Company.class))).thenAnswer(invocation -> invocation.getArgument(0));

        CompanyResponse response = service.createCompany(new CompanyUpsertRequest(
                " 上海招聘科技有限公司 ", "sh_tech", " 上海 ", " 招聘主体 "));

        assertThat(response.name()).isEqualTo("上海招聘科技有限公司");
        assertThat(response.code()).isEqualTo("SH_TECH");
        assertThat(response.location()).isEqualTo("上海");
        assertThat(response.status()).isEqualTo(CompanyStatus.ACTIVE);

        ArgumentCaptor<Company> companyCaptor = ArgumentCaptor.forClass(Company.class);
        verify(companyRepository).save(companyCaptor.capture());
        assertThat(companyCaptor.getValue().getNotes()).isEqualTo("招聘主体");
        verify(auditService).success(
                "CREATE_COMPANY", "COMPANY", response.id(), "上海招聘科技有限公司", "新增企业 SH_TECH");
    }

    @Test
    void createCompanyRejectsDuplicateCodeBeforeSaving() {
        when(groupRepository.findAll()).thenReturn(List.of(group));
        when(companyRepository.existsByGroupIdAndNameIgnoreCase(group.getId(), "上海招聘科技有限公司"))
                .thenReturn(false);
        when(companyRepository.existsByGroupIdAndCodeIgnoreCase(group.getId(), "SH_TECH"))
                .thenReturn(true);

        assertThatThrownBy(() -> service.createCompany(new CompanyUpsertRequest(
                "上海招聘科技有限公司", "SH_TECH", null, null)))
                .isInstanceOf(ApiException.class)
                .hasMessage("集团内已存在相同企业编码");

        verify(companyRepository, never()).save(any());
        verify(auditService, never()).success(any(), any(), any(), any(), any());
    }

    @Test
    void invalidTimezoneDoesNotChangeGroup() {
        assertThatThrownBy(() -> service.updateGroup(new GroupUpdateRequest(
                "新集团名", "新简称", "Not/A_Timezone", null)))
                .isInstanceOf(ApiException.class)
                .hasMessage("请选择有效时区");

        assertThat(group.getName()).isEqualTo("测试集团");
        verify(auditService, never()).success(any(), any(), any(), any(), any());
    }

    @Test
    void recruiterOnlySeesCompaniesInAssignedScope() {
        Company allowed = new Company(group, "已授权企业", "ALLOWED", null, null);
        Company hidden = new Company(group, "未授权企业", "HIDDEN", null, null);
        SystemUser recruiter = new SystemUser("recruiter", "hash", "招聘专员", UserRole.RECRUITER);
        recruiter.assignCompanyScopes(Set.of(allowed));
        when(groupRepository.findAll()).thenReturn(List.of(group));
        when(currentUserService.requireCurrentUser()).thenReturn(recruiter);
        when(companyRepository.findByGroupIdOrderByCreatedAtDesc(group.getId())).thenReturn(List.of(hidden, allowed));

        List<CompanyResponse> response = service.listCompanies(null, null);

        assertThat(response).extracting(CompanyResponse::code).containsExactly("ALLOWED");
    }
}
