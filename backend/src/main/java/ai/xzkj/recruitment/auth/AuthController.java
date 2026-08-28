package ai.xzkj.recruitment.auth;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.common.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthenticationManager authenticationManager;
    private final SecurityContextRepository securityContextRepository;
    private final CurrentUserService currentUserService;
    private final AuditService auditService;
    private final LoginAttemptService loginAttemptService;

    public AuthController(
            AuthenticationManager authenticationManager,
            SecurityContextRepository securityContextRepository,
            CurrentUserService currentUserService,
            AuditService auditService,
            LoginAttemptService loginAttemptService
    ) {
        this.authenticationManager = authenticationManager;
        this.securityContextRepository = securityContextRepository;
        this.currentUserService = currentUserService;
        this.auditService = auditService;
        this.loginAttemptService = loginAttemptService;
    }

    @GetMapping("/csrf")
    public Map<String, String> csrf(CsrfToken token) {
        return Map.of("headerName", token.getHeaderName(), "token", token.getToken());
    }

    @PostMapping("/login")
    public AuthenticatedUser login(
            @Valid @RequestBody LoginRequest body,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        String remoteAddress = request.getRemoteAddr();
        loginAttemptService.checkAllowed(remoteAddress, body.username());
        try {
            Authentication authentication = authenticationManager.authenticate(
                    UsernamePasswordAuthenticationToken.unauthenticated(body.username().trim(), body.password()));
            var context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(authentication);
            SecurityContextHolder.setContext(context);
            securityContextRepository.saveContext(context, request, response);
            SystemUser user = currentUserService.requireCurrentUser();
            loginAttemptService.recordSuccess(remoteAddress, body.username());
            auditService.success("LOGIN", "SYSTEM_USER", user.getId(), user.getDisplayName(), "登录系统");
            return AuthenticatedUser.from(user);
        } catch (BadCredentialsException exception) {
            loginAttemptService.recordFailure(remoteAddress, body.username());
            auditService.anonymousFailure("LOGIN_FAILED", "SYSTEM_USER",
                    loginAttemptService.anonymousReference(body.username()), "用户名或密码校验失败");
            throw new ApiException(HttpStatus.UNAUTHORIZED, "BAD_CREDENTIALS", "用户名或密码不正确");
        }
    }

    @GetMapping("/me")
    public AuthenticatedUser me() {
        return AuthenticatedUser.from(currentUserService.requireCurrentUser());
    }

    @PostMapping("/logout")
    public void logout(HttpServletRequest request) {
        SystemUser user = currentUserService.requireCurrentUser();
        auditService.success("LOGOUT", "SYSTEM_USER", user.getId(), user.getDisplayName(), "退出系统");
        var session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
        SecurityContextHolder.clearContext();
    }

    public record LoginRequest(@NotBlank(message = "请输入用户名") String username,
                               @NotBlank(message = "请输入密码") String password) {
    }

    public record AuthenticatedUser(String id, String username, String displayName, UserRole role) {
        static AuthenticatedUser from(SystemUser user) {
            return new AuthenticatedUser(
                    user.getId().toString(), user.getUsername(), user.getDisplayName(), user.getRole());
        }
    }
}
