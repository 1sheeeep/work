package cn.xzkj.erp.iam.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

class TenantContextFilterTest {

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void derivesTenantFromAuthenticatedPrincipalAndAlwaysClearsIt() throws Exception {
        UUID tenantId = UUID.randomUUID();
        ErpPrincipal principal =
                new ErpPrincipal(
                        UUID.randomUUID(),
                        Instant.parse("2026-07-28T13:00:00Z"),
                        tenantId,
                        "acme",
                        "Acme",
                        UUID.randomUUID(),
                        "user",
                        "User");
        SecurityContextHolder.getContext().setAuthentication(
                UsernamePasswordAuthenticationToken.authenticated(principal, null, List.of()));
        TenantContextFilter filter = new TenantContextFilter();

        filter.doFilter(
                new MockHttpServletRequest(),
                new MockHttpServletResponse(),
                (request, response) ->
                        assertThat(TenantContext.currentTenantId()).contains(tenantId));

        assertThat(TenantContext.currentTenantId()).isEmpty();
    }
}
