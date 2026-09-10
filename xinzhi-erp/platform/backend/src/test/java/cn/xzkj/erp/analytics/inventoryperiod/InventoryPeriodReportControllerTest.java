package cn.xzkj.erp.analytics.inventoryperiod;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.http.MediaType.APPLICATION_JSON;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.ApiExceptionHandler;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
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
@ContextConfiguration(
        classes = InventoryPeriodReportControllerTest.WebConfiguration.class)
class InventoryPeriodReportControllerTest {
    private static final String PATH =
            "/api/v1/analytics/inventory-period"
                    + "?periodFrom=2026-07-01&periodTo=2026-07-31";

    @Autowired private WebApplicationContext context;
    @Autowired private InventoryPeriodReportService service;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        reset(service);
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @Test
    void acceptsEitherExistingReadPermissionAndReturnsExactQuantities()
            throws Exception {
        mockMvc.perform(get(PATH)).andExpect(status().isUnauthorized());
        mockMvc.perform(get(PATH)
                        .with(authentication(auth("orders.read"))))
                .andExpect(status().isForbidden());

        when(service.summarize(
                any(), any(), any(), any(), any(), any()))
                .thenReturn(new InventoryPeriodReportResult(
                        List.of(new InventoryPeriodReportItem(
                                UUID.randomUUID(), "SKU-1", "Demo SKU",
                                UUID.randomUUID(), "WH-1", "Main warehouse",
                                10, 5, 3, 12)),
                        10, 5, 3, 12, 1));

        mockMvc.perform(get(PATH)
                        .with(authentication(auth("inventory.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].openingQuantity")
                        .value(10))
                .andExpect(jsonPath("$.items[0].increasedQuantity")
                        .value(5))
                .andExpect(jsonPath("$.items[0].decreasedQuantity")
                        .value(3))
                .andExpect(jsonPath("$.items[0].closingQuantity")
                        .value(12))
                .andExpect(jsonPath("$.amount").doesNotExist());
        mockMvc.perform(get(PATH)
                        .with(authentication(auth("analytics.read"))))
                .andExpect(status().isOk());
        verify(service, org.mockito.Mockito.times(2)).summarize(
                any(), any(), any(), any(), any(), any());
    }

    @Test
    void exportsWithEitherExistingReadPermissionAndPreservesFilters()
            throws Exception {
        String body = """
                {
                  "periodFrom": "2026-07-01",
                  "periodTo": "2026-07-31",
                  "warehouseId": "11111111-1111-4111-8111-111111111111",
                  "keyword": "SKU-A"
                }
                """;
        String content = "\uFEFF库存SKU,商品名称,仓库编码,仓库名称,期初数量,"
                + "期间增加,期间减少,期末数量\r\n";
        when(service.exportCsv(any(), any(), any(), any(), any()))
                .thenReturn(new InventoryPeriodReportService.InventoryPeriodReportExport(
                        "inventory-period-report.csv",
                        "text/csv;charset=utf-8", 0, content));

        mockMvc.perform(post("/api/v1/analytics/inventory-period/exports")
                        .contentType(APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/analytics/inventory-period/exports")
                        .contentType(APPLICATION_JSON).content(body)
                        .with(authentication(auth("orders.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/analytics/inventory-period/exports")
                        .contentType(APPLICATION_JSON).content(body)
                        .with(authentication(auth("inventory.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename")
                        .value("inventory-period-report.csv"))
                .andExpect(jsonPath("$.rowCount").value(0))
                .andExpect(jsonPath("$.content").value(content));
        mockMvc.perform(post("/api/v1/analytics/inventory-period/exports")
                        .contentType(APPLICATION_JSON).content(body)
                        .with(authentication(auth("analytics.read"))))
                .andExpect(status().isOk());
        verify(service, org.mockito.Mockito.times(2)).exportCsv(
                any(), eq(LocalDate.parse("2026-07-01")),
                eq(LocalDate.parse("2026-07-31")),
                eq(UUID.fromString("11111111-1111-4111-8111-111111111111")),
                eq("SKU-A"));
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
        @Bean
        InventoryPeriodReportService service() {
            return mock(InventoryPeriodReportService.class);
        }

        @Bean
        InventoryPeriodReportController controller(
                InventoryPeriodReportService service) {
            return new InventoryPeriodReportController(service);
        }

        @Bean
        ApiExceptionHandler apiExceptionHandler() {
            return new ApiExceptionHandler();
        }

        @Bean
        SecurityFilterChain securityFilterChain(HttpSecurity http)
                throws Exception {
            return http.csrf(csrf -> csrf.disable())
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
