package cn.xzkj.erp.analytics.orderstatus;

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

import cn.xzkj.erp.analytics.orderstatus.OrderStatusReportView.StatusCount;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.order.domain.OrderStatus;
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
@ContextConfiguration(classes = OrderStatusReportControllerTest.WebConfiguration.class)
class OrderStatusReportControllerTest {
    @Autowired private WebApplicationContext context;
    @Autowired private OrderStatusReportService service;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        reset(service);
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @Test
    void requiresAnalyticsReadAndReturnsExactOrderStatuses()
            throws Exception {
        mockMvc.perform(get("/api/v1/analytics/order-status"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/analytics/order-status")
                        .with(authentication(auth("orders.read"))))
                .andExpect(status().isForbidden());

        when(service.summarize(any(), any(), any(), any(), any()))
                .thenReturn(new OrderStatusReportResult(
                        List.of(new OrderStatusReportView(
                                LocalDate.parse("2026-08-01"), 3,
                                List.of(
                                        new StatusCount(
                                                OrderStatus.DELIVERED, 2),
                                        new StatusCount(
                                                OrderStatus.CANCELLED, 1)))),
                        3, 1));

        mockMvc.perform(get("/api/v1/analytics/order-status")
                        .with(authentication(auth("analytics.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalOrders").value(3))
                .andExpect(jsonPath("$.items[0].reportDate")
                        .value("2026-08-01"))
                .andExpect(jsonPath("$.items[0].statuses[0].status")
                        .value("DELIVERED"))
                .andExpect(jsonPath("$.items[0].statuses[1].status")
                        .value("CANCELLED"))
                .andExpect(jsonPath("$.revenue").doesNotExist());
        verify(service).summarize(any(), any(), any(), any(), any());
    }

    @Test
    void exportsOnlyWithAnalyticsReadAndPreservesTheOrderWindow()
            throws Exception {
        String body = """
                {
                  "shop": "Demo",
                  "placedFrom": "2026-08-01T00:00:00Z",
                  "placedToExclusive": "2026-08-03T00:00:00Z"
                }
                """;
        String content = "\uFEFF日期（UTC）,订单总数,待付款,已接收,待审核,"
                + "待合并,已搁置,待履约,履约中,已发货,已送达,已取消\r\n";
        when(service.exportCsv(any(), any(), any(), any()))
                .thenReturn(new OrderStatusReportService.OrderStatusReportExport(
                        "order-status-report.csv",
                        "text/csv;charset=utf-8", 0, content));

        mockMvc.perform(post("/api/v1/analytics/order-status/exports")
                        .contentType(APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/analytics/order-status/exports")
                        .contentType(APPLICATION_JSON).content(body)
                        .with(authentication(auth("orders.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/analytics/order-status/exports")
                        .contentType(APPLICATION_JSON).content(body)
                        .with(authentication(auth("analytics.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename")
                        .value("order-status-report.csv"))
                .andExpect(jsonPath("$.rowCount").value(0))
                .andExpect(jsonPath("$.content").value(content));
        verify(service).exportCsv(
                any(), eq("Demo"),
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
        OrderStatusReportService service() {
            return mock(OrderStatusReportService.class);
        }

        @Bean
        OrderStatusReportController controller(
                OrderStatusReportService service) {
            return new OrderStatusReportController(service);
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
