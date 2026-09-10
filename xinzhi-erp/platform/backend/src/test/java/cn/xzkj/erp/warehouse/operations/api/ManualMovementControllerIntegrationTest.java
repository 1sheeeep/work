package cn.xzkj.erp.warehouse.operations.api;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
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

import cn.xzkj.erp.config.SecurityConfig;
import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.security.BearerTokenAuthenticationFilter;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.iam.security.TenantContextFilter;
import cn.xzkj.erp.platform.api.ApiExceptionHandler;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementApprovalStatus;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementDirection;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementSearchField;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementSource;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementStatus;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementConflictException;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementService;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementService.ManualMovementExport;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.Mutation;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
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

@SpringJUnitConfig
@WebAppConfiguration
@ContextConfiguration(classes = {
        SecurityConfig.class,
        ManualMovementControllerIntegrationTest.WebConfiguration.class
})
class ManualMovementControllerIntegrationTest {
    @Autowired private WebApplicationContext context;
    @Autowired private ManualMovementService service;
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
    void requiresIndependentReadWritePostAndReversePermissions()
            throws Exception {
        UUID movementId = UUID.randomUUID();
        mockMvc.perform(get(
                        "/api/v1/inventory-center/manual-movements"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get(
                        "/api/v1/inventory-center/manual-movements")
                        .with(authentication(auth("warehouses.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(post(
                        "/api/v1/inventory-center/manual-movements")
                        .header("X-Request-Id", "permission-create")
                        .with(authentication(auth("inventory.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validSave()))
                .andExpect(status().isForbidden());
        mockMvc.perform(post(
                        "/api/v1/inventory-center/manual-movements/{id}/post",
                        movementId)
                        .header("X-Request-Id", "permission-post")
                        .with(authentication(auth(
                                "inventory.manual.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validTransition()))
                .andExpect(status().isForbidden());
        mockMvc.perform(post(
                        "/api/v1/inventory-center/manual-movements/{id}/reverse",
                        movementId)
                        .header("X-Request-Id", "permission-reverse")
                        .with(authentication(auth(
                                "inventory.manual.post")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validTransition()))
                .andExpect(status().isForbidden());
        mockMvc.perform(post(
                        "/api/v1/inventory-center/manual-movements/{id}/review",
                        movementId)
                        .header("X-Request-Id", "permission-review")
                        .with(authentication(auth(
                                "inventory.manual.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "expectedVersion":0,
                                  "commandId":"%s",
                                  "approved":true
                                }
                                """.formatted(commandId())))
                .andExpect(status().isForbidden());
        mockMvc.perform(put(
                        "/api/v1/inventory-center/manual-movements/settings/INBOUND")
                        .header("X-Request-Id", "permission-settings")
                        .with(authentication(auth("inventory.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "approvalRequired":true,
                                  "unitPriceRequired":false,
                                  "showCostPrice":false,
                                  "costUpdatePolicy":"NO_UPDATE",
                                  "contactInformationRequired":false,
                                  "expectedVersion":0,
                                  "commandId":"%s"
                                }
                                """.formatted(commandId())))
                .andExpect(status().isForbidden());
        verify(service, never()).create(any(), any());
        verify(service, never()).post(any(), any(), any());
        verify(service, never()).reverse(any(), any(), any());
        verify(service, never()).review(any(), any(), any());
        verify(service, never()).saveSettings(
                any(),
                any(),
                org.mockito.ArgumentMatchers.anyBoolean(),
                org.mockito.ArgumentMatchers.anyBoolean(),
                org.mockito.ArgumentMatchers.anyBoolean(),
                any(),
                org.mockito.ArgumentMatchers.anyBoolean(),
                org.mockito.ArgumentMatchers.anyLong(),
                any());
    }

    @Test
    void listMapsSupportedDocumentFiltersToTheTenantScopedContract()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        Instant createdFrom = Instant.parse("2026-08-01T00:00:00Z");
        Instant createdTo = Instant.parse("2026-08-02T23:59:59Z");
        when(service.list(
                any(), any(), any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(Page.empty());

        mockMvc.perform(get(
                        "/api/v1/inventory-center/manual-movements")
                        .param("warehouseId", warehouseId.toString())
                        .param("direction", "INBOUND")
                        .param("status", "POSTED")
                        .param("source", "MANUAL")
                        .param("approvalStatus", "APPROVED")
                        .param("searchField", "BATCH_NO")
                        .param("keyword", "MI-100")
                        .param("createdFrom", createdFrom.toString())
                        .param("createdTo", createdTo.toString())
                        .param("page", "1")
                        .param("size", "25")
                        .with(authentication(auth(
                                tenantId, "inventory.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray())
                .andExpect(jsonPath("$.totalElements").value(0));

        verify(service).list(
                argThat(actor -> tenantId.equals(actor.tenantId())),
                eq(warehouseId),
                eq(ManualMovementDirection.INBOUND),
                eq(ManualMovementStatus.POSTED),
                isNull(),
                isNull(),
                eq(ManualMovementSource.MANUAL),
                isNull(),
                eq(ManualMovementApprovalStatus.APPROVED),
                eq(ManualMovementSearchField.BATCH_NO),
                isNull(),
                eq("MI-100"),
                eq(createdFrom),
                eq(createdTo),
                argThat(pageable -> pageable.getPageNumber() == 1
                        && pageable.getPageSize() == 25));
    }

    @Test
    void exportRequiresReadPermissionAndMapsTheFilterContract() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        Instant createdFrom = Instant.parse("2026-08-01T00:00:00Z");
        Instant createdTo = Instant.parse("2026-08-02T23:59:59Z");
        when(service.exportCsv(
                any(), any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(new ManualMovementExport(
                        "manual-movements-inbound.csv",
                        "text/csv;charset=utf-8",
                        1,
                        "\uFEFF批次编号,方向,仓库编码,仓库名称,类型,来源,WMS状态,审批状态,计划数量,实际数量,金额,币种,创建人,审核人,单据状态,创建时间\r\n"));
        String body = """
                {
                  "warehouseId":"%s",
                  "direction":"INBOUND",
                  "status":"POSTED",
                  "source":"MANUAL",
                  "approvalStatus":"APPROVED",
                  "searchField":"BATCH_NO",
                  "keyword":"MI-100",
                  "createdFrom":"%s",
                  "createdTo":"%s"
                }
                """.formatted(warehouseId, createdFrom, createdTo);

        mockMvc.perform(post(
                        "/api/v1/inventory-center/manual-movements/exports")
                        .with(authentication(auth(
                                tenantId, "warehouses.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isForbidden());

        mockMvc.perform(post(
                        "/api/v1/inventory-center/manual-movements/exports")
                        .with(authentication(auth(
                                tenantId, "inventory.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename")
                        .value("manual-movements-inbound.csv"))
                .andExpect(jsonPath("$.mediaType")
                        .value("text/csv;charset=utf-8"))
                .andExpect(jsonPath("$.rowCount").value(1));

        verify(service).exportCsv(
                argThat(actor -> tenantId.equals(actor.tenantId())),
                eq(warehouseId),
                eq(ManualMovementDirection.INBOUND),
                eq(ManualMovementStatus.POSTED),
                isNull(),
                isNull(),
                eq(ManualMovementSource.MANUAL),
                isNull(),
                eq(ManualMovementApprovalStatus.APPROVED),
                eq(ManualMovementSearchField.BATCH_NO),
                isNull(),
                eq("MI-100"),
                eq(createdFrom),
                eq(createdTo));
    }

    @Test
    void createUsesPrincipalTenantAndNeverAcceptsTenantFromBody()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        Mutation result = new Mutation(
                UUID.randomUUID(), ManualMovementStatus.DRAFT, 0, false);
        when(service.create(any(), any())).thenReturn(result);

        mockMvc.perform(post(
                        "/api/v1/inventory-center/manual-movements")
                        .header("X-Request-Id", "create-request")
                        .header("X-Tenant-Id", UUID.randomUUID())
                        .with(authentication(auth(
                                tenantId, "inventory.manual.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validSave().replace(
                                "\"warehouseId\"",
                                "\"tenantId\":\""
                                        + UUID.randomUUID()
                                        + "\",\"warehouseId\"")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.movementId")
                        .value(result.movementId().toString()))
                .andExpect(jsonPath("$.tenantId").doesNotExist());

        verify(service).create(
                org.mockito.ArgumentMatchers.argThat(
                        actor -> tenantId.equals(actor.tenantId())
                                && "create-request".equals(
                                        actor.requestId())),
                any());
    }

    @Test
    void rejectsMissingVersionCommandAndInvalidDirectionReason()
            throws Exception {
        TestingAuthenticationToken auth =
                auth("inventory.manual.write");
        mockMvc.perform(post(
                        "/api/v1/inventory-center/manual-movements")
                        .header("X-Request-Id", "missing-version")
                        .with(authentication(auth))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validSave().replace(
                                "\"expectedVersion\":0,", "")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));
        mockMvc.perform(post(
                        "/api/v1/inventory-center/manual-movements")
                        .header("X-Request-Id", "missing-command")
                        .with(authentication(auth))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "warehouseId":"%s",
                                  "direction":"INBOUND",
                                  "reasonCode":"FOUND_STOCK",
                                  "lines":[{
                                    "skuId":"%s",
                                    "locationId":"%s",
                                    "quantity":3
                                  }],
                                  "expectedVersion":0
                                }
                                """.formatted(
                                UUID.randomUUID(),
                                UUID.randomUUID(),
                                UUID.randomUUID())))
                .andExpect(status().isBadRequest());
        verify(service, never()).create(any(), any());
    }

    @Test
    void conflictAndNotFoundResponsesAreSafeAndAllowlisted()
            throws Exception {
        UUID movementId = UUID.randomUUID();
        when(service.post(any(), eq(movementId), any()))
                .thenThrow(new ManualMovementConflictException(
                        "stale_version"));
        mockMvc.perform(post(
                        "/api/v1/inventory-center/manual-movements/{id}/post",
                        movementId)
                        .header("X-Request-Id", "stale-post")
                        .with(authentication(auth(
                                "inventory.manual.post")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validTransition()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.details.reason")
                        .value("stale_version"))
                .andExpect(content().string(
                        not(containsString("postgresql"))));

        when(service.get(any(), eq(movementId)))
                .thenThrow(new ResourceNotFoundException(
                        "jdbc:postgresql://private/tenant"));
        mockMvc.perform(get(
                        "/api/v1/inventory-center/manual-movements/{id}",
                        movementId)
                        .with(authentication(auth("inventory.read"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"))
                .andExpect(content().string(
                        not(containsString("postgresql"))));
    }

    @Test
    void rejectsUnsafeRequestIdBeforeCallingService() throws Exception {
        mockMvc.perform(post(
                        "/api/v1/inventory-center/manual-movements")
                        .header("X-Request-Id", "secret token=bad")
                        .with(authentication(auth(
                                "inventory.manual.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validSave()))
                .andExpect(status().isBadRequest());
        verify(service, never()).create(any(), any());
    }

    private static String validSave() {
        return """
                {
                  "warehouseId":"%s",
                  "direction":"INBOUND",
                  "reasonCode":"FOUND_STOCK",
                  "source":"MANUAL",
                  "entryMode":"PRODUCT",
                  "lines":[{
                    "skuId":"%s",
                    "locationId":"%s",
                    "quantity":3
                  }],
                  "boxes":[],
                  "expectedVersion":0,
                  "commandId":"%s"
                }
                """.formatted(
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                commandId());
    }

    private static String validTransition() {
        return """
                {"expectedVersion":0,"commandId":"%s"}
                """.formatted(commandId());
    }

    private static String commandId() {
        return "10000000-0000-4000-8000-000000000001";
    }

    private static TestingAuthenticationToken auth(String authority) {
        return auth(UUID.randomUUID(), authority);
    }

    private static TestingAuthenticationToken auth(
            UUID tenantId, String authority) {
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
        ManualMovementService manualMovementService() {
            return mock(ManualMovementService.class);
        }

        @Bean
        ManualMovementController manualMovementController(
                ManualMovementService service) {
            return new ManualMovementController(service);
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
                AuthSessionRepository sessions,
                PermissionRepository permissions,
                SessionTokenService tokens,
                java.time.Clock clock) {
            return new BearerTokenAuthenticationFilter(
                    sessions, permissions, tokens, clock);
        }

        @Bean
        TenantContextFilter tenantContextFilter() {
            return new TenantContextFilter();
        }
    }
}
