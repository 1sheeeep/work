package cn.xzkj.erp.analytics.storehealth;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.ApiExceptionHandler;
import cn.xzkj.erp.platform.domain.AuthorizationStatus;
import cn.xzkj.erp.platform.domain.PlatformCatalogEntry;
import cn.xzkj.erp.platform.domain.ShopAuthorization;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.domain.ShopSyncJob;
import cn.xzkj.erp.platform.domain.SyncJobStatus;
import cn.xzkj.erp.platform.domain.SyncJobType;
import cn.xzkj.erp.platform.domain.TenantShop;
import cn.xzkj.erp.platform.service.ShopCenterService;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
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
@ContextConfiguration(classes = StoreHealthControllerTest.WebConfiguration.class)
class StoreHealthControllerTest {
    @Autowired private WebApplicationContext context;
    @Autowired private ShopCenterService shopCenterService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        reset(shopCenterService);
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @Test
    void requiresAnalyticsReadAndReturnsOnlySafeOperationalHealth()
            throws Exception {
        mockMvc.perform(get("/api/v1/analytics/store-health"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/analytics/store-health")
                        .with(authentication(auth("orders.read"))))
                .andExpect(status().isForbidden());

        UUID platformId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        PlatformCatalogEntry platform = mock(PlatformCatalogEntry.class);
        when(platform.getId()).thenReturn(platformId);
        when(platform.getCode()).thenReturn("SHOPIFY");
        when(platform.getDisplayName()).thenReturn("Shopify");
        TenantShop shop = mock(TenantShop.class);
        when(shop.getId()).thenReturn(shopId);
        when(shop.getPlatformId()).thenReturn(platformId);
        when(shop.getExternalShopRef()).thenReturn("demo.myshopify.com");
        when(shop.getDisplayName()).thenReturn("演示店铺");
        when(shop.getStatus()).thenReturn(ShopStatus.ACTIVE);
        when(shop.getUpdatedAt()).thenReturn(Instant.parse("2026-08-10T16:00:00Z"));
        ShopAuthorization authorization = mock(ShopAuthorization.class);
        when(authorization.getStatus()).thenReturn(AuthorizationStatus.AUTHORIZED);
        when(authorization.getScopeSummary()).thenReturn("read_orders,read_products");
        when(authorization.getLastVerifiedAt()).thenReturn(Instant.parse("2026-08-10T15:00:00Z"));
        ShopSyncJob job = mock(ShopSyncJob.class);
        when(job.getJobType()).thenReturn(SyncJobType.ORDERS);
        when(job.getStatus()).thenReturn(SyncJobStatus.SUCCEEDED);
        when(job.getProgressProcessed()).thenReturn(2);
        when(job.getProgressTotal()).thenReturn(2);
        when(job.getAttemptCount()).thenReturn(1);
        when(job.getRequestedAt()).thenReturn(Instant.parse("2026-08-10T14:00:00Z"));
        when(job.getCompletedAt()).thenReturn(Instant.parse("2026-08-10T14:01:00Z"));

        when(shopCenterService.listPlatforms(eq(false), any()))
                .thenReturn(new PageImpl<>(List.of(platform), PageRequest.of(0, 200), 1));
        when(shopCenterService.listShops(any(), eq(false), any(), any(), any(), any(), any()))
                .thenReturn(new PageImpl<>(List.of(
                        new ShopCenterService.ShopWithAuthorization(shop, authorization)),
                        PageRequest.of(0, 25), 1));
        when(shopCenterService.listSyncJobs(any(), eq(shopId), any()))
                .thenReturn(new PageImpl<>(List.of(job), PageRequest.of(0, 1), 1));

        mockMvc.perform(get("/api/v1/analytics/store-health")
                        .param("platform", "SHOPIFY")
                        .with(authentication(auth("analytics.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.platforms[0].code").value("SHOPIFY"))
                .andExpect(jsonPath("$.items[0].shopName").value("演示店铺"))
                .andExpect(jsonPath("$.items[0].authorizationStatus").value("AUTHORIZED"))
                .andExpect(jsonPath("$.items[0].scopes[0]").value("read_orders"))
                .andExpect(jsonPath("$.items[0].latestSync.status").value("SUCCEEDED"))
                .andExpect(jsonPath("$.items[0].credentialReference").doesNotExist())
                .andExpect(jsonPath("$.items[0].revenue").doesNotExist());
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
        ShopCenterService shopCenterService() {
            return mock(ShopCenterService.class);
        }

        @Bean
        StoreHealthController controller(ShopCenterService service) {
            return new StoreHealthController(service);
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
