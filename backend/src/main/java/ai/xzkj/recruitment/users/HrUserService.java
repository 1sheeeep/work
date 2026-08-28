package ai.xzkj.recruitment.users;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.SystemUserRepository;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.organization.CompanyRepository;
import ai.xzkj.recruitment.organization.CompanyStatus;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@Service
public class HrUserService {
    private final SystemUserRepository userRepository;
    private final CompanyRepository companyRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuditService auditService;

    public HrUserService(SystemUserRepository userRepository, CompanyRepository companyRepository,
                         PasswordEncoder passwordEncoder, AuditService auditService) {
        this.userRepository = userRepository;
        this.companyRepository = companyRepository;
        this.passwordEncoder = passwordEncoder;
        this.auditService = auditService;
    }

    @Transactional(readOnly = true)
    public List<HrUserResponse> list(String keyword, UserRole role, Boolean enabled) {
        validateHrRoleFilter(role);
        String normalized = keyword == null ? "" : keyword.trim().toLowerCase(Locale.ROOT);
        return userRepository.findAllByRoleNotOrderByCreatedAtDesc(UserRole.SYSTEM_ADMIN).stream()
                .filter(user -> role == null || user.getRole() == role)
                .filter(user -> enabled == null || user.isEnabled() == enabled)
                .filter(user -> normalized.isBlank()
                        || user.getUsername().toLowerCase(Locale.ROOT).contains(normalized)
                        || user.getDisplayName().toLowerCase(Locale.ROOT).contains(normalized))
                .map(HrUserResponse::from)
                .toList();
    }

    @Transactional
    public HrUserResponse create(HrUserCreateRequest request) {
        UserRole role = requireHrRole(request.role());
        String username = request.username().trim().toLowerCase(Locale.ROOT);
        if (userRepository.existsByUsernameIgnoreCase(username)) {
            throw new ApiException(HttpStatus.CONFLICT, "USERNAME_EXISTS", "该用户名已被使用");
        }
        Set<Company> companies = requireActiveCompanies(request.companyIds());
        SystemUser user = new SystemUser(username, passwordEncoder.encode(request.password()),
                request.displayName().trim(), role);
        user.assignCompanyScopes(companies);
        userRepository.save(user);
        auditService.success("CREATE_HR_USER", "SYSTEM_USER", user.getId(), user.getDisplayName(),
                "新增 HR 用户，授权企业 " + companies.size() + " 家");
        return HrUserResponse.from(user);
    }

    @Transactional
    public HrUserResponse update(UUID id, HrUserUpdateRequest request) {
        SystemUser user = requireManagedUser(id);
        Set<Company> companies = requireActiveCompanies(request.companyIds());
        user.updateProfile(request.displayName().trim(), requireHrRole(request.role()), companies);
        auditService.success("UPDATE_HR_USER", "SYSTEM_USER", user.getId(), user.getDisplayName(),
                "更新角色与企业授权，授权企业 " + companies.size() + " 家");
        return HrUserResponse.from(user);
    }

    @Transactional
    public HrUserResponse changeStatus(UUID id, boolean enabled) {
        SystemUser user = requireManagedUser(id);
        if (user.isEnabled() != enabled) {
            user.changeEnabled(enabled);
            auditService.success("CHANGE_HR_USER_STATUS", "SYSTEM_USER", user.getId(), user.getDisplayName(),
                    enabled ? "启用 HR 用户" : "停用 HR 用户");
        }
        return HrUserResponse.from(user);
    }

    @Transactional
    public void resetPassword(UUID id, HrUserPasswordRequest request) {
        SystemUser user = requireManagedUser(id);
        user.changePassword(passwordEncoder.encode(request.password()));
        auditService.success("RESET_HR_USER_PASSWORD", "SYSTEM_USER", user.getId(), user.getDisplayName(),
                "重置 HR 用户密码");
    }

    private SystemUser requireManagedUser(UUID id) {
        SystemUser user = userRepository.findWithCompanyScopesById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "HR_USER_NOT_FOUND", "HR 用户不存在"));
        if (user.getRole() == UserRole.SYSTEM_ADMIN) {
            throw new ApiException(HttpStatus.FORBIDDEN, "SYSTEM_ADMIN_PROTECTED", "系统管理员不能在 HR 用户模块中修改");
        }
        return user;
    }

    private Set<Company> requireActiveCompanies(Set<UUID> ids) {
        if (ids == null || ids.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "COMPANY_SCOPE_REQUIRED", "请至少授权一家企业");
        }
        List<Company> companies = companyRepository.findAllById(ids);
        if (companies.size() != ids.size()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_COMPANY_SCOPE", "授权范围中包含不存在的企业");
        }
        if (companies.stream().anyMatch(company -> company.getStatus() != CompanyStatus.ACTIVE)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INACTIVE_COMPANY_SCOPE", "不能新增已停用企业的授权");
        }
        return new LinkedHashSet<>(companies);
    }

    private UserRole requireHrRole(UserRole role) {
        if (role != UserRole.RECRUITMENT_ADMIN && role != UserRole.RECRUITER) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_HR_ROLE", "HR 用户角色只能是招聘管理员或招聘专员");
        }
        return role;
    }

    private void validateHrRoleFilter(UserRole role) {
        if (role == UserRole.SYSTEM_ADMIN) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_HR_ROLE", "HR 用户列表不包含系统管理员");
        }
    }
}
