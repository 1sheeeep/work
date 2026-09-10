package cn.xzkj.erp.iam.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.iam.persistence.AuthSessionEntity;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.persistence.TenantEntity;
import cn.xzkj.erp.iam.persistence.UserAccountEntity;
import cn.xzkj.erp.tenantaccess.UserApplicationAccessService;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

@ExtendWith(OutputCaptureExtension.class)
class BearerTokenAuthenticationFilterTest {

    private static final String RAW_TOKEN =
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    private static final Instant NOW = Instant.parse("2026-07-28T12:00:00Z");

    private final AuthSessionRepository sessionRepository = mock(AuthSessionRepository.class);
    private final PermissionRepository permissionRepository = mock(PermissionRepository.class);
    private final SessionTokenService tokenService = mock(SessionTokenService.class);

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void authenticatesActiveSessionWithTenantScopedPermissions() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        AuthSessionEntity session = mock(AuthSessionEntity.class);
        UserAccountEntity user = mock(UserAccountEntity.class);
        TenantEntity tenant = mock(TenantEntity.class);
        when(tokenService.hash(RAW_TOKEN)).thenReturn("digest");
        when(sessionRepository.findActiveByTokenHash("digest", NOW))
                .thenReturn(Optional.of(session));
        when(session.getTenantId()).thenReturn(tenantId);
        when(session.getId()).thenReturn(UUID.randomUUID());
        when(session.getUser()).thenReturn(user);
        when(session.getExpiresAt()).thenReturn(NOW.plusSeconds(3600));
        when(user.getId()).thenReturn(userId);
        when(user.getTenant()).thenReturn(tenant);
        when(tenant.getCode()).thenReturn("acme");
        when(tenant.getName()).thenReturn("Acme");
        when(user.getUsername()).thenReturn("operator");
        when(user.getDisplayName()).thenReturn("Operator");
        when(permissionRepository.findCodesByTenantIdAndUserId(tenantId, userId))
                .thenReturn(List.of("orders.read", "orders.approve"));
        BearerTokenAuthenticationFilter filter = filter();
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/auth/me");
        request.addHeader("Authorization", "Bearer " + RAW_TOKEN);

        filter.doFilter(request, new MockHttpServletResponse(), new MockFilterChain());

        ErpPrincipal principal =
                (ErpPrincipal) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
        assertThat(principal.tenantId()).isEqualTo(tenantId);
        assertThat(principal.tenantCode()).isEqualTo("acme");
        assertThat(principal.tenantName()).isEqualTo("Acme");
        assertThat(principal.expiresAt()).isEqualTo(NOW.plusSeconds(3600));
        assertThat(SecurityContextHolder.getContext().getAuthentication().getAuthorities())
                .extracting("authority")
                .containsExactly("orders.read", "orders.approve");
    }

    @Test
    void ignoresMalformedBearerWithoutDatabaseLookup() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/protected");
        request.addHeader("Authorization", "Bearer too-short");

        filter().doFilter(request, new MockHttpServletResponse(), new MockFilterChain());

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        verify(sessionRepository, never()).findActiveByTokenHash(
                org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.any());
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"erp.xzkj.ai", "one.xzkj.ai", "one"})
    void refusesErpRequestsAfterEmployeeApplicationAccessIsRevoked(String host) throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        AuthSessionEntity session = mock(AuthSessionEntity.class);
        UserAccountEntity user = mock(UserAccountEntity.class);
        when(tokenService.hash(RAW_TOKEN)).thenReturn("digest");
        when(sessionRepository.findActiveByTokenHash("digest", NOW))
                .thenReturn(Optional.of(session));
        when(session.getTenantId()).thenReturn(tenantId);
        when(session.getUser()).thenReturn(user);
        when(user.getId()).thenReturn(userId);
        UserApplicationAccessService access = mock(UserApplicationAccessService.class);
        when(access.applicationAccessible(tenantId, userId, "ERP"))
                .thenReturn(false);
        BearerTokenAuthenticationFilter filter = new BearerTokenAuthenticationFilter(
                sessionRepository,
                permissionRepository,
                null,
                null,
                tokenService,
                null,
                access,
                Clock.fixed(NOW, ZoneOffset.UTC));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/orders");
        request.setServerName(host);
        request.addHeader("Authorization", "Bearer " + RAW_TOKEN);

        filter.doFilter(request, new MockHttpServletResponse(), new MockFilterChain());

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        verify(permissionRepository, never())
                .findCodesByTenantIdAndUserId(tenantId, userId);
    }

    @Test
    void databaseUnavailabilityReturnsFixedSafe503WithoutCallingTheChain(
            CapturedOutput output) throws Exception {
        String exceptionCanary = "jdbc:postgresql://db-canary:5432/secret "
                + "SQLState 08001 token-canary";
        when(tokenService.hash(RAW_TOKEN)).thenReturn("digest");
        when(sessionRepository.findActiveByTokenHash("digest", NOW))
                .thenThrow(new DataAccessResourceFailureException(
                        exceptionCanary));
        FilterChain chain = mock(FilterChain.class);
        MockHttpServletRequest request =
                new MockHttpServletRequest("POST", "/supplier-path-canary");
        request.addHeader("Authorization", "Bearer " + RAW_TOKEN);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter().doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(response.getContentType())
                .isEqualTo("application/json;charset=UTF-8");
        assertThat(response.getHeader(HttpHeaders.CACHE_CONTROL))
                .isEqualTo("no-store");
        assertThat(response.getContentAsString())
                .isEqualTo("{\"code\":\"service_unavailable\","
                        + "\"message\":\"Service is temporarily unavailable\"}");
        verify(chain, never()).doFilter(any(), any());
        assertThat(SecurityContextHolder.getContext().getAuthentication())
                .isNull();
        assertThat(output.getAll())
                .contains("Authentication database unavailable")
                .doesNotContain(exceptionCanary)
                .doesNotContain(RAW_TOKEN)
                .doesNotContain("supplier-path-canary")
                .doesNotContain(DataAccessResourceFailureException.class
                        .getName());
    }

    @Test
    void unrelatedRuntimeFailureIsNotReclassifiedAsDatabaseUnavailability() {
        when(tokenService.hash(RAW_TOKEN)).thenReturn("digest");
        when(sessionRepository.findActiveByTokenHash("digest", NOW))
                .thenThrow(new IllegalStateException("unrelated"));
        MockHttpServletRequest request =
                new MockHttpServletRequest("GET", "/protected");
        request.addHeader("Authorization", "Bearer " + RAW_TOKEN);
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThatThrownBy(() ->
                filter().doFilter(request, response, mock(FilterChain.class)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("unrelated");
        assertThat(response.getStatus()).isEqualTo(200);
    }

    private BearerTokenAuthenticationFilter filter() {
        return new BearerTokenAuthenticationFilter(
                sessionRepository,
                permissionRepository,
                tokenService,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }
}
