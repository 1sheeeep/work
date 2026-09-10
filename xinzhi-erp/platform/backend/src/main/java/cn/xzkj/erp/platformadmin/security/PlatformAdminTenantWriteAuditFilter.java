package cn.xzkj.erp.platformadmin.security;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class PlatformAdminTenantWriteAuditFilter
        extends OncePerRequestFilter {

    private static final Set<String> WRITE_METHODS =
            Set.of("POST", "PUT", "PATCH", "DELETE");
    private static final Pattern REQUEST_ID =
            Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");

    private final SecurityAuditRecorder auditRecorder;

    public PlatformAdminTenantWriteAuditFilter(
            SecurityAuditRecorder auditRecorder) {
        this.auditRecorder = auditRecorder;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        Authentication authentication =
                SecurityContextHolder.getContext().getAuthentication();
        if (WRITE_METHODS.contains(request.getMethod())
                && !request.getRequestURI()
                        .startsWith("/api/v1/platform-admin/")
                && authentication != null
                && authentication.getPrincipal()
                        instanceof ErpPrincipal principal
                && principal.systemAdminId() != null) {
            auditRecorder.record(new SecurityAuditEvent(
                    principal.tenantId(),
                    null,
                    principal.systemAdminId(),
                    "platform_admin.tenant_write_attempted",
                    "api_request",
                    bounded(request.getRequestURI(), 160),
                    requestId(request),
                    request.getRemoteAddr(),
                    Map.of("method", request.getMethod())));
        }
        filterChain.doFilter(request, response);
    }

    private static String requestId(HttpServletRequest request) {
        String value = request.getHeader("X-Request-Id");
        if (value == null) {
            return null;
        }
        value = value.strip();
        return REQUEST_ID.matcher(value).matches() ? value : null;
    }

    private static String bounded(String value, int maximum) {
        return value.length() <= maximum
                ? value
                : value.substring(0, maximum);
    }
}
