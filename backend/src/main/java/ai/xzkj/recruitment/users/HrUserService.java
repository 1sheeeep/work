package ai.xzkj.recruitment.users;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.SystemUserRepository;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.auth.CurrentUserService;
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
    private final CurrentUserService currentUsers;
    private final jakarta.persistence.EntityManager entityManager;

    public HrUserService(SystemUserRepository userRepository, CompanyRepository companyRepository,
                         PasswordEncoder passwordEncoder, AuditService auditService, CurrentUserService currentUsers,
                         jakarta.persistence.EntityManager entityManager) {
        this.userRepository = userRepository;
        this.companyRepository = companyRepository;
        this.passwordEncoder = passwordEncoder;
        this.auditService = auditService;
        this.currentUsers = currentUsers;
        this.entityManager = entityManager;
    }

    @Transactional(readOnly = true)
    public List<HrUserResponse> list(String keyword, UserRole role, Boolean enabled) {
        validateHrRoleFilter(role);
        SystemUser actor = requireManager();
        String normalized = keyword == null ? "" : keyword.trim().toLowerCase(Locale.ROOT);
        return userRepository.findAllByRoleNotOrderByCreatedAtDesc(UserRole.SYSTEM_ADMIN).stream()
                .filter(user -> !user.isDeleted() && canManage(actor, user))
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
        SystemUser actor = requireManager();
        SystemUser user = userRepository.findWithCompanyScopesById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "HR_USER_NOT_FOUND", "HR 用户不存在"));
        if (user.getRole() == UserRole.SYSTEM_ADMIN) {
            throw new ApiException(HttpStatus.FORBIDDEN, "SYSTEM_ADMIN_PROTECTED", "系统管理员不能在 HR 用户模块中修改");
        }
        if (user.isDeleted()) throw new ApiException(HttpStatus.NOT_FOUND, "HR_USER_NOT_FOUND", "HR 用户不存在");
        if (!canManage(actor, user)) throw forbidden();
        return user;
    }

    @Transactional
    public void delete(UUID id) {
        SystemUser user = requireManagedUser(id);
        user.deleteAccount();
        entityManager.createQuery("update BrowserDevice d set d.status = 'REVOKED', d.runtimeState = 'OFFLINE', d.revokedAt = :now where d.pairedBy.id = :userId")
                .setParameter("userId", id).setParameter("now", java.time.Instant.now()).executeUpdate();
        auditService.success("DELETE_HR_USER", "SYSTEM_USER", user.getId(), user.getDisplayName(),
                "删除 HR 账号，禁止登录并保留历史业务关联；用户名不再复用");
    }

    private SystemUser requireManager() {
        SystemUser actor = currentUsers.requireCurrentUser();
        if (actor.getRole() != UserRole.SYSTEM_ADMIN && actor.getRole() != UserRole.RECRUITMENT_ADMIN) throw forbidden();
        return actor;
    }

    private boolean canManage(SystemUser actor, SystemUser target) {
        return actor.getRole() == UserRole.SYSTEM_ADMIN ||
                (target.getRole() == UserRole.RECRUITER && !target.getCompanyScopes().isEmpty()
                        && companyIds(actor).containsAll(companyIds(target)));
    }

    private Set<UUID> companyIds(SystemUser user) {
        return user.getCompanyScopes().stream().map(Company::getId).collect(java.util.stream.Collectors.toSet());
    }

    private ApiException forbidden() {
        return new ApiException(HttpStatus.FORBIDDEN, "HR_USER_SCOPE_FORBIDDEN", "只能管理授权企业范围内的招聘专员");
    }

    private Set<Company> requireActiveCompanies(Set<UUID> ids) {
        SystemUser actor = requireManager();
        if (ids == null || ids.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "COMPANY_SCOPE_REQUIRED", "请至少授权一家企业");
        }
        if (actor.getRole() != UserRole.SYSTEM_ADMIN && !companyIds(actor).containsAll(ids)) throw forbidden();
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
        SystemUser actor = requireManager();
        if (role != UserRole.RECRUITMENT_ADMIN && role != UserRole.RECRUITER) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_HR_ROLE", "HR 用户角色只能是招聘管理员或招聘专员");
        }
        if (actor.getRole() != UserRole.SYSTEM_ADMIN && role != UserRole.RECRUITER) throw forbidden();
        return role;
    }

    private void validateHrRoleFilter(UserRole role) {
        if (role == UserRole.SYSTEM_ADMIN) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_HR_ROLE", "HR 用户列表不包含系统管理员");
        }
    }
}
