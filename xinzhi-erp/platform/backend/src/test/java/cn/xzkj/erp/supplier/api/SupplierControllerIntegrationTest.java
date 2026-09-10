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
import org.springframework.test.util.ReflectionTestUtils;
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
import cn.xzkj.erp.supplier.domain.Supplier;
import cn.xzkj.erp.supplier.service.SupplierMasterDataService;
import cn.xzkj.erp.supplier.service.SupplierOnboardingService;

@SpringJUnitConfig
@WebAppConfiguration
@ContextConfiguration(classes = {
        SecurityConfig.class,
        SupplierControllerIntegrationTest.WebConfiguration.class
})
class SupplierControllerIntegrationTest {
    @Autowired private WebApplicationContext webApplicationContext;
    @Autowired private SupplierMasterDataService service;
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
        mockMvc.perform(get("/api/v1/suppliers"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/suppliers")
                        .with(authentication(auth(
                                UUID.randomUUID(),
                                "suppliers.write"))))
                .andExpect(status().isForbidden());
        verify(service, never()).list(any(), any(), any(), any());
    }

    @Test
    void listAndGetRemainTenantDerivedReadContracts() throws Exception {
        UUID tenantId = UUID.randomUUID();
        Supplier supplier = supplier(tenantId);
        when(service.list(
                org.mockito.ArgumentMatchers.eq(tenantId),
                org.mockito.ArgumentMatchers.isNull(),
                org.mockito.ArgumentMatchers.eq("north"),
                any())).thenReturn(Page.empty());
        when(service.get(tenantId, supplier.getId())).thenReturn(supplier);

        mockMvc.perform(get("/api/v1/suppliers")
                        .param("query", "north")
                        .with(authentication(auth(
                                tenantId, "suppliers.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray())
                .andExpect(jsonPath("$.page").value(0));
        mockMvc.perform(get(
                        "/api/v1/suppliers/{supplierId}",
                        supplier.getId())
                        .with(authentication(auth(
                                tenantId, "suppliers.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id")
                        .value(supplier.getId().toString()))
                .andExpect(jsonPath("$.businessCode").value("SUP_ONE"))
                .andExpect(jsonPath("$.tenantId").doesNotExist());

        verify(service).get(tenantId, supplier.getId());
    }

    @Test
    void readValidationAndSafeNotFoundEnvelopeRemainStable()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID supplierId = UUID.randomUUID();
        var read = authentication(auth(tenantId, "suppliers.read"));

        mockMvc.perform(get("/api/v1/suppliers")
                        .param("size", "201")
                        .with(read))
                .andExpect(status().isBadRequest());
        when(service.get(tenantId, supplierId))
                .thenThrow(new ResourceNotFoundException(
                        "private tenant detail"));
        mockMvc.perform(get(
                        "/api/v1/suppliers/{supplierId}",
                        supplierId)
                        .with(read))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message")
                        .value("Requested resource was not found"))
                .andExpect(content().string(not(
                        containsString("private tenant detail"))));
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

    private static Supplier supplier(UUID tenantId) {
        Supplier supplier = new Supplier(
                tenantId,
                "SUP_ONE",
                "Supplier one",
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null);
        ReflectionTestUtils.setField(supplier, "id", UUID.randomUUID());
        ReflectionTestUtils.setField(
                supplier,
                "createdAt",
                Instant.parse("2026-07-29T00:00:00Z"));
        ReflectionTestUtils.setField(
                supplier,
                "updatedAt",
                Instant.parse("2026-07-29T00:00:00Z"));
        return supplier;
    }

    @Configuration
    @EnableWebMvc
    @EnableWebSecurity
    static class WebConfiguration {
        @Bean
        SupplierMasterDataService supplierMasterDataService() {
            return mock(SupplierMasterDataService.class);
        }

        @Bean
        SupplierOnboardingService supplierOnboardingService() {
            return mock(SupplierOnboardingService.class);
        }

        @Bean
        SupplierController supplierController(
                SupplierMasterDataService service,
                SupplierOnboardingService onboardingService) {
            return new SupplierController(service, onboardingService);
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
