package cn.xzkj.erp.analytics.inventorysales;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.http.MediaType.APPLICATION_JSON;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.ApiExceptionHandler;
import java.time.Instant;
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
        classes = InventoryRealtimeSalesControllerTest.WebConfiguration.class)
class InventoryRealtimeSalesControllerTest {
    @Autowired private WebApplicationContext context;
    @Autowired private InventoryRealtimeSalesService service;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        reset(service);
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @Test
    void requiresAnalyticsReadAndReturnsOnlySupportedInventorySalesFacts()
            throws Exception {
        String asOf = "2026-08-10T12:00:00Z";
        mockMvc.perform(get("/api/v1/analytics/inventory-sales")
                        .param("asOf", asOf))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/analytics/inventory-sales")
                        .param("asOf", asOf)
                        .with(authentication(auth("inventory.read"))))
                .andExpect(status().isForbidden());

        UUID balanceId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        when(service.summarize(any(), any(), any(), any(), any()))
                .thenReturn(new InventoryRealtimeSalesResult(
                        List.of(new InventoryRealtimeSalesItem(
                                balanceId, skuId, "SKU-A", "Product A",
                                "Black", warehouseId, "WH-A", "Warehouse A",
                                20, 3, 17, 9, 2, 3, 2, 9, 14, 20,
                                Instant.parse("2026-08-10T11:00:00Z"))),
                        1, 20, 3, 17, 9));

        mockMvc.perform(get("/api/v1/analytics/inventory-sales")
                        .param("asOf", asOf)
                        .with(authentication(auth("analytics.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalBalanceCount").value(1))
                .andExpect(jsonPath("$.totalAvailable").value(17))
                .andExpect(jsonPath("$.observedAt").value(asOf))
                .andExpect(jsonPath("$.items[0].balanceId")
                        .value(balanceId.toString()))
                .andExpect(jsonPath("$.items[0].last42DaysSalesQuantity")
                        .value(20))
                .andExpect(jsonPath("$.items[0].revenue").doesNotExist())
                .andExpect(jsonPath("$.totalRevenue").doesNotExist());
        verify(service).summarize(any(), any(), any(), any(), any());
    }

    @Test
    void exportsOnlyWithAnalyticsReadAndPreservesTheObservationWindow()
            throws Exception {
        String body = """
                {
                  "keyword": "SKU-A",
                  "rangeFrom": "2026-08-01T00:00:00Z",
                  "asOf": "2026-08-10T12:00:00Z"
                }
                """;
        String content = "\uFEFF库存SKU,SKU名称,规格,仓库编码,仓库名称,现货,预留,可用,"
                + "所选区间销量,所选区间订单数,今日销量,昨日销量,近7天销量,"
                + "近28天销量,近42天销量,库存更新时间,统计截至\r\n";
        when(service.exportCsv(any(), any(), any(), any()))
                .thenReturn(new InventoryRealtimeSalesService
                        .InventoryRealtimeSalesExport(
                                "inventory-realtime-sales.csv",
                                "text/csv;charset=utf-8", 0, content));

        mockMvc.perform(post("/api/v1/analytics/inventory-sales/exports")
                        .contentType(APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/analytics/inventory-sales/exports")
                        .contentType(APPLICATION_JSON).content(body)
                        .with(authentication(auth("inventory.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/analytics/inventory-sales/exports")
                        .contentType(APPLICATION_JSON).content(body)
                        .with(authentication(auth("analytics.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename")
                        .value("inventory-realtime-sales.csv"))
                .andExpect(jsonPath("$.mediaType")
                        .value("text/csv;charset=utf-8"))
                .andExpect(jsonPath("$.rowCount").value(0))
                .andExpect(jsonPath("$.content").value(content));
        verify(service).exportCsv(
                any(), eq("SKU-A"),
                eq(Instant.parse("2026-08-01T00:00:00Z")),
                eq(Instant.parse("2026-08-10T12:00:00Z")));
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
        InventoryRealtimeSalesService service() {
            return mock(InventoryRealtimeSalesService.class);
        }

        @Bean
        InventoryRealtimeSalesController controller(
                InventoryRealtimeSalesService service) {
            return new InventoryRealtimeSalesController(service);
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
