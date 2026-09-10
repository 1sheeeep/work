package cn.xzkj.erp.procurement.api;

import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.ApiExceptionHandler;
import cn.xzkj.erp.procurement.domain.ProcurementPlanSource;
import cn.xzkj.erp.procurement.domain.ProcurementPlanSearchField;
import cn.xzkj.erp.procurement.domain.ProcurementPlanStatus;
import cn.xzkj.erp.procurement.service.ProcurementPlanConflictException;
import cn.xzkj.erp.procurement.service.ProcurementPlanService;
import cn.xzkj.erp.procurement.service.ProcurementPlanView;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
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
        ProcurementPlanControllerIntegrationTest.WebConfiguration.class
})
class ProcurementPlanControllerIntegrationTest {
    private static final UUID PLAN_ID = UUID.randomUUID();
    private static final UUID SKU_ID = UUID.randomUUID();
    private static final UUID WAREHOUSE_ID = UUID.randomUUID();
    private static final UUID LOCATION_ID = UUID.randomUUID();
    private static final UUID COMMAND_ID = UUID.randomUUID();

    @Autowired private WebApplicationContext context;
    @Autowired private ProcurementPlanService service;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        reset(service);
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @Test
    void requiresAuthenticationAndIndependentProcurementPermissions()
            throws Exception {
        mockMvc.perform(get("/api/v1/procurement/plans"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/procurement/plans")
                        .with(authentication(auth("products.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/v1/procurement/plans/summary")
                        .with(authentication(auth("products.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/procurement/plans")
                        .with(authentication(auth("procurement.read")))
                        .header("X-Request-Id", "request-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createJson(false)))
                .andExpect(status().isForbidden());
        verify(service, never()).create(
                any(), any(), any(), any(), any(), anyLong(), any());
    }

    @Test
    void summaryReturnsOnlyTheWarehouseScopedUnpurchasedCount()
            throws Exception {
        when(service.countUnpurchased(any())).thenReturn(7L);

        mockMvc.perform(get("/api/v1/procurement/plans/summary")
                        .with(authentication(auth("procurement.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.unpurchasedPlans").value(7));

        verify(service).countUnpurchased(any());
    }

    @Test
    void createReturnsRelativeLocationNoStoreAndRejectsUnknownFields()
            throws Exception {
        when(service.create(
                any(), any(), any(), any(), any(), anyLong(), any()))
                .thenReturn(plan(ProcurementPlanStatus.UNPURCHASED, 0));

        mockMvc.perform(post("/api/v1/procurement/plans")
                        .with(authentication(auth("procurement.write")))
                        .header("X-Request-Id", "request-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createJson(false)))
                .andExpect(status().isCreated())
                .andExpect(header().string(
                        "Location", "/api/v1/procurement/plans/" + PLAN_ID))
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andExpect(jsonPath("$.planId").value(PLAN_ID.toString()))
                .andExpect(jsonPath("$.source").value("MANUAL"));

        mockMvc.perform(post("/api/v1/procurement/plans")
                        .with(authentication(auth("procurement.write")))
                        .header("X-Request-Id", "request-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createJson(true)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void conflictResponseExposesOnlyStableReasonAndNoStore() throws Exception {
        when(service.voidPlan(
                any(), any(), any(), anyLong(), any()))
                .thenThrow(new ProcurementPlanConflictException(
                        "optimistic_lock_conflict"));

        mockMvc.perform(post("/api/v1/procurement/plans/{planId}/void", PLAN_ID)
                        .with(authentication(auth("procurement.write")))
                        .header("X-Request-Id", "request-void")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"commandId":"%s","expectedVersion":0,"reason":"obsolete"}
                                """.formatted(COMMAND_ID)))
                .andExpect(status().isConflict())
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andExpect(jsonPath("$.code").value("resource_conflict"))
                .andExpect(jsonPath("$.details.reason")
                        .value("optimistic_lock_conflict"));

        mockMvc.perform(post("/api/v1/procurement/plans/{planId}/void", PLAN_ID)
                        .with(authentication(auth("procurement.write")))
                        .header("X-Request-Id", "request-missing-version")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"commandId":"%s","reason":"obsolete"}
                                """.formatted(COMMAND_ID)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void exportRequiresReadPermissionAndPreservesAllListFilters()
            throws Exception {
        String path = "/api/v1/procurement/plans/exports";
        String body = """
                {
                  "warehouseId": "%s",
                  "locationId": "%s",
                  "status": "VOIDED",
                  "searchField": "SKU_NAME",
                  "keyword": "Product",
                  "createdFrom": "2026-08-01T00:00:00Z",
                  "createdTo": "2026-08-02T23:59:59.999Z"
                }
                """.formatted(WAREHOUSE_ID, LOCATION_ID);
        String content = "\uFEFF计划编号,状态,来源,SKU编号,SKU名称,规格,仓库编码,仓库名称,"
                + "库位编码,库位名称,计划数量,备注,申请人,申请时间,作废原因,作废人,"
                + "作废时间,更新时间\r\n";
        when(service.exportCsv(
                any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(new ProcurementPlanService.ProcurementPlanExport(
                        "procurement-plans.csv", "text/csv;charset=utf-8",
                        0, content));

        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(authentication(auth("products.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(authentication(auth("procurement.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename")
                        .value("procurement-plans.csv"))
                .andExpect(jsonPath("$.rowCount").value(0))
                .andExpect(jsonPath("$.content").value(content));
        verify(service).exportCsv(
                any(), eq(WAREHOUSE_ID), eq(LOCATION_ID),
                eq(ProcurementPlanStatus.VOIDED),
                eq(ProcurementPlanSearchField.SKU_NAME), eq("Product"),
                eq(Instant.parse("2026-08-01T00:00:00Z")),
                eq(Instant.parse("2026-08-02T23:59:59.999Z")));
    }

    private static String createJson(boolean unknown) {
        return """
                {"commandId":"%s","skuId":"%s","warehouseId":"%s",\
                "locationId":"%s","quantity":12,"note":"restock"%s}
                """.formatted(
                        COMMAND_ID, SKU_ID, WAREHOUSE_ID, LOCATION_ID,
                        unknown ? ",\"source\":\"MANUAL\"" : "");
    }

    private static ProcurementPlanView plan(
            ProcurementPlanStatus status, long version) {
        boolean voided = status == ProcurementPlanStatus.VOIDED;
        return new ProcurementPlanView(
                PLAN_ID, "PP-20260801-1111111111111111111111111111",
                status, ProcurementPlanSource.MANUAL,
                SKU_ID, "SKU-1", "Product", "Black",
                WAREHOUSE_ID, "WH-1", "Warehouse",
                LOCATION_ID, "LOC-1", "Location", 12, "restock", "Operator",
                Instant.parse("2026-08-01T10:00:00Z"),
                voided ? "obsolete" : null,
                voided ? "Operator" : null,
                voided ? Instant.parse("2026-08-01T11:00:00Z") : null,
                version, Instant.parse("2026-08-01T10:00:00Z"));
    }

    private static TestingAuthenticationToken auth(String authority) {
        return new TestingAuthenticationToken(
                new ErpPrincipal(
                        UUID.randomUUID(), Instant.parse("2099-01-01T00:00:00Z"),
                        UUID.randomUUID(), "tenant", "Tenant", UUID.randomUUID(),
                        "tester", "Tester"),
                "not-used", authority);
    }

    @Configuration
    @EnableWebMvc
    @EnableWebSecurity
    @EnableMethodSecurity
    static class WebConfiguration {
        @Bean ProcurementPlanService procurementPlanService() {
            return mock(ProcurementPlanService.class);
        }
        @Bean ProcurementPlanController procurementPlanController(
                ProcurementPlanService service) {
            return new ProcurementPlanController(service);
        }
        @Bean ApiExceptionHandler apiExceptionHandler() {
            return new ApiExceptionHandler();
        }
        @Bean SecurityFilterChain securityFilterChain(HttpSecurity http)
                throws Exception {
            return http
                    .csrf(csrf -> csrf.disable())
                    .httpBasic(Customizer.withDefaults())
                    .authorizeHttpRequests(authorize -> authorize
                            .anyRequest().authenticated())
                    .exceptionHandling(exceptions -> exceptions
                            .authenticationEntryPoint((request, response, error) ->
                                    response.sendError(401)))
                    .build();
        }
    }
}
