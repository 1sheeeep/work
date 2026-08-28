package ai.xzkj.recruitment.auth;

import ai.xzkj.recruitment.common.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

@Service
public class CurrentUserService {
    private final SystemUserRepository repository;

    public CurrentUserService(SystemUserRepository repository) {
        this.repository = repository;
    }

    public SystemUser requireCurrentUser() {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "请先登录");
        }
        SystemUser user = repository.findByUsernameIgnoreCase(authentication.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "USER_NOT_FOUND", "登录用户不存在"));
        if (!user.isEnabled()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "ACCOUNT_DISABLED", "当前账号已停用，请联系管理员");
        }
        return user;
    }
}
