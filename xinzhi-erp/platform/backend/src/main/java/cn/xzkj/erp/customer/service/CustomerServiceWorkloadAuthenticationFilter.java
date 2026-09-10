package cn.xzkj.erp.customer.service;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class CustomerServiceWorkloadAuthenticationFilter extends OncePerRequestFilter {

    public static final String REDEEM_PATH =
            "/api/v1/internal/customer-service/entry-grants/redeem";
    public static final String REDEEM_AUTHORITY =
            "internal.customer_service.entry_grant.redeem";
    public static final String VALIDATE_PATH = "/api/v1/internal/customer-service/session/validate";

    private final String serviceToken;
    @Value("${erp.native-customer-service-entry.service-token:}")
    private String nativeServiceToken="";
    private static final String NATIVE_PATH="/api/v1/internal/customer-service/native-entry/redeem";

    public CustomerServiceWorkloadAuthenticationFilter(
            @Value("${erp.channel-connector.xz-erp-app.token:}") String serviceToken) {
        this.serviceToken = serviceToken == null ? "" : serviceToken.strip();
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !"POST".equals(request.getMethod()) || (!REDEEM_PATH.equals(request.getRequestURI())
                && !VALIDATE_PATH.equals(request.getRequestURI()) && !NATIVE_PATH.equals(request.getRequestURI()));
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        boolean nativeEntry=NATIVE_PATH.equals(request.getRequestURI());
        String expected=nativeEntry?nativeServiceToken:serviceToken;
        if (expected.isEmpty()) {
            writeError(response, 503, "customer_service_entry_unavailable",
                    "Customer service entry is unavailable");
            return;
        }
        String provided = request.getHeader(nativeEntry?"X-XZ-Native-Entry-Token":"X-XZ-ERP-Connector-Token");
        if (!nativeEntry && (provided == null || provided.isBlank())) {
            String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
            provided = authorization != null && authorization.startsWith("Bearer ")
                    ? authorization.substring("Bearer ".length()) : "";
        }
        if(provided==null)provided="";
        if (!MessageDigest.isEqual(
                provided.strip().getBytes(StandardCharsets.UTF_8),
                expected.getBytes(StandardCharsets.UTF_8))) {
            writeError(response, 403, "customer_service_entry_forbidden",
                    "Customer service entry is forbidden");
            return;
        }
        var authentication = UsernamePasswordAuthenticationToken.authenticated(
                "customer-service",
                null,
                List.of(new SimpleGrantedAuthority(nativeEntry?"internal.customer_service.native_entry.redeem":REDEEM_AUTHORITY)));
        SecurityContextHolder.getContext().setAuthentication(authentication);
        filterChain.doFilter(request, response);
    }

    private static void writeError(
            HttpServletResponse response,
            int status,
            String code,
            String message) throws IOException {
        response.setStatus(status);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType("application/json");
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        response.getWriter().write("{\"code\":\"" + code
                + "\",\"message\":\"" + message + "\"}");
    }
}
