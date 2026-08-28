package ai.xzkj.recruitment.auth;

import ai.xzkj.recruitment.common.ApiError;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.time.Instant;

public class EnabledUserFilter extends OncePerRequestFilter {
    private final SystemUserRepository userRepository;
    private final ObjectMapper objectMapper;

    public EnabledUserFilter(SystemUserRepository userRepository, ObjectMapper objectMapper) {
        this.userRepository = userRepository;
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.isAuthenticated()) {
            boolean enabled = userRepository.findByUsernameIgnoreCase(authentication.getName())
                    .map(SystemUser::isEnabled)
                    .orElse(false);
            if (!enabled) {
                var session = request.getSession(false);
                if (session != null) session.invalidate();
                SecurityContextHolder.clearContext();
                response.setStatus(HttpStatus.UNAUTHORIZED.value());
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                objectMapper.writeValue(response.getOutputStream(), new ApiError(
                        Instant.now(), HttpStatus.UNAUTHORIZED.value(), "ACCOUNT_DISABLED",
                        "当前账号已停用，请联系管理员", null));
                return;
            }
        }
        filterChain.doFilter(request, response);
    }
}
