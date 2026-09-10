package cn.xzkj.erp.inventory.api;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
import cn.xzkj.erp.inventory.domain.InventoryEventType;
import cn.xzkj.erp.inventory.service.InventoryBalanceSearchField;
import cn.xzkj.erp.inventory.service.InventoryBalanceView;
import cn.xzkj.erp.inventory.service.InventoryConflictException;
import cn.xzkj.erp.inventory.service.InventoryEventView;
import cn.xzkj.erp.inventory.service.InventoryMutationResult;
import cn.xzkj.erp.inventory.service.InventoryService;
import cn.xzkj.erp.inventory.service.InventorySkuSummaryView;
import cn.xzkj.erp.platform.api.ApiExceptionHandler;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.Page;
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

@SpringJUnitConfig
@WebAppConfiguration
@ContextConfiguration(classes = {
        SecurityConfig.class,
        InventoryControllerIntegrationTest.WebConfiguration.class
})
class InventoryControllerIntegrationTest {
    @Autowired private WebApplicationContext webApplicationContext;
    @Autowired private InventoryService service;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        SecurityContextHolder.clearContext();
        reset(service);
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(springSecurity())
                .build();
    }

    @Test
    void requiresAuthenticationAndIndependentInventoryPermissions()
            throws Exception {
        mockMvc.perform(get("/api/v1/inventory-center/balances"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/inventory-center/balances")
                        .with(authentication(auth("warehouses.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/v1/inventory-center/balance-summaries")
                        .param("skuId", UUID.randomUUID().toString())
                        .with(authentication(auth("products.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/inventory-center/adjustments")
                        .header("Idempotency-Key", "permission-check")
                        .header("X-Request-Id", "request-permission")
                        .with(authentication(auth("inventory.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validAdjustment()))
                .andExpect(status().isForbidden());
        verify(service, never()).listBalances(
                any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any(), any());
        verify(service, never()).listSkuSummaries(any(), any());
        verify(service, never()).adjust(
                any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyLong(),
                any(), any(), any());
    }

    @Test
    void listsBalancesUsingOnlyPrincipalTenant() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID categoryId = UUID.randomUUID();
        when(service.listBalances(
                any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any(), any()))
                .thenReturn(Page.empty());

        mockMvc.perform(get("/api/v1/inventory-center/balances")
                        .param("categoryId", categoryId.toString())
                        .param("searchField", "MASTER_SKU")
                        .param("keyword", "MASTER_100")
                        .param("onHandMin", "-2")
                        .param("onHandMax", "10")
                        .param("updatedFrom", "2026-07-01")
                        .param("updatedTo", "2026-07-31")
                        .header("X-Tenant-Id", UUID.randomUUID())
                        .with(authentication(auth(
                                tenantId, "inventory.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray());

        verify(service).listBalances(
                org.mockito.ArgumentMatchers.argThat(
                        actor -> tenantId.equals(actor.tenantId())),
                any(),
                any(),
                eq(categoryId),
                eq(InventoryBalanceSearchField.MASTER_SKU),
                eq("MASTER_100"),
                eq(-2L),
                eq(10L),
                eq(java.time.LocalDate.of(2026, 7, 1)),
                eq(java.time.LocalDate.of(2026, 7, 31)),
                any(org.springframework.data.domain.Pageable.class));
    }

    @Test
    void rejectsUnsupportedBalanceSearchFieldsBeforeTheService() throws Exception {
        mockMvc.perform(get("/api/v1/inventory-center/balances")
                        .param("searchField", "SUPPLIER")
                        .with(authentication(auth("inventory.read"))))
                .andExpect(status().isBadRequest());

        verify(service, never()).listBalances(
                any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any(), any());
    }

    @Test
    void listsBoundedSkuSummariesUsingOnlyPrincipalTenant()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID firstSkuId = UUID.randomUUID();
        UUID secondSkuId = UUID.randomUUID();
        when(service.listSkuSummaries(any(), any()))
                .thenReturn(List.of(
                        new InventorySkuSummaryView(firstSkuId, 12, 3),
                        new InventorySkuSummaryView(secondSkuId, -2, 1)));

        mockMvc.perform(get("/api/v1/inventory-center/balance-summaries")
                        .param("skuId", firstSkuId.toString())
                        .param("skuId", secondSkuId.toString())
                        .header("X-Tenant-Id", UUID.randomUUID())
                        .with(authentication(auth(
                                tenantId, "inventory.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].skuId")
                        .value(firstSkuId.toString()))
                .andExpect(jsonPath("$.items[0].onHand").value(12))
                .andExpect(jsonPath("$.items[0].reserved").value(3))
                .andExpect(jsonPath("$.items[0].available").value(9))
                .andExpect(jsonPath("$.items[1].onHand").value(-2))
                .andExpect(jsonPath("$.items[1].available").value(-3));

        verify(service).listSkuSummaries(
                org.mockito.ArgumentMatchers.argThat(
                        actor -> tenantId.equals(actor.tenantId())),
                eq(List.of(firstSkuId, secondSkuId)));
    }

    @Test
    void validatesWriteHeadersAndReturnsSafeConflictReason() throws Exception {
        TestingAuthenticationToken authentication =
                auth("inventory.adjust");
        mockMvc.perform(post("/api/v1/inventory-center/adjustments")
                        .with(authentication(authentication))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validAdjustment()))
                .andExpect(status().isBadRequest());
        verify(service, never()).adjust(
                any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyLong(),
                any(), any(), any());

        when(service.adjust(
                any(),
                eq(InventoryEventType.CORRECTION),
                any(),
                any(),
                eq(-3L),
                eq(0L),
                eq("STOCK_CORRECTION"),
                eq(null),
                eq("adjust-1")))
                .thenThrow(new InventoryConflictException("stale_version"));
        mockMvc.perform(post("/api/v1/inventory-center/adjustments")
                        .header("Idempotency-Key", "adjust-1")
                        .header("X-Request-Id", "request-1")
                        .with(authentication(authentication))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validAdjustment()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("resource_conflict"))
                .andExpect(jsonPath("$.details.reason")
                        .value("stale_version"))
                .andExpect(content().string(
                        not(containsString("private"))));
    }

    @Test
    void rejectsAdjustmentAndReversalWhenExpectedVersionIsMissing()
            throws Exception {
        TestingAuthenticationToken authentication =
                auth("inventory.adjust");
        UUID eventId = UUID.randomUUID();
        String headersRequest = "request-required-version";

        mockMvc.perform(post("/api/v1/inventory-center/adjustments")
                        .header("Idempotency-Key", "missing-adjust-version")
                        .header("X-Request-Id", headersRequest)
                        .with(authentication(authentication))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "type": "CORRECTION",
                                  "skuId": "%s",
                                  "warehouseId": "%s",
                                  "signedDelta": 1,
                                  "reason": "STOCK_CORRECTION"
                                }
                """.formatted(
                                UUID.randomUUID(),
                                UUID.randomUUID())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));

        mockMvc.perform(post(
                        "/api/v1/inventory-center/ledger-events/{id}/reversal",
                        eventId)
                        .header("Idempotency-Key", "missing-reversal-version")
                        .header("X-Request-Id", headersRequest)
                        .with(authentication(authentication))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "reason": "REVERSAL_CORRECTION"
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));

        verify(service, never()).adjust(
                any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyLong(),
                any(), any(), any());
        verify(service, never()).reverse(
                any(), any(),
                org.mockito.ArgumentMatchers.anyLong(),
                any(), any(), any());
    }

    @Test
    void responseIsAllowlistedAndDoesNotExposeNoteOrTenant()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        InventoryMutationResult result = mutation();
        when(service.adjust(
                any(),
                eq(InventoryEventType.CORRECTION),
                eq(result.event().skuId()),
                eq(result.event().warehouseId()),
                eq(-3L),
                eq(0L),
                eq("STOCK_CORRECTION"),
                eq("secret=should-redact"),
                eq("adjust-1")))
                .thenReturn(result);

        mockMvc.perform(post("/api/v1/inventory-center/adjustments")
                        .header("Idempotency-Key", "adjust-1")
                        .header("X-Request-Id", "request-1")
                        .with(authentication(auth(
                                tenantId, "inventory.adjust")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "type": "CORRECTION",
                                  "skuId": "%s",
                                  "warehouseId": "%s",
                                  "signedDelta": -3,
                                  "expectedVersion": 0,
                                  "reason": "STOCK_CORRECTION",
                                  "note": "secret=should-redact"
                                }
                                """.formatted(
                                result.event().skuId(),
                                result.event().warehouseId())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.event.signedDelta").value(-3))
                .andExpect(jsonPath("$.event.skuBusinessCode")
                        .value("SKU_1"))
                .andExpect(jsonPath("$.event.skuName")
                        .value("SKU One"))
                .andExpect(jsonPath("$.event.warehouseBusinessCode")
                        .value("WH_1"))
                .andExpect(jsonPath("$.event.warehouseName")
                        .value("Warehouse One"))
                .andExpect(jsonPath("$.balance.onHand").value(-3))
                .andExpect(jsonPath("$.balance.available").value(-3))
                .andExpect(jsonPath("$.event.note").doesNotExist())
                .andExpect(jsonPath("$.tenantId").doesNotExist())
                .andExpect(content().string(
                        not(containsString("should-redact"))));
    }

    @Test
    void crossTenantAndOutOfScopeResourcesShareSafe404()
            throws Exception {
        UUID balanceId = UUID.randomUUID();
        when(service.getBalance(any(), eq(balanceId)))
                .thenThrow(new ResourceNotFoundException(
                        "jdbc:postgresql://private/tenant"));

        mockMvc.perform(get(
                        "/api/v1/inventory-center/balances/{id}", balanceId)
                        .with(authentication(auth("inventory.read"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"))
                .andExpect(content().string(
                        not(containsString("postgresql"))));
    }

    private static String validAdjustment() {
        return """
                {
                  "type": "CORRECTION",
                  "skuId": "%s",
                  "warehouseId": "%s",
                  "signedDelta": -3,
                  "expectedVersion": 0,
                  "reason": "STOCK_CORRECTION"
                }
                """.formatted(UUID.randomUUID(), UUID.randomUUID());
    }

    private static InventoryMutationResult mutation() {
        UUID skuId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        Instant now = Instant.parse("2026-07-30T00:00:00Z");
        InventoryEventView event = new InventoryEventView(
                UUID.randomUUID(),
                1,
                InventoryEventType.CORRECTION,
                skuId,
                "SKU_1",
                "SKU One",
                warehouseId,
                "WH_1",
                "Warehouse One",
                -3,
                -3,
                1,
                "STOCK_CORRECTION",
                null,
                "request-1",
                now);
        InventoryBalanceView balance = new InventoryBalanceView(
                UUID.randomUUID(),
                skuId,
                "SKU_1",
                "SKU One",
                warehouseId,
                "WH_1",
                "Warehouse One",
                -3,
                1,
                now);
        return new InventoryMutationResult(event, balance, false);
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
        InventoryService inventoryService() {
            return mock(InventoryService.class);
        }

        @Bean
        InventoryController inventoryController(InventoryService service) {
            return new InventoryController(service);
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
