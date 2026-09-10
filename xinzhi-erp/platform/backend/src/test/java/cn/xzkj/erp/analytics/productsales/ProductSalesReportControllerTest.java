package cn.xzkj.erp.analytics.productsales;

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
@ContextConfiguration(classes = ProductSalesReportControllerTest.WebConfiguration.class)
class ProductSalesReportControllerTest {
    @Autowired private WebApplicationContext context;
    @Autowired private ProductSalesReportService service;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        reset(service);
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @Test
    void requiresAnalyticsReadAndReturnsOnlyPersistedSalesFacts()
            throws Exception {
        mockMvc.perform(get("/api/v1/analytics/product-sales"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/analytics/product-sales")
                        .with(authentication(auth("products.read"))))
                .andExpect(status().isForbidden());

        UUID skuId = UUID.randomUUID();
        when(service.summarize(any(), any(), any(), any(), any()))
                .thenReturn(new ProductSalesReportResult(
                        List.of(new ProductSalesReportItem(
                                skuId, "SKU-A", "Product A", "Black",
                                2, 5,
                                Instant.parse("2026-08-01T01:00:00Z"),
                                Instant.parse("2026-08-02T01:00:00Z"))),
                        1, 5));

        mockMvc.perform(get("/api/v1/analytics/product-sales")
                        .with(authentication(auth("analytics.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalSkuCount").value(1))
                .andExpect(jsonPath("$.totalSalesQuantity").value(5))
                .andExpect(jsonPath("$.items[0].skuId")
                        .value(skuId.toString()))
                .andExpect(jsonPath("$.items[0].orderCount").value(2))
                .andExpect(jsonPath("$.items[0].revenue").doesNotExist())
                .andExpect(jsonPath("$.profit").doesNotExist());
        verify(service).summarize(any(), any(), any(), any(), any());
    }

    @Test
    void exportsOnlyWithAnalyticsReadAndPreservesTheOrderWindow()
            throws Exception {
        String body = """
                {
                  "keyword": "SKU-A",
                  "placedFrom": "2026-08-01T00:00:00Z",
                  "placedToExclusive": "2026-08-03T00:00:00Z"
                }
                """;
        String content = "\uFEFF库存SKU,SKU名称,规格,关联订单数,销售数量,"
                + "首次下单,最近下单\r\n";
        when(service.exportCsv(any(), any(), any(), any()))
                .thenReturn(new ProductSalesReportService.ProductSalesReportExport(
                        "product-sales-report.csv",
                        "text/csv;charset=utf-8", 0, content));

        mockMvc.perform(post("/api/v1/analytics/product-sales/exports")
                        .contentType(APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/analytics/product-sales/exports")
                        .contentType(APPLICATION_JSON).content(body)
                        .with(authentication(auth("products.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/analytics/product-sales/exports")
                        .contentType(APPLICATION_JSON).content(body)
                        .with(authentication(auth("analytics.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename")
                        .value("product-sales-report.csv"))
                .andExpect(jsonPath("$.rowCount").value(0))
                .andExpect(jsonPath("$.content").value(content));
        verify(service).exportCsv(
                any(), eq("SKU-A"),
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
        ProductSalesReportService service() {
            return mock(ProductSalesReportService.class);
        }

        @Bean
        ProductSalesReportController controller(
                ProductSalesReportService service) {
            return new ProductSalesReportController(service);
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
