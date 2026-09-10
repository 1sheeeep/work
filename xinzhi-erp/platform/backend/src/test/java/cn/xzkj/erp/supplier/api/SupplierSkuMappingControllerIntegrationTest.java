package cn.xzkj.erp.supplier.api;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.Page;
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

import cn.xzkj.erp.config.SecurityConfig;
import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.security.BearerTokenAuthenticationFilter;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.iam.security.TenantContextFilter;
import cn.xzkj.erp.platform.api.ApiExceptionHandler;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.supplier.service.PreferredSupplierSkuSummary;
import cn.xzkj.erp.supplier.service.SupplierSkuMappingService;

@SpringJUnitConfig
@WebAppConfiguration
@ContextConfiguration(classes = {
        SecurityConfig.class,
        SupplierSkuMappingControllerIntegrationTest.WebConfiguration.class
})
class SupplierSkuMappingControllerIntegrationTest {
    @Autowired private WebApplicationContext webApplicationContext;
    @Autowired private SupplierSkuMappingService service;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        SecurityContextHolder.clearContext();
        reset(service);
        mockMvc = MockMvcBuilders
                .webAppContextSetup(webApplicationContext)
                .apply(springSecurity())
                .build();
    }

    @Test
    void authenticationAndReadAuthorityRemainRequired() throws Exception {
        UUID supplierId = UUID.randomUUID();
        mockMvc.perform(get(path(supplierId)))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get(path(supplierId))
                        .with(authentication(auth(
                                UUID.randomUUID(),
                                "suppliers.write"))))
                .andExpect(status().isForbidden());
        verify(service, never()).list(any(), any(), any(), any(), any());
    }

    @Test
    void mappingListRemainsTenantDerivedAndValidated() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID supplierId = UUID.randomUUID();
        when(service.list(
                org.mockito.ArgumentMatchers.eq(tenantId),
                org.mockito.ArgumentMatchers.eq(supplierId),
                org.mockito.ArgumentMatchers.isNull(),
                org.mockito.ArgumentMatchers.eq("north"),
                any())).thenReturn(Page.empty());

        mockMvc.perform(get(path(supplierId))
                        .param("query", "north")
                        .with(authentication(auth(
                                tenantId, "suppliers.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray())
                .andExpect(jsonPath("$.page").value(0));
        mockMvc.perform(get(path(supplierId))
                        .param("size", "201")
                        .with(authentication(auth(
                                tenantId, "suppliers.read"))))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get(
                        "/api/v1/suppliers/not-a-uuid/sku-mappings")
                        .with(authentication(auth(
                                tenantId, "suppliers.read"))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void preferredSupplierFactsRemainReadProtected() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        UUID supplierId = UUID.randomUUID();
        when(service.listPreferredSuppliers(tenantId, List.of(skuId)))
                .thenReturn(List.of(new PreferredSupplierSkuSummary(
                        skuId,
                        "FACTORY_BLUE_M",
                        supplierId,
                        "SUP_ONE",
                        "Supplier one")));

        mockMvc.perform(get(
                        "/api/v1/suppliers/preferred-sku-summaries")
                        .param("skuId", skuId.toString())
                        .with(authentication(auth(
                                tenantId, "suppliers.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].skuId")
                        .value(skuId.toString()))
                .andExpect(jsonPath("$.items[0].supplierId")
                        .value(supplierId.toString()))
                .andExpect(jsonPath("$.items[0].supplierSkuCode")
                        .value("FACTORY_BLUE_M"));
        verify(service).listPreferredSuppliers(tenantId, List.of(skuId));
    }

    @Test
    void missingSupplierUsesSafeReadErrorEnvelope() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID supplierId = UUID.randomUUID();
        when(service.list(
                org.mockito.ArgumentMatchers.eq(tenantId),
                org.mockito.ArgumentMatchers.eq(supplierId),
                any(),
                any(),
                any())).thenThrow(new ResourceNotFoundException(
                        "private tenant detail"));

        mockMvc.perform(get(path(supplierId))
                        .with(authentication(auth(
                                tenantId, "suppliers.read"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message")
                        .value("Requested resource was not found"))
                .andExpect(content().string(not(
                        containsString("private tenant detail"))));
    }

    private static String path(UUID supplierId) {
        return "/api/v1/suppliers/"
                + supplierId
                + "/sku-mappings";
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
        SupplierSkuMappingService supplierSkuMappingService() {
            return mock(SupplierSkuMappingService.class);
        }

        @Bean
        SupplierSkuMappingController supplierSkuMappingController(
                SupplierSkuMappingService service) {
            return new SupplierSkuMappingController(service);
        }

        @Bean
        PreferredSupplierSkuSummaryController
                preferredSupplierSkuSummaryController(
                        SupplierSkuMappingService service) {
            return new PreferredSupplierSkuSummaryController(service);
        }

        @Bean
        ApiExceptionHandler apiExceptionHandler() {
            return new ApiExceptionHandler();
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
                AuthSessionRepository sessionRepository,
                PermissionRepository permissionRepository,
                SessionTokenService tokenService,
                java.time.Clock clock) {
            return new BearerTokenAuthenticationFilter(
                    sessionRepository,
                    permissionRepository,
                    tokenService,
                    clock);
        }

        @Bean
        TenantContextFilter tenantContextFilter() {
            return new TenantContextFilter();
        }
    }
}
