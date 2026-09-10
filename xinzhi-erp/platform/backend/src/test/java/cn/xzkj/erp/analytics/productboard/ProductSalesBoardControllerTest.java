package cn.xzkj.erp.analytics.productboard;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
@ContextConfiguration(classes = ProductSalesBoardControllerTest.WebConfiguration.class)
class ProductSalesBoardControllerTest {
    private static final Instant OBSERVED_AT =
            Instant.parse("2026-08-08T00:00:00Z");

    @Autowired private WebApplicationContext context;
    @Autowired private ProductSalesBoardService service;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        reset(service);
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @Test
    void requiresBothReadAuthorities() throws Exception {
        String url = "/api/v1/analytics/dashboard-product-sales"
                + "?observedAt=" + OBSERVED_AT;

        mockMvc.perform(get(url)).andExpect(status().isUnauthorized());
        mockMvc.perform(get(url).with(authentication(auth("analytics.read"))))
                .andExpect(status().isForbidden());
        mockMvc.perform(get(url).with(authentication(auth("products.read"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void returnsFixedSevenDayBoardWithoutMoneyFields() throws Exception {
        UUID hotSkuId = UUID.randomUUID();
        UUID zeroSkuId = UUID.randomUUID();
        when(service.summarize(any(), eq(OBSERVED_AT), eq(5)))
                .thenReturn(new ProductSalesBoardResult(
                        List.of(new ProductSalesBoardItem(
                                hotSkuId, "SKU-HOT", "Hot product", "Black",
                                2, 5, Instant.parse("2026-08-07T01:00:00Z"))),
                        List.of(new ProductSalesBoardItem(
                                zeroSkuId, "SKU-ZERO", "Zero product", null,
                                0, 0, null)),
                        2, 1, 5));

        mockMvc.perform(get("/api/v1/analytics/dashboard-product-sales")
                        .param("observedAt", OBSERVED_AT.toString())
                        .with(authentication(auth(
                                "analytics.read", "products.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rangeFrom")
                        .value("2026-08-01T00:00:00Z"))
                .andExpect(jsonPath("$.observedAt")
                        .value("2026-08-08T00:00:00Z"))
                .andExpect(jsonPath("$.activeSkuCount").value(2))
                .andExpect(jsonPath("$.soldSkuCount").value(1))
                .andExpect(jsonPath("$.salesQuantity").value(5))
                .andExpect(jsonPath("$.hotItems[0].skuId")
                        .value(hotSkuId.toString()))
                .andExpect(jsonPath("$.lowItems[0].skuId")
                        .value(zeroSkuId.toString()))
                .andExpect(jsonPath("$.lowItems[0].lastPlacedAt").isEmpty())
                .andExpect(jsonPath("$.revenue").doesNotExist())
                .andExpect(jsonPath("$.profit").doesNotExist());
        verify(service).summarize(any(), eq(OBSERVED_AT), eq(5));
    }

    private static TestingAuthenticationToken auth(String... authorities) {
        return new TestingAuthenticationToken(
                new ErpPrincipal(
                        UUID.randomUUID(), Instant.parse("2099-01-01T00:00:00Z"),
                        UUID.randomUUID(), "tenant", "Tenant", UUID.randomUUID(),
                        "tester", "Tester"),
                "not-used", authorities);
    }

    @Configuration
    @EnableWebMvc
    @EnableWebSecurity
    @EnableMethodSecurity
    static class WebConfiguration {
        @Bean
        ProductSalesBoardService service() {
            return mock(ProductSalesBoardService.class);
        }

        @Bean
        ProductSalesBoardController controller(
                ProductSalesBoardService service) {
            return new ProductSalesBoardController(service);
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
