package ai.xzkj.recruitment.boss;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
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
public class BossAccountService {
    private final BossAccountRepository accountRepository;
    private final CompanyRepository companyRepository;
    private final CurrentUserService currentUserService;
    private final AuditService auditService;
    @jakarta.persistence.PersistenceContext
    private jakarta.persistence.EntityManager entityManager;

    public BossAccountService(BossAccountRepository accountRepository, CompanyRepository companyRepository,
                              CurrentUserService currentUserService, AuditService auditService) {
        this.accountRepository = accountRepository;
        this.companyRepository = companyRepository;
        this.currentUserService = currentUserService;
        this.auditService = auditService;
    }

    @Transactional(readOnly = true)
    public List<BossAccountResponse> list(String keyword, UUID companyId, BossAccountStatus status,
                                          BossConnectionStatus connectionStatus) {
        SystemUser user = currentUserService.requireCurrentUser();
        Set<UUID> allowedIds = allowedCompanyIds(user);
        if (companyId != null && allowedIds != null && !allowedIds.contains(companyId)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "COMPANY_SCOPE_FORBIDDEN", "当前账号无权访问该企业数据");
        }
        String normalized = keyword == null ? "" : keyword.trim().toLowerCase(Locale.ROOT);
        return accountRepository.findAllByOrderByCreatedAtDesc().stream()
                .filter(account -> !account.isDeleted())
                .filter(account -> BossAccountAccess.canAccess(account, user))
                .filter(account -> allowedIds == null || allowedIds.contains(account.getCompany().getId()))
                .filter(account -> companyId == null || account.getCompany().getId().equals(companyId))
                .filter(account -> status == null || account.getStatus() == status)
                .filter(account -> connectionStatus == null || account.getConnectionStatus() == connectionStatus)
                .filter(account -> normalized.isBlank()
                        || account.getDisplayName().toLowerCase(Locale.ROOT).contains(normalized)
                        || account.getExternalIdentifier().toLowerCase(Locale.ROOT).contains(normalized))
                .map(BossAccountResponse::from)
                .toList();
    }

    public record BindableAccount(UUID id, String displayName, String bindingStatus) {}

    @Transactional(readOnly = true)
    public List<BindableAccount> bindableAccounts() {
        SystemUser user = currentUserService.requireCurrentUser();
        Set<UUID> allowed = allowedCompanyIds(user);
        return accountRepository.findAllByOrderByCreatedAtDesc().stream()
                .filter(account -> !account.isDeleted())
                .filter(account -> allowed == null || allowed.contains(account.getCompany().getId()))
                .map(account -> new BindableAccount(account.getId(), account.getDisplayName(),
                        account.getStatus() != BossAccountStatus.ACTIVE ? "UNAVAILABLE" :
                        account.getRecruiterIds().contains(user.getId()) ? "MINE" :
                        account.getRecruiterIds().isEmpty() ? "AVAILABLE" : "BOUND"))
                .toList();
    }

    @Transactional
    public BossAccountResponse claim(UUID id) {
        SystemUser user = currentUserService.requireCurrentUser();
        if (user.getRole() != UserRole.RECRUITER) throw new ApiException(HttpStatus.FORBIDDEN,
                "RECRUITER_REQUIRED", "管理员请通过编辑账号分配招聘专员");
        BossAccount account = accountRepository.findForUpdateById(id).orElseThrow(() ->
                new ApiException(HttpStatus.NOT_FOUND, "BOSS_ACCOUNT_NOT_FOUND", "招聘账号不存在"));
        requireCompanyAccess(account.getCompany().getId(), user);
        if (account.isDeleted() || account.getStatus() != BossAccountStatus.ACTIVE) throw new ApiException(
                HttpStatus.CONFLICT, "ACCOUNT_UNAVAILABLE", "该招聘账号不可绑定");
        if (account.getRecruiterIds().contains(user.getId())) return BossAccountResponse.from(account);
        if (!account.getRecruiterIds().isEmpty()) throw new ApiException(HttpStatus.CONFLICT,
                "ACCOUNT_ALREADY_BOUND", "账号已被其他专员绑定，请联系管理员转交");
        assignRecruiters(account, Set.of(user.getId()));
        auditService.success("CLAIM_BOSS_ACCOUNT", "BOSS_ACCOUNT", id, account.getDisplayName(), "招聘专员自行绑定招聘账号");
        return BossAccountResponse.from(account);
    }

    @Transactional
    public BossAccountResponse create(BossAccountUpsertRequest request) {
        SystemUser user = requireManager();
        Company company = requireActiveAccessibleCompany(request.companyId(), user);
        String externalIdentifier = request.externalIdentifier() == null || request.externalIdentifier().isBlank()
                ? "boss-" + UUID.randomUUID() : cleanRequired(request.externalIdentifier());
        ensureUnique(company.getId(), externalIdentifier, null);
        BossAccount account = accountRepository.save(new BossAccount(
                company, cleanRequired(request.displayName()), externalIdentifier));
        assignRecruiters(account, request.recruiterIds());
        auditService.success("CREATE_BOSS_ACCOUNT", "BOSS_ACCOUNT", account.getId(), account.getDisplayName(),
                "新增本地 CDP 连接器 BOSS 账号，归属企业 " + company.getCode());
        return BossAccountResponse.from(account);
    }

    @Transactional
    public BossAccountResponse update(UUID id, BossAccountUpsertRequest request) {
        SystemUser user = requireManager();
        BossAccount account = requireAccessibleAccount(id, user);
        Company company = requireActiveAccessibleCompany(request.companyId(), user);
        String externalIdentifier = request.externalIdentifier() == null || request.externalIdentifier().isBlank()
                ? account.getExternalIdentifier() : cleanRequired(request.externalIdentifier());
        ensureUnique(company.getId(), externalIdentifier, id);
        account.update(company, cleanRequired(request.displayName()), externalIdentifier);
        assignRecruiters(account, request.recruiterIds() == null ? account.getRecruiterIds() : request.recruiterIds());
        auditService.success("UPDATE_BOSS_ACCOUNT", "BOSS_ACCOUNT", account.getId(), account.getDisplayName(),
                "更新 BOSS 账号连接方式和归属");
        return BossAccountResponse.from(account);
    }

    @Transactional
    public BossAccountResponse changeStatus(UUID id, BossAccountStatus status) {
        SystemUser user = requireManager();
        BossAccount account = requireAccessibleAccount(id, user);
        if (status == BossAccountStatus.ACTIVE && account.getCompany().getStatus() != CompanyStatus.ACTIVE) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INACTIVE_COMPANY", "已停用企业下的 BOSS 账号不能启用");
        }
        if (account.getStatus() != status) {
            account.changeStatus(status);
            auditService.success("CHANGE_BOSS_ACCOUNT_STATUS", "BOSS_ACCOUNT", account.getId(), account.getDisplayName(),
                    status == BossAccountStatus.ACTIVE ? "启用 BOSS 账号" : "停用 BOSS 账号");
        }
        return BossAccountResponse.from(account);
    }

    private SystemUser requireManager() {
        SystemUser user = currentUserService.requireCurrentUser();
        if (user.getRole() != UserRole.SYSTEM_ADMIN && user.getRole() != UserRole.RECRUITMENT_ADMIN) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "当前账号没有 BOSS 账号管理权限");
        }
        return user;
    }

    private void assignRecruiters(BossAccount account, Set<UUID> ids) {
        if (ids == null) return;
        for (UUID id : ids) {
            SystemUser recruiter = entityManager.find(SystemUser.class, id);
            if (recruiter == null || !recruiter.isEnabled() || recruiter.getRole() != UserRole.RECRUITER
                    || recruiter.getCompanyScopes().stream().noneMatch(c -> c.getId().equals(account.getCompany().getId()))) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_RECRUITER_SCOPE", "只能分配给已启用且有该企业权限的招聘专员");
            }
        }
        if (!account.getRecruiterIds().equals(ids)) {
            // Revoke old device credentials on reassignment; no previous owner may continue collecting.
            entityManager.createQuery("update BrowserDevice d set d.status = 'REVOKED', d.runtimeState = 'OFFLINE', d.revokedAt = :now where d.bossAccount.id = :accountId")
                    .setParameter("accountId", account.getId()).setParameter("now", java.time.Instant.now()).executeUpdate();
            account.assignRecruiters(ids);
        }
    }

    @Transactional
    public void delete(UUID id) {
        BossAccount account = requireAccessibleAccount(id, requireManager());
        account.deleteAccount();
        entityManager.createQuery("update BrowserDevice d set d.status = 'REVOKED', d.runtimeState = 'OFFLINE', d.revokedAt = :now where d.bossAccount.id = :accountId")
                .setParameter("accountId", id).setParameter("now", java.time.Instant.now()).executeUpdate();
        auditService.success("DELETE_BOSS_ACCOUNT", "BOSS_ACCOUNT", id, account.getDisplayName(),
                "删除招聘账号并撤销关联插件，保留历史简历与会话");
    }

    private BossAccount requireAccessibleAccount(UUID id, SystemUser user) {
        BossAccount account = accountRepository.findWithDetailsById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "BOSS_ACCOUNT_NOT_FOUND", "BOSS 账号不存在"));
        requireCompanyAccess(account.getCompany().getId(), user);
        if (account.isDeleted()) throw new ApiException(HttpStatus.NOT_FOUND, "BOSS_ACCOUNT_NOT_FOUND", "招聘账号已删除");
        return account;
    }

    private Company requireActiveAccessibleCompany(UUID id, SystemUser user) {
        requireCompanyAccess(id, user);
        Company company = companyRepository.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "COMPANY_NOT_FOUND", "企业不存在"));
        if (company.getStatus() != CompanyStatus.ACTIVE) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INACTIVE_COMPANY", "不能为已停用企业配置 BOSS 账号");
        }
        return company;
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

    private void ensureUnique(UUID companyId, String externalIdentifier, UUID excludedId) {
        boolean exists = excludedId == null
                ? accountRepository.existsByCompanyIdAndExternalIdentifierIgnoreCase(companyId, externalIdentifier)
                : accountRepository.existsByCompanyIdAndExternalIdentifierIgnoreCaseAndIdNot(
                companyId, externalIdentifier, excludedId);
        if (exists) {
            throw new ApiException(HttpStatus.CONFLICT, "BOSS_EXTERNAL_IDENTIFIER_EXISTS",
                    "该企业已存在相同外部标识的 BOSS 账号");
        }
    }

    private String cleanRequired(String value) { return value.trim(); }
}
