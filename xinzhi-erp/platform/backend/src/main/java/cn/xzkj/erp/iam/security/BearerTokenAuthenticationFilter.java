package cn.xzkj.erp.iam.security;

import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.persistence.TenantEntity;
import cn.xzkj.erp.iam.persistence.UserAccountEntity;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminSessionEntity;
import cn.xzkj.erp.platformadmin.persistence.PlatformAdminSessionRepository;
import cn.xzkj.erp.platformadmin.persistence.PlatformTenantSessionEntity;
import cn.xzkj.erp.platformadmin.persistence.PlatformTenantSessionRepository;
import cn.xzkj.erp.platformadmin.security.PlatformAdminAuthorities;
import cn.xzkj.erp.platformadmin.security.PlatformAdminPrincipal;
import cn.xzkj.erp.tenantaccess.TenantEntitlementService;
import cn.xzkj.erp.tenantaccess.UserApplicationAccessService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class BearerTokenAuthenticationFilter extends OncePerRequestFilter {
    private cn.xzkj.erp.iam.preparation.NativeCustomerServiceIdentity nativeIdentity;
    @Autowired(required=false)
    public void setNativeIdentity(cn.xzkj.erp.iam.preparation.NativeCustomerServiceIdentity identity){this.nativeIdentity=identity;}

    private static final Logger LOGGER =
            LoggerFactory.getLogger(BearerTokenAuthenticationFilter.class);
    private static final String PREFIX = "Bearer ";
    private static final Pattern TOKEN_FORMAT = Pattern.compile("^[A-Za-z0-9_-]{43}$");

    private final AuthSessionRepository sessionRepository;
    private final PermissionRepository permissionRepository;
    private final PlatformAdminSessionRepository platformSessionRepository;
    private final PlatformTenantSessionRepository tenantSessionRepository;
    private final SessionTokenService tokenService;
    private final TenantEntitlementService entitlementService;
    private final UserApplicationAccessService userApplicationAccessService;
    private final Clock clock;

    @Autowired
    public BearerTokenAuthenticationFilter(
            AuthSessionRepository sessionRepository,
            PermissionRepository permissionRepository,
            PlatformAdminSessionRepository platformSessionRepository,
            PlatformTenantSessionRepository tenantSessionRepository,
            SessionTokenService tokenService,
            TenantEntitlementService entitlementService,
            UserApplicationAccessService userApplicationAccessService,
            Clock clock) {
        this.sessionRepository = sessionRepository;
        this.permissionRepository = permissionRepository;
        this.platformSessionRepository = platformSessionRepository;
        this.tenantSessionRepository = tenantSessionRepository;
        this.tokenService = tokenService;
        this.entitlementService = entitlementService;
        this.userApplicationAccessService = userApplicationAccessService;
        this.clock = clock;
    }

    public BearerTokenAuthenticationFilter(
            AuthSessionRepository sessionRepository,
            PermissionRepository permissionRepository,
            PlatformAdminSessionRepository platformSessionRepository,
            PlatformTenantSessionRepository tenantSessionRepository,
            SessionTokenService tokenService,
            TenantEntitlementService entitlementService,
            Clock clock) {
        this(
                sessionRepository,
                permissionRepository,
                platformSessionRepository,
                tenantSessionRepository,
                tokenService,
                entitlementService,
                null,
                clock);
    }

    public BearerTokenAuthenticationFilter(
            AuthSessionRepository sessionRepository,
            PermissionRepository permissionRepository,
            SessionTokenService tokenService,
            Clock clock) {
        this(
                sessionRepository,
                permissionRepository,
                null,
                null,
                tokenService,
                null,
                null,
                clock);
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        String authorization = request.getHeader("Authorization");
        if (authorization != null && authorization.startsWith(PREFIX)) {
            String rawToken = authorization.substring(PREFIX.length());
            if (TOKEN_FORMAT.matcher(rawToken).matches() || (nativeIdentity!=null && nativeIdentity.supports(rawToken))) {
                try {
                    if(nativeIdentity!=null && nativeIdentity.supports(rawToken)) {
                        if(nativeIdentity.validate(rawToken))authenticateTenantUser(tokenService.hash(rawToken),clock.instant(),true);
                    } else authenticate(rawToken);
                } catch (DataAccessResourceFailureException unavailable) {
                    SecurityContextHolder.clearContext();
                    LOGGER.warn("Authentication database unavailable");
                    writeServiceUnavailable(response);
                    return;
                }
            }
        }
        filterChain.doFilter(request, response);
    }

    private void authenticate(String rawToken) {
        String tokenHash = tokenService.hash(rawToken);
        Instant now = clock.instant();
        if (authenticateTenantUser(tokenHash, now)) {
            return;
        }
        if (authenticatePlatformSession(tokenHash, now)) {
            return;
        }
        authenticatePlatformTenantSession(tokenHash, now);
    }

    private boolean authenticateTenantUser(
            String tokenHash,
            Instant now) {
        return authenticateTenantUser(tokenHash,now,false);
    }
    private boolean authenticateTenantUser(String tokenHash,Instant now,boolean sourceValidated) {
        return sessionRepository.findActiveByTokenHash(tokenHash, now)
                .map(session -> {
                    UserAccountEntity user = session.getUser();
                    TenantEntity tenant = user.getTenant();
                    if(!sourceValidated && nativeIdentity!=null && nativeIdentity.isBound(session.getTenantId(),user.getId()))return false;
                    if (userApplicationAccessService != null
                            && !userApplicationAccessService.applicationAccessible(
                                    session.getTenantId(), user.getId(), "ERP")) {
                        return false;
                    }
                    List<String> permissionCodes = permissionRepository
                            .findCodesByTenantIdAndUserId(
                                    session.getTenantId(), user.getId());
                    if (entitlementService != null) {
                        permissionCodes = entitlementService.filterPermissionCodes(
                                session.getTenantId(), permissionCodes);
                    }
                    List<SimpleGrantedAuthority> authorities = permissionCodes
                            .stream()
                            .map(SimpleGrantedAuthority::new)
                            .toList();
                    ErpPrincipal principal = new ErpPrincipal(
                            session.getId(),
                            session.getExpiresAt(),
                            session.getTenantId(),
                            tenant.getCode(),
                            tenant.getName(),
                            user.getId(),
                            user.getUsername(),
                            user.getEmail(),
                            user.getDisplayName(),
                            null);
                    UsernamePasswordAuthenticationToken authentication =
                            UsernamePasswordAuthenticationToken.authenticated(
                                    principal, null, authorities);
                    SecurityContextHolder.getContext().setAuthentication(authentication);
                    return true;
                })
                .orElse(false);
    }

    private boolean authenticatePlatformSession(
            String tokenHash,
            Instant now) {
        if (platformSessionRepository == null) {
            return false;
        }
        return platformSessionRepository.findActiveByTokenHash(tokenHash, now)
                .map(session -> {
                    PlatformAdminSessionEntity platformSession = session;
                    var admin = platformSession.getSystemAdmin();
                    PlatformAdminPrincipal principal = new PlatformAdminPrincipal(
                            platformSession.getId(),
                            platformSession.getExpiresAt(),
                            admin.getId(),
                            admin.getUsername(),
                            admin.getEmail(),
                            admin.getPhoneNumber(),
                            admin.getDisplayName());
                    var authentication =
                            UsernamePasswordAuthenticationToken.authenticated(
                                    principal,
                                    null,
                                    List.of(new SimpleGrantedAuthority(
                                            PlatformAdminAuthorities.SYSTEM_ADMIN)));
                    SecurityContextHolder.getContext()
                            .setAuthentication(authentication);
                    return true;
                })
                .orElse(false);
    }

    private void authenticatePlatformTenantSession(
            String tokenHash,
            Instant now) {
        if (tenantSessionRepository == null) {
            return;
        }
        tenantSessionRepository.findActiveByTokenHash(tokenHash, now)
                .ifPresent(session -> {
                    PlatformTenantSessionEntity tenantSession = session;
                    var admin = tenantSession.getSystemAdmin();
                    var tenant = tenantSession.getTenant();
                    if (entitlementService != null
                            && !entitlementService.applicationEnabled(
                                    tenant.getId(), "ERP")) {
                        return;
                    }
                    List<SimpleGrantedAuthority> authorities =
                            new java.util.ArrayList<>(permissionRepository
                                    .findAllCodes()
                                    .stream()
                                    .map(SimpleGrantedAuthority::new)
                                    .toList());
                    authorities.add(new SimpleGrantedAuthority(
                            PlatformAdminAuthorities.TENANT_SESSION));
                    ErpPrincipal principal = new ErpPrincipal(
                            tenantSession.getId(),
                            tenantSession.getExpiresAt(),
                            tenant.getId(),
                            tenant.getCode(),
                            tenant.getName(),
                            null,
                            admin.getUsername(),
                            admin.getEmail(),
                            admin.getDisplayName(),
                            admin.getId());
                    var authentication =
                            UsernamePasswordAuthenticationToken.authenticated(
                                    principal,
                                    null,
                                    authorities);
                    SecurityContextHolder.getContext()
                            .setAuthentication(authentication);
                });
    }

    private static void writeServiceUnavailable(
            HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
        response.setCharacterEncoding(
                java.nio.charset.StandardCharsets.UTF_8.name());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        response.getWriter().write(
                "{\"code\":\"service_unavailable\","
                        + "\"message\":\"Service is temporarily unavailable\"}");
    }
}
