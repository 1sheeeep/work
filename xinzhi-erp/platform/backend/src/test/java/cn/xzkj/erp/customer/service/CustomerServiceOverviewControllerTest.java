package cn.xzkj.erp.customer.service;

import static org.assertj.core.api.Assertions.assertThat;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.access.prepost.PreAuthorize;

class CustomerServiceOverviewControllerTest {

    private static final UUID TENANT_ID =
            UUID.fromString("10000000-0000-4000-8000-000000000001");

    @Test
    void bindsSummaryToPrincipalTenantAndDisablesCaching() throws Exception {
        UUID[] requestedTenant = new UUID[1];
        var service = new CustomerServiceOverviewService(tenantId -> {
            requestedTenant[0] = tenantId;
            return List.of();
        });
        var response = new MockHttpServletResponse();

        var result = new CustomerServiceOverviewController(service)
                .overview(principal(), response);

        assertThat(requestedTenant[0]).isEqualTo(TENANT_ID);
        assertThat(result.totalShops()).isZero();
        assertThat(response.getHeader(HttpHeaders.CACHE_CONTROL)).isEqualTo("no-store");
    }

    @Test
    void requiresCustomerServiceReadPermission() throws Exception {
        var method = CustomerServiceOverviewController.class.getMethod(
                "overview",
                ErpPrincipal.class,
                jakarta.servlet.http.HttpServletResponse.class);

        assertThat(method.getAnnotation(PreAuthorize.class).value())
                .isEqualTo("hasAuthority('customer_service.read')");
    }

    private static ErpPrincipal principal() {
        return new ErpPrincipal(
                UUID.randomUUID(),
                Instant.now().plusSeconds(3600),
                TENANT_ID,
                "tenant",
                "Tenant",
                UUID.randomUUID(),
                "operator",
                "Operator");
    }
}
