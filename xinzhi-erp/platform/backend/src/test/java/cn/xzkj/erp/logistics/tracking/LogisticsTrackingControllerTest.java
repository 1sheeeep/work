package cn.xzkj.erp.logistics.tracking;

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

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.logistics.tracking.LogisticsTrackingView.PackageStatus;
import cn.xzkj.erp.logistics.tracking.LogisticsTrackingView.SearchField;
import cn.xzkj.erp.platform.api.ApiExceptionHandler;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
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
@ContextConfiguration(classes = LogisticsTrackingControllerTest.WebConfiguration.class)
class LogisticsTrackingControllerTest {
    private static final UUID ORDER_ID = UUID.randomUUID();
    @Autowired private WebApplicationContext context;
    @Autowired private LogisticsTrackingService service;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        reset(service);
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @Test
    void requiresLogisticsReadAndReturnsOnlyTheTrackingReadModel()
            throws Exception {
        mockMvc.perform(get("/api/v1/logistics/tracking"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/logistics/tracking")
                        .with(authentication(auth("orders.read"))))
                .andExpect(status().isForbidden());

        LogisticsTrackingView item = new LogisticsTrackingView(
                ORDER_ID, "SHOPIFY", "Shopify", "Demo shop", "ORDER-1",
                "US", "WH-1 · Main", "UPS", "TN-1", null,
                "IN_TRANSIT", null, "Priority",
                Instant.parse("2026-08-01T08:00:00Z"),
                Instant.parse("2026-08-02T08:00:00Z"));
        when(service.list(
                any(), any(), any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any()))
                .thenReturn(new PageImpl<>(
                        java.util.List.of(item), PageRequest.of(0, 25), 1));

        mockMvc.perform(get("/api/v1/logistics/tracking")
                        .queryParam("status", "IN_TRANSIT")
                        .with(authentication(auth("logistics.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].orderId")
                        .value(ORDER_ID.toString()))
                .andExpect(jsonPath("$.items[0].trackingReference")
                        .value("TN-1"))
                .andExpect(jsonPath("$.items[0].trackingStatus")
                        .value("IN_TRANSIT"))
                .andExpect(jsonPath("$.items[0].recipientName").doesNotExist());
        verify(service).list(
                any(), any(), any(), any(), any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.eq(PackageStatus.IN_TRANSIT),
                any(), any(), any());
    }

    @Test
    void exportRequiresLogisticsReadAndPreservesAllFilters()
            throws Exception {
        String path = "/api/v1/logistics/tracking/exports";
        String body = """
                {
                  "shop": "Demo shop",
                  "carrier": "UPS",
                  "country": "US",
                  "warehouse": "Main",
                  "category": "Priority",
                  "searchField": "TRACKING_NO",
                  "keyword": "TN-1",
                  "status": "IN_TRANSIT",
                  "shippedFrom": "2026-08-01T00:00:00Z",
                  "shippedTo": "2026-08-02T23:59:59.999Z"
                }
                """;
        String content = "\uFEFF平台编码,平台名称,店铺名称,订单号,目的国家,仓库,"
                + "物流渠道,主运单号,备用运单号,跟踪状态,固定分类,自定义分类,"
                + "发货时间,更新时间\r\n";
        when(service.exportCsv(
                any(), any(), any(), any(), any(), any(), any(), any(),
                any(), any(), any()))
                .thenReturn(new LogisticsTrackingService.LogisticsTrackingExport(
                        "logistics-tracking.csv", "text/csv;charset=utf-8",
                        0, content));

        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(authentication(auth("orders.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .with(authentication(auth("logistics.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename")
                        .value("logistics-tracking.csv"))
                .andExpect(jsonPath("$.rowCount").value(0))
                .andExpect(jsonPath("$.content").value(content));
        verify(service).exportCsv(
                any(), eq("Demo shop"), eq("UPS"), eq("US"), eq("Main"),
                eq("Priority"), eq(SearchField.TRACKING_NO), eq("TN-1"),
                eq(PackageStatus.IN_TRANSIT),
                eq(Instant.parse("2026-08-01T00:00:00Z")),
                eq(Instant.parse("2026-08-02T23:59:59.999Z")));
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
        LogisticsTrackingService service() {
            return mock(LogisticsTrackingService.class);
        }

        @Bean
        LogisticsTrackingController controller(LogisticsTrackingService service) {
            return new LogisticsTrackingController(service);
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
