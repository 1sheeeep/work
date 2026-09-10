package cn.xzkj.erp.procurement.statistics;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.springframework.http.MediaType.APPLICATION_JSON;
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
@ContextConfiguration(classes = PurchaserStatisticsControllerTest.WebConfiguration.class)
class PurchaserStatisticsControllerTest {
    @Autowired private WebApplicationContext context;
    @Autowired private PurchaserStatisticsService service;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        reset(service);
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @Test
    void requiresProcurementReadAndReturnsOnlyExactOperationalMetrics()
            throws Exception {
        String path = "/api/v1/procurement/statistics/purchasers";
        mockMvc.perform(get(path)).andExpect(status().isUnauthorized());
        mockMvc.perform(get(path).with(authentication(auth("analytics.read"))))
                .andExpect(status().isForbidden());

        when(service.summarize(
                any(), any(), any(), any(), any(), any()))
                .thenReturn(new PurchaserStatisticsResult(
                        List.of(new PurchaserStatisticsView(
                                LocalDate.parse("2026-08-01"), "Buyer A",
                                4, 12, 7, 5, 1, 1, 1, 1)),
                        4, 12, 7, 5, 1));

        mockMvc.perform(get(path)
                        .param("granularity", "DAY")
                        .with(authentication(auth("procurement.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.granularity").value("DAY"))
                .andExpect(jsonPath("$.totalOrders").value(4))
                .andExpect(jsonPath("$.totalOutstandingQuantity").value(5))
                .andExpect(jsonPath("$.items[0].purchaserDisplayName")
                        .value("Buyer A"))
                .andExpect(jsonPath("$.items[0].newOrderCount").value(1))
                .andExpect(jsonPath("$.items[0].approvedOrderCount").value(1))
                .andExpect(jsonPath("$.items[0].receivedOrderCount").value(1))
                .andExpect(jsonPath("$.purchaseAmount").doesNotExist())
                .andExpect(jsonPath("$.onTimeRate").doesNotExist())
                .andExpect(jsonPath("$.score").doesNotExist());
        verify(service).summarize(
                any(), any(), any(), any(), any(), any());
    }

    @Test
    void exportsOnlyWithProcurementReadAndPreservesTheStatisticsWindow()
            throws Exception {
        String path = "/api/v1/procurement/statistics/purchasers/exports";
        String body = """
                {
                  "granularity": "MONTH",
                  "purchaser": "Buyer A",
                  "orderedFrom": "2026-08-01T00:00:00Z",
                  "orderedToExclusive": "2026-09-01T00:00:00Z"
                }
                """;
        String content = "\uFEFF统计期间（UTC）,统计粒度,采购员名称快照,采购单数,"
                + "采购数量,已收数量,待收数量,待审核,待收货,部分收货,已收货\r\n";
        when(service.exportCsv(any(), any(), any(), any(), any()))
                .thenReturn(new PurchaserStatisticsService.PurchaserStatisticsExport(
                        "purchaser-statistics.csv",
                        "text/csv;charset=utf-8", 0, content));

        mockMvc.perform(post(path).contentType(APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post(path).contentType(APPLICATION_JSON).content(body)
                        .with(authentication(auth("analytics.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(post(path).contentType(APPLICATION_JSON).content(body)
                        .with(authentication(auth("procurement.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename")
                        .value("purchaser-statistics.csv"))
                .andExpect(jsonPath("$.rowCount").value(0))
                .andExpect(jsonPath("$.content").value(content));
        verify(service).exportCsv(
                any(), eq(PurchaserStatisticsGranularity.MONTH),
                eq("Buyer A"),
                eq(Instant.parse("2026-08-01T00:00:00Z")),
                eq(Instant.parse("2026-09-01T00:00:00Z")));
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
        PurchaserStatisticsService service() {
            return mock(PurchaserStatisticsService.class);
        }

        @Bean
        PurchaserStatisticsController controller(
                PurchaserStatisticsService service) {
            return new PurchaserStatisticsController(service);
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
