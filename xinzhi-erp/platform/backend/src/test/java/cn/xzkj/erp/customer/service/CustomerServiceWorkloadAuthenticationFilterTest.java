package cn.xzkj.erp.customer.service;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

class CustomerServiceWorkloadAuthenticationFilterTest {

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void authenticatesExactRedeemEndpointWithExistingWorkloadCredential() throws Exception {
        var filter = new CustomerServiceWorkloadAuthenticationFilter("synthetic-workload-token");
        var request = request();
        request.addHeader("X-XZ-ERP-Connector-Token", "synthetic-workload-token");
        var response = new MockHttpServletResponse();
        boolean[] continued = {false};
        FilterChain chain = (ignoredRequest, ignoredResponse) -> continued[0] = true;

        filter.doFilter(request, response, chain);

        assertThat(continued[0]).isTrue();
        assertThat(SecurityContextHolder.getContext().getAuthentication().getAuthorities())
                .extracting("authority")
                .containsExactly(CustomerServiceWorkloadAuthenticationFilter.REDEEM_AUTHORITY);
    }

    @Test
    void rejectsMissingWrongAndUnconfiguredCredentialWithoutEchoingIt() throws Exception {
        for (String configured : new String[] {"synthetic-workload-token", ""}) {
            var filter = new CustomerServiceWorkloadAuthenticationFilter(configured);
            var request = request();
            request.addHeader("X-XZ-ERP-Connector-Token", "wrong-secret-value");
            var response = new MockHttpServletResponse();

            filter.doFilter(request, response, (ignoredRequest, ignoredResponse) -> {
                throw new AssertionError("invalid workload credential reached controller");
            });

            assertThat(response.getStatus()).isIn(403, 503);
            assertThat(response.getContentAsString()).doesNotContain("wrong-secret-value");
            SecurityContextHolder.clearContext();
        }
    }

    private static MockHttpServletRequest request() {
        var request = new MockHttpServletRequest(
                "POST", CustomerServiceWorkloadAuthenticationFilter.REDEEM_PATH);
        request.setRequestURI(CustomerServiceWorkloadAuthenticationFilter.REDEEM_PATH);
        return request;
    }

    @Test
    void nativeRedeemRequiresDedicatedCredentialNotConnectorOrBearer() throws Exception {
        var path="/api/v1/internal/customer-service/native-entry/redeem";
        for(String header:new String[]{"X-XZ-Native-Entry-Token","X-XZ-ERP-Connector-Token","Authorization"}) {
            SecurityContextHolder.clearContext();
            var filter=new CustomerServiceWorkloadAuthenticationFilter("connector-secret");
            org.springframework.test.util.ReflectionTestUtils.setField(filter,"nativeServiceToken","native-secret");
            var request=new MockHttpServletRequest("POST",path);
            request.addHeader(header,header.equals("Authorization")?"Bearer native-secret":"native-secret");
            var response=new MockHttpServletResponse();boolean[] continued={false};
            filter.doFilter(request,response,(req,res)->continued[0]=true);
            assertThat(continued[0]).isEqualTo(header.equals("X-XZ-Native-Entry-Token"));
            if(continued[0])assertThat(SecurityContextHolder.getContext().getAuthentication().getAuthorities()).extracting("authority").containsExactly("internal.customer_service.native_entry.redeem");
        }
    }

    @Test
    void sessionValidationRequiresTheSameWorkloadBoundary() throws Exception {
        for (String token : new String[] {"synthetic-workload-token", "wrong"}) {
            SecurityContextHolder.clearContext();
            var request = new MockHttpServletRequest("POST", CustomerServiceWorkloadAuthenticationFilter.VALIDATE_PATH);
            request.addHeader("X-XZ-ERP-Connector-Token", token);
            var response = new MockHttpServletResponse();
            boolean[] continued = {false};
            new CustomerServiceWorkloadAuthenticationFilter("synthetic-workload-token")
                    .doFilter(request, response, (req, res) -> continued[0] = true);
            assertThat(continued[0]).isEqualTo(token.equals("synthetic-workload-token"));
            if (!continued[0]) assertThat(response.getStatus()).isEqualTo(403);
        }
    }
}
