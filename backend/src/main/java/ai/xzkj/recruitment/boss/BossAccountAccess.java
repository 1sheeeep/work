package ai.xzkj.recruitment.boss;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.common.ApiException;
import org.springframework.http.HttpStatus;

public final class BossAccountAccess {
    private BossAccountAccess() {}
    public static boolean canAccess(BossAccount account, SystemUser user) {
        if (account == null || account.isDeleted()) return false;
        if (user.getRole() == UserRole.SYSTEM_ADMIN) return true;
        if (user.getCompanyScopes().stream().noneMatch(c -> c.getId().equals(account.getCompany().getId()))) return false;
        return user.getRole() == UserRole.RECRUITMENT_ADMIN
                || (user.getRole() == UserRole.RECRUITER && account.getRecruiterIds().contains(user.getId()));
    }
    public static void requireAccess(BossAccount account, SystemUser user) {
        if (!canAccess(account, user)) throw new ApiException(HttpStatus.FORBIDDEN,
                "ACCOUNT_SCOPE_FORBIDDEN", "当前账号无权访问该招聘账号，请联系管理员分配");
    }
}
