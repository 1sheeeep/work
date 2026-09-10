package cn.xzkj.erp.order.api;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cn.xzkj.erp.config.SecurityConfig;
import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.security.BearerTokenAuthenticationFilter;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.iam.security.TenantContextFilter;
import cn.xzkj.erp.order.service.OrderSkuSalesService;
import cn.xzkj.erp.order.service.SkuSalesSummaryView;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.test.context.web.WebAppConfiguration;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

@SpringJUnitConfig
@WebAppConfiguration
@ContextConfiguration(classes = {
        SecurityConfig.class,
        OrderSkuSalesControllerIntegrationTest.WebConfiguration.class
})
class OrderSkuSalesControllerIntegrationTest {
    @Autowired
    private WebApplicationContext context;

    @Autowired
    private OrderSkuSalesService service;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        SecurityContextHolder.clearContext();
        reset(service);
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @Test
    void requiresAuthenticationAndOrdersReadPermission() throws Exception {
        String path = "/api/v1/order-center/sku-sales-summaries";

        mockMvc.perform(get(path).param(
                        "skuId", UUID.randomUUID().toString()))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get(path)
                        .param("skuId", UUID.randomUUID().toString())
                        .with(authentication(auth(
                                UUID.randomUUID(),
                                "products.read"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code")
                        .value("permission_denied"));

        verify(service, never()).listSummaries(any(), any());
    }

    @Test
    void usesOnlyPrincipalTenantAndReturnsBoundedSummaryEnvelope()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        when(service.listSummaries(
                tenantId,
                List.of(skuId)))
                .thenReturn(List.of(
                        new SkuSalesSummaryView(skuId, 2, 5, 8)));

        mockMvc.perform(get(
                        "/api/v1/order-center/sku-sales-summaries")
                        .header("X-Tenant-Id", UUID.randomUUID())
                        .param("skuId", skuId.toString())
                        .with(authentication(auth(
                                tenantId,
                                "orders.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].skuId")
                        .value(skuId.toString()))
                .andExpect(jsonPath("$.items[0].sales7").value(2))
                .andExpect(jsonPath("$.items[0].sales28").value(5))
                .andExpect(jsonPath("$.items[0].sales42").value(8));

        verify(service).listSummaries(tenantId, List.of(skuId));
    }

    @Test
    void rejectsMissingMalformedAndUnboundedSkuLists() throws Exception {
        TestingAuthenticationToken authentication =
                auth(UUID.randomUUID(), "orders.read");
        String path = "/api/v1/order-center/sku-sales-summaries";

        mockMvc.perform(get(path).with(authentication(authentication)))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get(path)
                        .param("skuId", "not-a-uuid")
                        .with(authentication(authentication)))
                .andExpect(status().isBadRequest());
        var request = get(path).with(authentication(authentication));
        for (int index = 0; index < 51; index++) {
            request.param("skuId", UUID.randomUUID().toString());
        }
        mockMvc.perform(request)
                .andExpect(status().isBadRequest());

        verify(service, never()).listSummaries(any(), any());
    }

    private static TestingAuthenticationToken auth(
            UUID tenantId,
            String authority) {
        ErpPrincipal principal = new ErpPrincipal(
                UUID.randomUUID(),
                Instant.now().plusSeconds(3600),
                tenantId,
                "tenant",
                "Tenant",
                UUID.randomUUID(),
                "user",
                "User");
        return new TestingAuthenticationToken(
                principal,
                "not-used",
                authority);
    }

    @Configuration
    @EnableWebMvc
    @EnableWebSecurity
    static class WebConfiguration {
        @Bean
        OrderSkuSalesService orderSkuSalesService() {
            return mock(OrderSkuSalesService.class);
        }

        @Bean
        OrderSkuSalesController orderSkuSalesController(
                OrderSkuSalesService service) {
            return new OrderSkuSalesController(service);
        }

        @Bean
        OrderApiExceptionHandler orderApiExceptionHandler() {
            return new OrderApiExceptionHandler();
        }

        @Bean
        AuthSessionRepository authSessionRepository() {
            return mock(AuthSessionRepository.class);
        }

        @Bean
        PermissionRepository permissionRepository() {
            return mock(PermissionRepository.class);
        }

        @Bean
        SessionTokenService sessionTokenService() {
            return mock(SessionTokenService.class);
        }

        @Bean
        BearerTokenAuthenticationFilter bearerTokenAuthenticationFilter(
                AuthSessionRepository sessions,
                PermissionRepository permissions,
                SessionTokenService tokens,
                java.time.Clock clock) {
            return new BearerTokenAuthenticationFilter(
                    sessions,
                    permissions,
                    tokens,
                    clock);
        }

        @Bean
        TenantContextFilter tenantContextFilter() {
            return new TenantContextFilter();
        }
    }
}
