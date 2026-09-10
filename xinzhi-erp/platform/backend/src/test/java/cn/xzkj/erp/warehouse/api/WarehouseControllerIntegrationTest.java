package cn.xzkj.erp.warehouse.api;

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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
import org.springframework.data.domain.PageRequest;
import org.springframework.http.MediaType;
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
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.warehouse.service.WarehouseMasterDataService;
import cn.xzkj.erp.warehouse.service.WarehouseActor;
import cn.xzkj.erp.warehouse.service.WarehouseMasterDataService.WarehouseExport;
import cn.xzkj.erp.warehouse.service.WarehouseMasterDataService.WarehouseLocationExport;
import cn.xzkj.erp.warehouse.domain.WarehouseStatus;

@SpringJUnitConfig
@WebAppConfiguration
@ContextConfiguration(classes = {
        SecurityConfig.class,
        WarehouseControllerIntegrationTest.WebConfiguration.class
})
class WarehouseControllerIntegrationTest {
    @Autowired private WebApplicationContext webApplicationContext;
    @Autowired private WarehouseMasterDataService service;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        SecurityContextHolder.clearContext();
        reset(service);
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(springSecurity()).build();
    }

    @Test
    void authenticationAndReadAuthorityAreRequired() throws Exception {
        mockMvc.perform(get("/api/v1/warehouse-center/warehouses"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/warehouse-center/warehouses")
                        .with(authentication(auth(UUID.randomUUID(), "products.read"))))
                .andExpect(status().isForbidden());
        verify(service, never()).listWarehouses(any(), any(), any(), any());
    }

    @Test
    void forgedTenantHeaderCannotReadAnotherTenantAndErrorsDoNotLeak() throws Exception {
        UUID authenticatedTenant = UUID.randomUUID();
        UUID forgedTenant = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        when(service.getWarehouse(
                org.mockito.ArgumentMatchers.argThat(
                        actor -> authenticatedTenant.equals(actor.tenantId())),
                org.mockito.ArgumentMatchers.eq(warehouseId)))
                .thenThrow(new ResourceNotFoundException("jdbc://private/tenant-secret"));

        mockMvc.perform(get(
                        "/api/v1/warehouse-center/warehouses/{warehouseId}", warehouseId)
                        .header("X-Tenant-Id", forgedTenant)
                        .with(authentication(auth(authenticatedTenant, "warehouses.read"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"))
                .andExpect(jsonPath("$.message").value("Requested resource was not found"))
                .andExpect(jsonPath("$.details").isEmpty())
                .andExpect(content().string(not(containsString("tenant-secret"))));
        verify(service).getWarehouse(
                org.mockito.ArgumentMatchers.argThat(
                        actor -> authenticatedTenant.equals(actor.tenantId())),
                org.mockito.ArgumentMatchers.eq(warehouseId));
        verify(service, never()).getWarehouse(
                org.mockito.ArgumentMatchers.argThat(
                        actor -> forgedTenant.equals(actor.tenantId())),
                org.mockito.ArgumentMatchers.eq(warehouseId));
    }

    @Test
    void nestedLocationUsesPrincipalTenantAndBothParentAndChildIds() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        UUID locationId = UUID.randomUUID();
        when(service.getLocation(
                org.mockito.ArgumentMatchers.argThat(
                        actor -> tenantId.equals(actor.tenantId())),
                org.mockito.ArgumentMatchers.eq(warehouseId),
                org.mockito.ArgumentMatchers.eq(locationId)))
                .thenThrow(new ResourceNotFoundException("wrong parent"));

        mockMvc.perform(get(
                        "/api/v1/warehouse-center/warehouses/{warehouseId}/locations/{locationId}",
                        warehouseId,
                        locationId)
                        .with(authentication(auth(tenantId, "warehouses.read"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));
        verify(service).getLocation(
                org.mockito.ArgumentMatchers.argThat(
                        actor -> tenantId.equals(actor.tenantId())),
                org.mockito.ArgumentMatchers.eq(warehouseId),
                org.mockito.ArgumentMatchers.eq(locationId));
    }

    @Test
    void validatesBodiesAndStablePaginationLimits() throws Exception {
        UUID tenantId = UUID.randomUUID();
        mockMvc.perform(post("/api/v1/warehouse-center/warehouses")
                        .with(authentication(auth(tenantId, "warehouses.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"businessCode":"bad code","name":""}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"))
                .andExpect(jsonPath("$.details.businessCode").value("invalid"))
                .andExpect(jsonPath("$.details.name").value("invalid"));

        mockMvc.perform(get("/api/v1/warehouse-center/warehouses")
                        .param("size", "201")
                        .with(authentication(auth(tenantId, "warehouses.read"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"))
                .andExpect(jsonPath("$.details").isEmpty());
        verify(service, never()).createWarehouse(any(), any(), any());
        verify(service, never()).listWarehouses(any(), any(), any(), any());
    }

    @Test
    void returnsStableDefaultsAndSafeOptimisticConflict() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        when(service.listWarehouses(
                org.mockito.ArgumentMatchers.argThat(
                        actor -> tenantId.equals(actor.tenantId())),
                org.mockito.ArgumentMatchers.isNull(),
                org.mockito.ArgumentMatchers.isNull(),
                org.mockito.ArgumentMatchers.eq(PageRequest.of(0, 50))))
                .thenReturn(Page.empty(PageRequest.of(0, 50)));
        mockMvc.perform(get("/api/v1/warehouse-center/warehouses")
                        .with(authentication(auth(tenantId, "warehouses.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(50))
                .andExpect(jsonPath("$.items").isArray());

        when(service.updateWarehouse(
                any(WarehouseActor.class), org.mockito.ArgumentMatchers.eq(warehouseId),
                org.mockito.ArgumentMatchers.eq(4L),
                org.mockito.ArgumentMatchers.eq("Changed"),
                org.mockito.ArgumentMatchers.eq(
                        cn.xzkj.erp.warehouse.domain.WarehouseStatus.ACTIVE)))
                .thenThrow(new ConflictException("actual version 12"));
        mockMvc.perform(put(
                        "/api/v1/warehouse-center/warehouses/{warehouseId}", warehouseId)
                        .with(authentication(auth(tenantId, "warehouses.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":4,"name":"Changed","status":"ACTIVE"}
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("resource_conflict"))
                .andExpect(content().string(not(containsString("version 12"))));
    }

    @Test
    void requiresReadAuthorityAndReturnsTheWarehouseExportContract() throws Exception {
        UUID tenantId = UUID.randomUUID();
        when(service.exportWarehouses(
                org.mockito.ArgumentMatchers.argThat(
                        actor -> tenantId.equals(actor.tenantId())),
                org.mockito.ArgumentMatchers.eq(WarehouseStatus.INACTIVE),
                org.mockito.ArgumentMatchers.eq("north")))
                .thenReturn(new WarehouseExport(
                        "warehouses.csv",
                        "text/csv;charset=utf-8",
                        1,
                        "\uFEFF仓库名称,业务编码,状态,创建时间,更新时间\r\n"));

        mockMvc.perform(post("/api/v1/warehouse-center/warehouses/exports")
                        .with(authentication(auth(tenantId, "products.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/v1/warehouse-center/warehouses/exports")
                        .with(authentication(auth(tenantId, "warehouses.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"status":"INACTIVE","keyword":"north"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename").value("warehouses.csv"))
                .andExpect(jsonPath("$.mediaType").value("text/csv;charset=utf-8"))
                .andExpect(jsonPath("$.rowCount").value(1))
                .andExpect(jsonPath("$.content").value(
                        "\uFEFF仓库名称,业务编码,状态,创建时间,更新时间\r\n"));
        verify(service).exportWarehouses(
                org.mockito.ArgumentMatchers.argThat(
                        actor -> tenantId.equals(actor.tenantId())),
                org.mockito.ArgumentMatchers.eq(WarehouseStatus.INACTIVE),
                org.mockito.ArgumentMatchers.eq("north"));
    }

    @Test
    void requiresReadAuthorityAndReturnsTheLocationExportContract() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        when(service.exportLocations(
                org.mockito.ArgumentMatchers.argThat(
                        actor -> tenantId.equals(actor.tenantId())),
                org.mockito.ArgumentMatchers.eq(warehouseId),
                org.mockito.ArgumentMatchers.eq(WarehouseStatus.ACTIVE),
                org.mockito.ArgumentMatchers.eq("pick")))
                .thenReturn(new WarehouseLocationExport(
                        "warehouse-locations.csv",
                        "text/csv;charset=utf-8",
                        1,
                        "\uFEFF仓库名称,仓库编码,库位名称,库位编码,状态,创建时间,更新时间\r\n"));

        String path = "/api/v1/warehouse-center/warehouses/{warehouseId}/locations/exports";
        mockMvc.perform(post(path, warehouseId)
                        .with(authentication(auth(tenantId, "products.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isForbidden());

        mockMvc.perform(post(path, warehouseId)
                        .with(authentication(auth(tenantId, "warehouses.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"status":"ACTIVE","keyword":"pick"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename").value("warehouse-locations.csv"))
                .andExpect(jsonPath("$.mediaType").value("text/csv;charset=utf-8"))
                .andExpect(jsonPath("$.rowCount").value(1));
        verify(service).exportLocations(
                org.mockito.ArgumentMatchers.argThat(
                        actor -> tenantId.equals(actor.tenantId())),
                org.mockito.ArgumentMatchers.eq(warehouseId),
                org.mockito.ArgumentMatchers.eq(WarehouseStatus.ACTIVE),
                org.mockito.ArgumentMatchers.eq("pick"));
    }

    private static TestingAuthenticationToken auth(UUID tenantId, String authority) {
        return new TestingAuthenticationToken(
                new ErpPrincipal(
                        UUID.randomUUID(),
                        Instant.parse("2099-01-01T00:00:00Z"),
                        tenantId,
                        "test",
                        "Test Tenant",
                        UUID.randomUUID(),
                        "tester",
                        "Tester"),
                "not-used",
                authority);
    }

    @Configuration
    @EnableWebMvc
    @EnableWebSecurity
    static class WebConfiguration {
        @Bean
        WarehouseMasterDataService warehouseMasterDataService() {
            return mock(WarehouseMasterDataService.class);
        }

        @Bean
        WarehouseController warehouseController(WarehouseMasterDataService service) {
            return new WarehouseController(service);
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
                    sessionRepository, permissionRepository, tokenService, clock);
        }

        @Bean
        TenantContextFilter tenantContextFilter() {
            return new TenantContextFilter();
        }
    }
}
