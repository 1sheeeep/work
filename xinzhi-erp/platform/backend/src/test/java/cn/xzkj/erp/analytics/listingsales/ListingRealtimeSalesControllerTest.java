package cn.xzkj.erp.analytics.listingsales;

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
@ContextConfiguration(classes = ListingRealtimeSalesControllerTest.WebConfiguration.class)
class ListingRealtimeSalesControllerTest {
    @Autowired private WebApplicationContext context;
    @Autowired private ListingRealtimeSalesService service;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        reset(service);
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @Test
    void requiresAnalyticsReadAndReturnsOnlyAttributedListingFacts()
            throws Exception {
        mockMvc.perform(get("/api/v1/analytics/listing-sales")
                        .queryParam("asOf", "2026-08-10T12:00:00Z"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/analytics/listing-sales")
                        .queryParam("asOf", "2026-08-10T12:00:00Z")
                        .with(authentication(auth("products.read"))))
                .andExpect(status().isForbidden());

        UUID listingId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        when(service.summarize(any(), any(), any(), any(), any()))
                .thenReturn(new ListingRealtimeSalesResult(
                        List.of(new ListingRealtimeSalesItem(
                                listingId, "SHOPIFY", "Shopify", shopId,
                                "Demo Shop", "item-1", "variant-1", skuId,
                                "SKU-A", "Product A", "Black",
                                5, 2, 2, 1, 5, 5, 5,
                                Instant.parse("2026-08-10T10:00:00Z"))),
                        1, 5));

        mockMvc.perform(get("/api/v1/analytics/listing-sales")
                        .queryParam("asOf", "2026-08-10T12:00:00Z")
                        .with(authentication(auth("analytics.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalListingCount").value(1))
                .andExpect(jsonPath("$.totalRangeSalesQuantity").value(5))
                .andExpect(jsonPath("$.items[0].listingId")
                        .value(listingId.toString()))
                .andExpect(jsonPath("$.items[0].platformCode")
                        .value("SHOPIFY"))
                .andExpect(jsonPath("$.items[0].rangeOrderCount").value(2))
                .andExpect(jsonPath("$.items[0].salesAmount").doesNotExist())
                .andExpect(jsonPath("$.items[0].latestPrice").doesNotExist());
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
        String content = "\uFEFF平台编码,平台名称,店铺,Listing,Listing变体,"
                + "库存SKU,SKU名称,规格,所选区间销量,所选区间订单数,今日销量,"
                + "昨日销量,近7天销量,近28天销量,近42天销量,最近下单,统计截至\r\n";
        when(service.exportCsv(any(), any(), any(), any()))
                .thenReturn(new ListingRealtimeSalesService
                        .ListingRealtimeSalesExport(
                                "listing-realtime-sales.csv",
                                "text/csv;charset=utf-8", 0, content));

        mockMvc.perform(post("/api/v1/analytics/listing-sales/exports")
                        .contentType(APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/analytics/listing-sales/exports")
                        .contentType(APPLICATION_JSON).content(body)
                        .with(authentication(auth("products.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/analytics/listing-sales/exports")
                        .contentType(APPLICATION_JSON).content(body)
                        .with(authentication(auth("analytics.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename")
                        .value("listing-realtime-sales.csv"))
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
        ListingRealtimeSalesService service() {
            return mock(ListingRealtimeSalesService.class);
        }

        @Bean
        ListingRealtimeSalesController controller(
                ListingRealtimeSalesService service) {
            return new ListingRealtimeSalesController(service);
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
