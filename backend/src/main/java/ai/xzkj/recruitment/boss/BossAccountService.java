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
    private final BossGateway gateway;
    private final AuditService auditService;

    public BossAccountService(BossAccountRepository accountRepository, CompanyRepository companyRepository,
                              CurrentUserService currentUserService, BossGateway gateway, AuditService auditService) {
        this.accountRepository = accountRepository;
        this.companyRepository = companyRepository;
        this.currentUserService = currentUserService;
        this.gateway = gateway;
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

    @Transactional
    public BossAccountResponse create(BossAccountUpsertRequest request) {
        SystemUser user = requireManager();
        Company company = requireActiveAccessibleCompany(request.companyId(), user);
        String externalIdentifier = cleanRequired(request.externalIdentifier());
        ensureUnique(company.getId(), externalIdentifier, null);
        validateGateway(request);
        BossAccount account = accountRepository.save(new BossAccount(
                company, cleanRequired(request.displayName()), externalIdentifier, request.gatewayType(),request.mockProfile()));
        auditService.success("CREATE_BOSS_ACCOUNT", "BOSS_ACCOUNT", account.getId(), account.getDisplayName(),
                "新增 "+(request.gatewayType()==BossGatewayType.MOCK?"Mock":"浏览器伴随")+" BOSS 账号，归属企业 " + company.getCode());
        return BossAccountResponse.from(account);
    }

    @Transactional
    public BossAccountResponse update(UUID id, BossAccountUpsertRequest request) {
        SystemUser user = requireManager();
        BossAccount account = requireAccessibleAccount(id, user);
        Company company = requireActiveAccessibleCompany(request.companyId(), user);
        String externalIdentifier = cleanRequired(request.externalIdentifier());
        ensureUnique(company.getId(), externalIdentifier, id);
        validateGateway(request);
        account.update(company, cleanRequired(request.displayName()), externalIdentifier,request.gatewayType(),request.mockProfile());
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

    @Transactional
    public BossAccountResponse checkCapabilities(UUID id) {
        SystemUser user = requireManager();
        BossAccount account = requireAccessibleAccount(id, user);
        if(account.getGatewayType()==BossGatewayType.BROWSER_COMPANION)throw new ApiException(HttpStatus.BAD_REQUEST,"BROWSER_DEVICE_CHECK_REQUIRED","浏览器账号能力由配对设备和页面心跳自动确认");
        if (account.getStatus() != BossAccountStatus.ACTIVE) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "BOSS_ACCOUNT_INACTIVE", "请先启用 BOSS 账号再检查能力");
        }
        if (account.getCompany().getStatus() != CompanyStatus.ACTIVE) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INACTIVE_COMPANY", "企业已停用，无法检查 BOSS 账号能力");
        }
        BossGateway.BossCapabilityCheckResult result = gateway.inspect(account);
        account.applyCapabilityCheck(result.status(), result.capabilities());
        auditService.success("CHECK_BOSS_CAPABILITIES", "BOSS_ACCOUNT", account.getId(), account.getDisplayName(),
                "能力检查结果 " + result.status().name() + "，可用能力 " + result.capabilities().size() + " 项");
        return BossAccountResponse.from(account);
    }

    private SystemUser requireManager() {
        SystemUser user = currentUserService.requireCurrentUser();
        if (user.getRole() != UserRole.SYSTEM_ADMIN && user.getRole() != UserRole.RECRUITMENT_ADMIN) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "当前账号没有 BOSS 账号管理权限");
        }
        return user;
    }

    private BossAccount requireAccessibleAccount(UUID id, SystemUser user) {
        BossAccount account = accountRepository.findWithDetailsById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "BOSS_ACCOUNT_NOT_FOUND", "BOSS 账号不存在"));
        requireCompanyAccess(account.getCompany().getId(), user);
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
    private void validateGateway(BossAccountUpsertRequest request){if(request.gatewayType()==BossGatewayType.MOCK&&request.mockProfile()==null)throw new ApiException(HttpStatus.BAD_REQUEST,"MOCK_PROFILE_REQUIRED","Mock 账号必须选择测试场景");}
}
