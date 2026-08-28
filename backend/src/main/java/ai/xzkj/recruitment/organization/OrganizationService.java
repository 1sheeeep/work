package ai.xzkj.recruitment.organization;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.common.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DateTimeException;
import java.time.ZoneId;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@Service
public class OrganizationService {
    private final GroupProfileRepository groupRepository;
    private final CompanyRepository companyRepository;
    private final AuditService auditService;
    private final CurrentUserService currentUserService;

    public OrganizationService(
            GroupProfileRepository groupRepository,
            CompanyRepository companyRepository,
            AuditService auditService,
            CurrentUserService currentUserService
    ) {
        this.groupRepository = groupRepository;
        this.companyRepository = companyRepository;
        this.auditService = auditService;
        this.currentUserService = currentUserService;
    }

    @Transactional(readOnly = true)
    public GroupResponse getGroup() {
        return GroupResponse.from(requireGroup());
    }

    @Transactional
    public GroupResponse updateGroup(GroupUpdateRequest request) {
        validateTimezone(request.timezone());
        GroupProfile group = requireGroup();
        group.update(
                cleanRequired(request.name()),
                cleanRequired(request.shortName()),
                request.timezone().trim(),
                cleanOptional(request.description())
        );
        auditService.success("UPDATE_GROUP", "GROUP", group.getId(), group.getName(), "更新集团资料");
        return GroupResponse.from(group);
    }

    @Transactional(readOnly = true)
    public List<CompanyResponse> listCompanies(String keyword, CompanyStatus status) {
        GroupProfile group = requireGroup();
        String normalizedKeyword = keyword == null ? "" : keyword.trim().toLowerCase(Locale.ROOT);
        var currentUser = currentUserService.requireCurrentUser();
        Set<UUID> allowedCompanyIds = currentUser.getRole() == UserRole.SYSTEM_ADMIN
                ? null
                : currentUser.getCompanyScopes().stream().map(Company::getId).collect(java.util.stream.Collectors.toSet());
        return companyRepository.findByGroupIdOrderByCreatedAtDesc(group.getId()).stream()
                .filter(company -> allowedCompanyIds == null || allowedCompanyIds.contains(company.getId()))
                .filter(company -> status == null || company.getStatus() == status)
                .filter(company -> normalizedKeyword.isBlank()
                        || company.getName().toLowerCase(Locale.ROOT).contains(normalizedKeyword)
                        || company.getCode().toLowerCase(Locale.ROOT).contains(normalizedKeyword))
                .map(CompanyResponse::from)
                .toList();
    }

    @Transactional
    public CompanyResponse createCompany(CompanyUpsertRequest request) {
        GroupProfile group = requireGroup();
        String name = cleanRequired(request.name());
        String code = normalizeCode(request.code());
        ensureUnique(group.getId(), name, code, null);
        Company company = companyRepository.save(new Company(
                group, name, code, cleanOptional(request.location()), cleanOptional(request.notes())));
        auditService.success("CREATE_COMPANY", "COMPANY", company.getId(), company.getName(), "新增企业 " + code);
        return CompanyResponse.from(company);
    }

    @Transactional
    public CompanyResponse updateCompany(UUID id, CompanyUpsertRequest request) {
        Company company = requireCompany(id);
        GroupProfile group = requireGroup();
        String name = cleanRequired(request.name());
        String code = normalizeCode(request.code());
        ensureUnique(group.getId(), name, code, id);
        company.update(name, code, cleanOptional(request.location()), cleanOptional(request.notes()));
        auditService.success("UPDATE_COMPANY", "COMPANY", company.getId(), company.getName(), "更新企业资料");
        return CompanyResponse.from(company);
    }

    @Transactional
    public CompanyResponse changeCompanyStatus(UUID id, CompanyStatus status) {
        Company company = requireCompany(id);
        if (company.getStatus() != status) {
            company.changeStatus(status);
            auditService.success(
                    "CHANGE_COMPANY_STATUS", "COMPANY", company.getId(), company.getName(),
                    "企业状态改为 " + (status == CompanyStatus.ACTIVE ? "正常" : "已停用"));
        }
        return CompanyResponse.from(company);
    }

    private GroupProfile requireGroup() {
        return groupRepository.findAll().stream().findFirst()
                .orElseThrow(() -> new ApiException(
                        HttpStatus.INTERNAL_SERVER_ERROR, "GROUP_NOT_INITIALIZED", "集团资料尚未初始化"));
    }

    private Company requireCompany(UUID id) {
        return companyRepository.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "COMPANY_NOT_FOUND", "企业不存在或已移除"));
    }

    private void ensureUnique(UUID groupId, String name, String code, UUID excludedId) {
        boolean nameExists = excludedId == null
                ? companyRepository.existsByGroupIdAndNameIgnoreCase(groupId, name)
                : companyRepository.existsByGroupIdAndNameIgnoreCaseAndIdNot(groupId, name, excludedId);
        if (nameExists) {
            throw new ApiException(HttpStatus.CONFLICT, "COMPANY_NAME_EXISTS", "集团内已存在同名企业");
        }
        boolean codeExists = excludedId == null
                ? companyRepository.existsByGroupIdAndCodeIgnoreCase(groupId, code)
                : companyRepository.existsByGroupIdAndCodeIgnoreCaseAndIdNot(groupId, code, excludedId);
        if (codeExists) {
            throw new ApiException(HttpStatus.CONFLICT, "COMPANY_CODE_EXISTS", "集团内已存在相同企业编码");
        }
    }

    private void validateTimezone(String timezone) {
        try {
            ZoneId.of(timezone.trim());
        } catch (DateTimeException exception) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_TIMEZONE", "请选择有效时区");
        }
    }

    private String normalizeCode(String value) {
        return cleanRequired(value).toUpperCase(Locale.ROOT);
    }

    private String cleanRequired(String value) {
        return value.trim();
    }

    private String cleanOptional(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
