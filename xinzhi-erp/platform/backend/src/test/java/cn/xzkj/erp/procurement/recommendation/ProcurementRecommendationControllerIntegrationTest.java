package cn.xzkj.erp.procurement.recommendation;

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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.ApiExceptionHandler;
import cn.xzkj.erp.procurement.recommendation.ProcurementRecommendationService.ProcurementGenerationItem;
import cn.xzkj.erp.procurement.recommendation.ProcurementRecommendationService.ProcurementGenerationResult;
import cn.xzkj.erp.procurement.service.ProcurementPlanActor;
import java.time.Instant;
import java.util.List;
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
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
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
        ProcurementRecommendationControllerIntegrationTest.WebConfiguration.class
})
class ProcurementRecommendationControllerIntegrationTest {
    private static final UUID COMMAND_ID = uuid("10000000-0000-4000-8000-000000000001");
    private static final UUID SKU_ID = uuid("10000000-0000-4000-8000-000000000002");
    private static final UUID WAREHOUSE_ID = uuid("10000000-0000-4000-8000-000000000003");
    private static final UUID LOCATION_ID = uuid("10000000-0000-4000-8000-000000000004");
    private static final UUID SUPPLIER_ID = uuid("10000000-0000-4000-8000-000000000005");
    private static final UUID PLAN_ID = uuid("10000000-0000-4000-8000-000000000006");
    private static final UUID ORDER_ID = uuid("10000000-0000-4000-8000-000000000007");
    private static final Instant OBSERVED_AT = Instant.parse("2026-08-11T05:00:00Z");

    @Autowired private WebApplicationContext context;
    @Autowired private ProcurementRecommendationService service;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        reset(service);
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @Test
    void listRequiresProcurementReadAndReturnsFormulaFacts() throws Exception {
        when(service.summarize(
                any(), any(), any(), eq(false), eq(false),
                eq(OBSERVED_AT), any()))
                .thenReturn(new ProcurementRecommendationResult(
                        List.of(item()),
                        List.of(new ProcurementRecommendationLocation(
                                LOCATION_ID, WAREHOUSE_ID,
                                "RECEIVE", "Receiving")),
                        1, 1, 16));
        String path = "/api/v1/procurement/recommendations?asOf="
                + "2026-08-11T05:00:00Z&page=0&size=25";

        mockMvc.perform(get(path)).andExpect(status().isUnauthorized());
        mockMvc.perform(get(path).with(authentication(auth("products.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(get(path).with(authentication(auth("procurement.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].recommendedQuantity").value(16))
                .andExpect(jsonPath("$.items[0].targetCoverageDays").value(21))
                .andExpect(jsonPath("$.locations[0].id")
                        .value(LOCATION_ID.toString()))
                .andExpect(jsonPath("$.salesWindowDays").value(28));
    }

    @Test
    void generateRequiresWritePermissionAndRejectsUnknownFacts() throws Exception {
        when(service.generate(
                any(), eq(COMMAND_ID), eq(OBSERVED_AT), any()))
                .thenReturn(new ProcurementGenerationResult(
                        COMMAND_ID, OBSERVED_AT,
                        List.of(new ProcurementGenerationItem(
                                ORDER_ID, "PO-1", PLAN_ID, "PP-1",
                                SKU_ID, WAREHOUSE_ID, LOCATION_ID,
                                SUPPLIER_ID, 16))));

        mockMvc.perform(post("/api/v1/procurement/recommendations/generate")
                        .with(authentication(auth("procurement.read")))
                        .header("X-Request-Id", "request-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(generateJson(false)))
                .andExpect(status().isForbidden());
        verify(service, never()).generate(any(), any(), any(), any());

        mockMvc.perform(post("/api/v1/procurement/recommendations/generate")
                        .with(authentication(auth("procurement.write")))
                        .header("X-Request-Id", "request-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(generateJson(false)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commandId").value(COMMAND_ID.toString()))
                .andExpect(jsonPath("$.items[0].purchaseOrderId")
                        .value(ORDER_ID.toString()));

        mockMvc.perform(post("/api/v1/procurement/recommendations/generate")
                        .with(authentication(auth("procurement.write")))
                        .header("X-Request-Id", "request-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(generateJson(true)))
                .andExpect(status().isBadRequest());
    }

    private static String generateJson(boolean unknown) {
        return """
                {
                  "commandId":"%s",
                  "observedAt":"2026-08-11T05:00:00Z",
                  "items":[{
                    "skuId":"%s",
                    "warehouseId":"%s",
                    "locationId":"%s",
                    "expectedRecommendedQuantity":16,
                    "quantity":16%s
                  }]
                }
                """.formatted(
                        COMMAND_ID, SKU_ID, WAREHOUSE_ID, LOCATION_ID,
                        unknown ? ",\"unitCost\":2" : "");
    }

    private static ProcurementRecommendationItem item() {
        return new ProcurementRecommendationItem(
                SKU_ID, "SKU-A", "Product A", null,
                WAREHOUSE_ID, "WH-A", "Warehouse A",
                5, 0, 5, 28, 0,
                SUPPLIER_ID, "SUP-A", "Supplier A", null,
                14, 14, 7, 21, 21, 16, 1);
    }

    private static TestingAuthenticationToken auth(String authority) {
        return new TestingAuthenticationToken(
                new ErpPrincipal(
                        UUID.randomUUID(), Instant.parse("2099-01-01T00:00:00Z"),
                        UUID.randomUUID(), "tenant", "Tenant", UUID.randomUUID(),
                        "tester", "Tester"),
                "not-used", authority);
    }

    private static UUID uuid(String value) {
        return UUID.fromString(value);
    }

    @Configuration
    @EnableWebMvc
    @EnableWebSecurity
    @EnableMethodSecurity
    static class WebConfiguration {
        @Bean ProcurementRecommendationService recommendationService() {
            return mock(ProcurementRecommendationService.class);
        }

        @Bean ProcurementRecommendationController recommendationController(
                ProcurementRecommendationService service) {
            return new ProcurementRecommendationController(service);
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
