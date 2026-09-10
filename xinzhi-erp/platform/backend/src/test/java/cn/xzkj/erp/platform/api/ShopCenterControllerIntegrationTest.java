package cn.xzkj.erp.platform.api;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.test.context.web.WebAppConfiguration;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import cn.xzkj.erp.config.SecurityConfig;
import cn.xzkj.erp.customer.service.CustomerServiceWorkloadAuthenticationFilter;
import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.security.BearerTokenAuthenticationFilter;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.iam.security.TenantContextFilter;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ChannelSnapshot;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.Connection;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectorMode;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyAuthorizationStart;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.settings.alias.ShopAliasService;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.platform.service.ShopCenterActor;
import cn.xzkj.erp.platform.service.ShopCenterService;
import cn.xzkj.erp.platform.service.ShopCenterService.ShopWithAuthorization;
import cn.xzkj.erp.platform.service.ShopChannelService;
import cn.xzkj.erp.platform.service.ShopifyLocationMappingService;
import cn.xzkj.erp.platform.service.ShopifyLocationMappingService.LocationMappingCatalog;
import cn.xzkj.erp.platform.domain.AuthorizationStatus;
import cn.xzkj.erp.platform.domain.PlatformCatalogEntry;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.domain.ShopAuthorization;
import cn.xzkj.erp.platform.domain.TenantShop;

@SpringJUnitConfig
@WebAppConfiguration
@ContextConfiguration(classes = {
        SecurityConfig.class,
        ShopCenterControllerIntegrationTest.WebConfiguration.class
})
class ShopCenterControllerIntegrationTest {

    @Autowired
    private WebApplicationContext webApplicationContext;
    @Autowired
    private ShopCenterService service;
    @Autowired
    private ShopAliasService aliasService;
    @Autowired
    private ShopChannelService channelService;
    @Autowired
    private ShopifyLocationMappingService locationMappingService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUpMockMvc() {
        clearInvocations(service, aliasService, channelService, locationMappingService);
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(springSecurity())
                .build();
    }

