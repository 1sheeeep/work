package cn.xzkj.erp.logistics.statistics;

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
import cn.xzkj.erp.logistics.statistics.LogisticsStatisticsView.Dimension;
import cn.xzkj.erp.logistics.statistics.LogisticsStatisticsView.StatusCount;
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
@ContextConfiguration(classes = LogisticsStatisticsControllerTest.WebConfiguration.class)
class LogisticsStatisticsControllerTest {
    @Autowired private WebApplicationContext context;
    @Autowired private LogisticsStatisticsService service;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        reset(service);
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @Test
    void requiresLogisticsReadAndReturnsExactStoredStatusCounts()
            throws Exception {
        mockMvc.perform(get("/api/v1/logistics/statistics"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/logistics/statistics")
                        .with(authentication(auth("orders.read"))))
                .andExpect(status().isForbidden());

        when(service.summarize(
                any(), any(), any(), any(), any(), any()))
                .thenReturn(new LogisticsStatisticsResult(
                        List.of(new LogisticsStatisticsView(
                                "US", 3,
                                List.of(
                                        new StatusCount("DELIVERED", 2),
                                        new StatusCount(null, 1)))),
                        List.of(
                                new StatusCount("DELIVERED", 2),
                                new StatusCount(null, 1)),
                        3, 1));

        mockMvc.perform(get("/api/v1/logistics/statistics")
                        .queryParam("dimension", "COUNTRY")
                        .with(authentication(auth("logistics.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dimension").value("COUNTRY"))
                .andExpect(jsonPath("$.totalRecords").value(3))
                .andExpect(jsonPath("$.totalStatuses[0].status")
                        .value("DELIVERED"))
                .andExpect(jsonPath("$.totalStatuses[0].recordCount")
                        .value(2))
                .andExpect(jsonPath("$.totalStatuses[1].status").isEmpty())
                .andExpect(jsonPath("$.items[0].groupValue").value("US"))
                .andExpect(jsonPath("$.items[0].recordCount").value(3))
                .andExpect(jsonPath("$.items[0].statuses[0].status")
                        .value("DELIVERED"))
                .andExpect(jsonPath("$.items[0].statuses[1].status")
                        .isEmpty())
                .andExpect(jsonPath("$.recipientName").doesNotExist());
        verify(service).summarize(
                any(), org.mockito.ArgumentMatchers.eq(Dimension.COUNTRY),
                any(), any(), any(), any());
    }

    @Test
    void exportsOnlyWithLogisticsReadAndPreservesTheShipmentWindow()
            throws Exception {
        String body = """
                {
                  "dimension": "CHANNEL",
                  "value": "UPS",
                  "shippedFrom": "2026-08-01T00:00:00Z",
                  "shippedToExclusive": "2026-08-03T00:00:00Z"
                }
                """;
        String content = "\uFEFF统计维度,分组值,跟踪状态,状态记录数,"
                + "分组记录数\r\n";
        when(service.exportCsv(any(), any(), any(), any(), any()))
                .thenReturn(new LogisticsStatisticsService.LogisticsStatisticsExport(
                        "logistics-statistics.csv",
                        "text/csv;charset=utf-8", 0, content));

        mockMvc.perform(post("/api/v1/logistics/statistics/exports")
                        .contentType(APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/logistics/statistics/exports")
                        .contentType(APPLICATION_JSON).content(body)
                        .with(authentication(auth("orders.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/logistics/statistics/exports")
                        .contentType(APPLICATION_JSON).content(body)
                        .with(authentication(auth("logistics.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename")
                        .value("logistics-statistics.csv"))
                .andExpect(jsonPath("$.rowCount").value(0))
                .andExpect(jsonPath("$.content").value(content));
        verify(service).exportCsv(
                any(), eq(Dimension.CHANNEL), eq("UPS"),
                eq(Instant.parse("2026-08-01T00:00:00Z")),
                eq(Instant.parse("2026-08-03T00:00:00Z")));
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
        LogisticsStatisticsService service() {
            return mock(LogisticsStatisticsService.class);
        }

        @Bean
        LogisticsStatisticsController controller(
                LogisticsStatisticsService service) {
            return new LogisticsStatisticsController(service);
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