    @Test
    void securityFilterChainRejectsUnauthenticatedRequests() throws Exception {
        mockMvc.perform(get("/api/v1/platform-center/shops"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("authentication_required"));

        verify(service, never()).listShops(any(), anyBoolean(), any());
    }

    @Test
    void methodSecurityRejectsAuthenticatedCallerWithoutRequiredAuthority() throws Exception {
        mockMvc.perform(get("/api/v1/platform-center/shops")
                        .with(authentication(tenantAuthentication(UUID.randomUUID(), "platform:read"))))
                .andExpect(status().isForbidden());

        verify(service, never()).listShops(any(), anyBoolean(), any());
    }

    @Test
    void platformDirectoryExposesStablePaginationForCompleteClientLoading()
            throws Exception {
        UUID platformId = UUID.randomUUID();
        PlatformCatalogEntry platform = new PlatformCatalogEntry(
                "SHOPIFY", "Shopify", null);
        ReflectionTestUtils.setField(platform, "id", platformId);
        when(service.listPlatforms(eq(false), eq(PageRequest.of(1, 200))))
                .thenReturn(new PageImpl<>(
                        List.of(platform), PageRequest.of(1, 200), 201));

        mockMvc.perform(get("/api/v1/platform-center/platforms")
                        .param("page", "1")
                        .param("size", "200")
                        .with(authentication(tenantAuthentication(
                                UUID.randomUUID(), "platform:read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id")
                        .value(platformId.toString()))
                .andExpect(jsonPath("$.page").value(1))
                .andExpect(jsonPath("$.size").value(200))
                .andExpect(jsonPath("$.totalElements").value(201))
                .andExpect(jsonPath("$.totalPages").value(2));

        verify(service).listPlatforms(
                eq(false), eq(PageRequest.of(1, 200)));
    }

    @Test
    void customerServicePermissionReadsCanonicalShopsAndChannelStatus() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        when(service.listShops(eq(tenantId), eq(false), any()))
                .thenReturn(Page.empty(PageRequest.of(0, 50)));

        mockMvc.perform(get("/api/v1/platform-center/shops")
                        .with(authentication(tenantAuthentication(
                                tenantId, "customer_service.read"))))
                .andExpect(status().isOk());
        mockMvc.perform(get(
                        "/api/v1/platform-center/shops/{shopId}/channels",
                        shopId)
                        .with(authentication(tenantAuthentication(
                                tenantId, "customer_service.read"))))
                .andExpect(status().isOk());

        verify(service).listShops(eq(tenantId), eq(false), any());
        verify(channelService).get(any(), eq(shopId));
    }

    @Test
    void locationMappingsRequireBothShopAndWarehouseReadAuthorities()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        String path = "/api/v1/platform-center/shops/{shopId}/channels/"
                + "shopify/location-mappings";

        mockMvc.perform(get(path, shopId)
                        .with(authentication(tenantAuthentication(
                                tenantId, "shop:read"))))
                .andExpect(status().isForbidden());
        verify(locationMappingService, never()).list(any(), eq(shopId));

        when(locationMappingService.list(any(), eq(shopId))).thenReturn(
                new LocationMappingCatalog(List.of(), List.of()));
        mockMvc.perform(get(path, shopId)
                        .with(authentication(tenantAuthentication(
                                tenantId, "shop:read", "warehouses.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.locations").isArray())
                .andExpect(jsonPath("$.warehouses").isArray());
        verify(locationMappingService).list(any(), eq(shopId));
    }

    @Test
    void methodSecurityRejectsShopUpdatesWithoutWriteAuthority() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();

        mockMvc.perform(put("/api/v1/platform-center/shops/{shopId}", shopId)
                        .with(authentication(tenantAuthentication(tenantId, "shop:read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "version": 0,
                                  "externalShopRef": "safe-shop",
                                  "displayName": "Safe shop",
                                  "status": "ACTIVE"
                                }
                                """))
                .andExpect(status().isForbidden());

        verify(service, never()).updateShop(
                any(), any(), anyLong(), any(), any(), any());
    }

    @Test
    void methodSecurityRejectsChannelWritesWithoutAuthorizationAuthority() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();

        mockMvc.perform(post("/api/v1/platform-center/shops/{shopId}/channels/shopify/authorize", shopId)
                        .with(authentication(tenantAuthentication(tenantId, "shop:read"))))
                .andExpect(status().isForbidden());

        verify(channelService, never()).authorizeShopify(any(), any());
    }

    @Test
    void startsShopifyAuthorizationWithoutReturningCredentials()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        String authorizationUrl =
                "https://connector.example/shopify/oauth/authorize?grant="
                        + "A".repeat(43);
        when(channelService.authorizeShopify(any(), eq(shopId)))
                .thenReturn(new ShopifyAuthorizationStart(
                        new ChannelSnapshot(
                                ConnectorMode.XZ_ERP_APP,
                                new Connection(
                                        ConnectionStatus.PENDING,
                                        null,
                                        null,
                                        Instant.parse(
                                                "2026-08-02T00:00:00Z")),
                                List.of(),
                                List.of()),
                        authorizationUrl));

        mockMvc.perform(post(
                        "/api/v1/platform-center/shops/{shopId}/channels/shopify/authorize",
                        shopId)
                        .with(authentication(tenantAuthentication(
                                tenantId,
                                "shop:authorization:write"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.snapshot.mode")
                        .value("XZ_ERP_APP"))
                .andExpect(jsonPath("$.snapshot.shopify.status")
                        .value("PENDING"))
                .andExpect(jsonPath("$.authorizationUrl")
                        .value(authorizationUrl))
                .andExpect(content().string(not(containsString(
                        "accessToken"))))
                .andExpect(content().string(not(containsString(
                        "credential"))));
    }

    @Test
    void methodSecurityRequiresListingReadForShopifyCatalogRead() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();

        mockMvc.perform(get(
                        "/api/v1/platform-center/shops/{shopId}/channels/shopify/product-catalog",
                        shopId)
                        .with(authentication(tenantAuthentication(
                                tenantId, "products.read"))))
                .andExpect(status().isForbidden());

        mockMvc.perform(get(
                        "/api/v1/platform-center/shops/{shopId}/channels/shopify/product-catalog",
                        shopId)
                        .queryParam("limit", "25")
                        .queryParam("query", "status:active")
                        .with(authentication(tenantAuthentication(
                                tenantId, "products.listing.read"))))
                .andExpect(status().isOk());

        verify(channelService).fetchShopifyProductCatalog(
                any(), eq(shopId), eq(25), eq(null), eq("status:active"));
    }

    @Test
    void methodSecurityRequiresOrderReadForShopifyOrderCatalogRead() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();

        mockMvc.perform(get(
                        "/api/v1/platform-center/shops/{shopId}/channels/shopify/order-catalog",
                        shopId)
                        .with(authentication(tenantAuthentication(
                                tenantId, "products.listing.read"))))
                .andExpect(status().isForbidden());

        mockMvc.perform(get(
                        "/api/v1/platform-center/shops/{shopId}/channels/shopify/order-catalog",
                        shopId)
                        .queryParam("limit", "25")
                        .queryParam("query", "created_at:>=2026-07-01")
                        .with(authentication(tenantAuthentication(
                                tenantId, "orders.read"))))
                .andExpect(status().isOk());

        verify(channelService).fetchShopifyOrderCatalog(
                any(), eq(shopId), eq(25), eq(null),
                eq("created_at:>=2026-07-01"));
    }

    @Test
    void rejectsInvalidShopUpdateBeforeCallingTheService() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();

        mockMvc.perform(put("/api/v1/platform-center/shops/{shopId}", shopId)
                        .with(authentication(tenantAuthentication(tenantId, "shop:write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "version": -1,
                                  "externalShopRef": "",
                                  "displayName": "",
                                  "status": "ACTIVE"
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"))
                .andExpect(jsonPath("$.details.version").value("invalid"))
                .andExpect(jsonPath("$.details.externalShopRef").value("invalid"))
                .andExpect(jsonPath("$.details.displayName").value("invalid"));

        verify(service, never()).updateShop(
                any(), any(), anyLong(), any(), any(), any());
    }

    @Test
    void ignoresForgedTenantHeaderAndReturns404ForAnotherTenantsShop() throws Exception {
        UUID authenticatedTenantId = UUID.randomUUID();
        UUID forgedTenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        when(service.getShop(authenticatedTenantId, shopId))
                .thenThrow(new ResourceNotFoundException("credential://tenant/private-token"));

        mockMvc.perform(get("/api/v1/platform-center/shops/{shopId}", shopId)
                        .header("X-Tenant-Id", forgedTenantId)
                        .with(authentication(tenantAuthentication(authenticatedTenantId, "shop:read"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"))
                .andExpect(jsonPath("$.message").value("Requested resource was not found"))
                .andExpect(jsonPath("$.details").isMap())
                .andExpect(jsonPath("$.details").isEmpty())
                .andExpect(content().string(not(containsString("private-token"))));

        verify(service).getShop(authenticatedTenantId, shopId);
        verify(service, never()).getShop(forgedTenantId, shopId);
    }

    @Test
    void rejectsPlaintextCredentialBeforeCallingService() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();

        mockMvc.perform(put("/api/v1/platform-center/shops/{shopId}/authorization", shopId)
                        .with(authentication(tenantAuthentication(tenantId, "shop:authorization:write")))
                        .contentType("application/json")
                        .content("""
                                {
                                  "status": "AUTHORIZED",
                                  "credentialReference": "plaintext-secret"
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("validation_failed"))
                .andExpect(jsonPath("$.message").value("Request validation failed"))
                .andExpect(jsonPath("$.details.credentialReference").value("invalid"))
                .andExpect(jsonPath("$.details").isMap())
                .andExpect(content().string(not(containsString("plaintext-secret"))));

        verify(service, never()).updateAuthorization(
                any(), any(), any(), any(), any(), any(), any(), any(), any(), any()
        );
    }

    @Test
    void returnsSafeInvalidRequestForMalformedJson() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();

        mockMvc.perform(put("/api/v1/platform-center/shops/{shopId}/authorization", shopId)
                        .with(authentication(tenantAuthentication(tenantId, "shop:authorization:write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":"))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("invalid_request"))
                .andExpect(jsonPath("$.message").value("Request body is invalid"))
                .andExpect(jsonPath("$.details").isMap())
                .andExpect(jsonPath("$.details").isEmpty());

        verify(service, never()).updateAuthorization(
                any(), any(), any(), any(), any(), any(), any(), any(), any(), any()
        );
    }

    @Test
    void returnsSafeConflictWithoutExposingServiceDetails() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        when(service.createSyncJob(
                any(ShopCenterActor.class), eq(shopId), any()))
                .thenThrow(new ConflictException("credential://tenant/private-token"));

        mockMvc.perform(post("/api/v1/platform-center/shops/{shopId}/sync-jobs", shopId)
                        .with(authentication(tenantAuthentication(tenantId, "shop:sync:write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"jobType\":\"ORDERS\"}"))
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("resource_conflict"))
                .andExpect(jsonPath("$.message").value("The request conflicts with the current resource state"))
                .andExpect(jsonPath("$.details").isMap())
                .andExpect(jsonPath("$.details").isEmpty())
                .andExpect(content().string(not(containsString("private-token"))));
    }

    @Test
    void returnsStableDefaultPageEnvelopeForShops() throws Exception {
        UUID tenantId = UUID.randomUUID();
        when(service.listShops(eq(tenantId), eq(false), any()))
                .thenReturn(Page.empty(PageRequest.of(0, 50)));

        mockMvc.perform(get("/api/v1/platform-center/shops")
                        .with(authentication(tenantAuthentication(tenantId, "shop:read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(50))
                .andExpect(jsonPath("$.totalElements").value(0))
                .andExpect(jsonPath("$.totalPages").value(0));
    }

    @Test
    void exposesLocalizedAliasWithoutReplacingTheCanonicalShopName() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        UUID platformId = UUID.randomUUID();
        TenantShop shop = new TenantShop(tenantId, platformId,
                "shop-ref", "Canonical Shop");
        ReflectionTestUtils.setField(shop, "id", shopId);
        ShopAuthorization authorization = new ShopAuthorization(tenantId, shopId);
        when(service.listShops(eq(tenantId), eq(false), any())).thenReturn(
                new PageImpl<>(List.of(new ShopWithAuthorization(shop, authorization)),
                        PageRequest.of(0, 50), 1));
        when(aliasService.localizedNames(eq(tenantId), any(), eq("zh-CN")))
                .thenReturn(Map.of(shopId, "中文测试店"));

        mockMvc.perform(get("/api/v1/platform-center/shops")
                        .header("Accept-Language", "zh-CN")
                        .with(authentication(tenantAuthentication(tenantId, "shop:read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].displayName").value("Canonical Shop"))
                .andExpect(jsonPath("$.items[0].localizedDisplayName").value("中文测试店"));
    }

    @Test
    void passesValidatedFiltersOnlyWithTheAuthenticatedTenant() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID forgedTenantId = UUID.randomUUID();
        UUID platformId = UUID.randomUUID();
        when(service.listShops(
                eq(tenantId),
                eq(false),
                eq("Mixed Case"),
                eq(platformId),
                eq(ShopStatus.ACTIVE),
                eq(AuthorizationStatus.AUTHORIZED),
                any()
        )).thenReturn(Page.empty(PageRequest.of(1, 25)));

        mockMvc.perform(get("/api/v1/platform-center/shops")
                        .param("query", "  Mixed Case  ")
                        .param("platformId", platformId.toString())
                        .param("status", "ACTIVE")
                        .param("authorizationStatus", "AUTHORIZED")
                        .param("page", "1")
                        .param("size", "25")
                        .param("tenantId", forgedTenantId.toString())
                        .header("X-Tenant-Id", forgedTenantId)
                        .with(authentication(tenantAuthentication(tenantId, "shop:read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));

        verify(service).listShops(
                eq(tenantId),
                eq(false),
                eq("Mixed Case"),
                eq(platformId),
                eq(ShopStatus.ACTIVE),
                eq(AuthorizationStatus.AUTHORIZED),
                any()
        );
        verify(service, never()).listShops(
                eq(forgedTenantId),
                anyBoolean(),
                any(), any(), any(), any(), any()
        );
    }

    @Test
    void rejectsBlankOversizedAndInvalidFiltersWithoutCallingTheService() throws Exception {
        UUID tenantId = UUID.randomUUID();
        String oversized = "x".repeat(101);

        mockMvc.perform(get("/api/v1/platform-center/shops")
                        .param("query", "   ")
                        .with(authentication(tenantAuthentication(tenantId, "shop:read"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_request"));
        mockMvc.perform(get("/api/v1/platform-center/shops")
                        .param("query", oversized)
                        .with(authentication(tenantAuthentication(tenantId, "shop:read"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_request"));
        mockMvc.perform(get("/api/v1/platform-center/shops")
                        .param("platformId", "not-a-uuid")
                        .with(authentication(tenantAuthentication(tenantId, "shop:read"))))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/v1/platform-center/shops")
                        .param("status", "UNKNOWN")
                        .with(authentication(tenantAuthentication(tenantId, "shop:read"))))
                .andExpect(status().isBadRequest());

        verify(service, never()).listShops(
                eq(tenantId),
                anyBoolean(),
                any(), any(), any(), any(), any()
        );
    }

    @Test
    void requiresAndReturnsPageEnvelopeForSyncJobs() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        when(service.listSyncJobs(eq(tenantId), eq(shopId), any()))
                .thenReturn(Page.empty(PageRequest.of(1, 200)));

        mockMvc.perform(get("/api/v1/platform-center/shops/{shopId}/sync-jobs", shopId)
                        .param("page", "1")
                        .param("size", "200")
                        .with(authentication(tenantAuthentication(tenantId, "shop:sync:read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(1))
                .andExpect(jsonPath("$.size").value(200));
    }

    @Test
    void rejectsPageSizesAboveTheStableMaximum() throws Exception {
        mockMvc.perform(get("/api/v1/platform-center/shops")
                        .param("size", "201")
                        .with(authentication(tenantAuthentication(UUID.randomUUID(), "shop:read"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_request"))
                .andExpect(jsonPath("$.message").value("The request is invalid"))
                .andExpect(jsonPath("$.details").isEmpty());

        verify(service, never()).listShops(any(), anyBoolean(), any());
    }

    private static TestingAuthenticationToken tenantAuthentication(
            UUID tenantId,
            String... authorities) {
        return new TestingAuthenticationToken(
                new ErpPrincipal(
                        UUID.randomUUID(),
                        Instant.parse("2099-01-01T00:00:00Z"),
                        tenantId,
                        "test",
                        "Test Tenant",
                        UUID.randomUUID(),
                        "tester",
                        "Tester"),
                "not-used",
                authorities);
    }

    @Configuration
    @EnableWebMvc
    @EnableWebSecurity
    static class WebConfiguration {

        @Bean
        ShopCenterService shopCenterService() {
            return mock(ShopCenterService.class);
        }

        @Bean
        ShopAliasService shopAliasService() {
            return mock(ShopAliasService.class);
        }

        @Bean
        ShopCenterController shopCenterController(ShopCenterService service,
                ShopAliasService aliasService) {
            return new ShopCenterController(service, aliasService);
        }

        @Bean
        ShopChannelService shopChannelService() {
            return mock(ShopChannelService.class);
        }

        @Bean
        ShopifyLocationMappingService shopifyLocationMappingService() {
            return mock(ShopifyLocationMappingService.class);
        }

        @Bean
        ShopChannelController shopChannelController(
                ShopChannelService service,
                ShopifyLocationMappingService locationMappingService) {
            return new ShopChannelController(service, locationMappingService);
        }

        @Bean
        ApiExceptionHandler apiExceptionHandler() {
            return new ApiExceptionHandler();
        }

        @Bean
        AuthSessionRepository authSessionRepository() {
            return mock(AuthSessionRepository.class);
        }

        @Bean
        PermissionRepository permissionRepository() {
            return mock(PermissionRepository.class);
        }

        @Bean
        SessionTokenService sessionTokenService() {
            return mock(SessionTokenService.class);
        }

        @Bean
        CustomerServiceWorkloadAuthenticationFilter customerServiceWorkloadAuthenticationFilter() {
            return new CustomerServiceWorkloadAuthenticationFilter("");
        }

        @Bean
        BearerTokenAuthenticationFilter bearerTokenAuthenticationFilter(
                AuthSessionRepository sessionRepository,
                PermissionRepository permissionRepository,
                SessionTokenService tokenService,
                java.time.Clock clock
        ) {
            return new BearerTokenAuthenticationFilter(
                    sessionRepository,
                    permissionRepository,
                    tokenService,
                    clock
            );
        }

        @Bean
        TenantContextFilter tenantContextFilter() {
            return new TenantContextFilter();
        }
    }
}
