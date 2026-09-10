package cn.xzkj.erp.platform.api;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import cn.xzkj.erp.config.SecurityConfig;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.connector.ConnectorUnavailableException;
import cn.xzkj.erp.platform.service.NativeShopifyLinkService;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.test.context.web.WebAppConfiguration;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

@SpringJUnitConfig
@WebAppConfiguration
@ContextConfiguration(classes = { SecurityConfig.class,
        ShopCenterControllerIntegrationTest.WebConfiguration.class, NativeShopifyLinkControllerTest.Beans.class })
class NativeShopifyLinkControllerTest {
    @Autowired WebApplicationContext context;
    @Autowired NativeShopifyLinkService service;
    MockMvc mvc;
    final UUID tenant = UUID.randomUUID(), user = UUID.randomUUID(), shop = UUID.randomUUID();
    final String proof = "A".repeat(43), base = "/api/v1/platform-center/shopify/native-link/";
    final String body = "{\"proof\":\"" + proof + "\"}";
    @BeforeEach void setup() {
        reset(service);
        mvc = MockMvcBuilders.webAppContextSetup(context).apply(springSecurity()).build();
    }
    TestingAuthenticationToken auth(UUID systemAdmin, String... scopes) {
        return new TestingAuthenticationToken(new ErpPrincipal(UUID.randomUUID(), Instant.now().plusSeconds(600),
                tenant, "fixture", "Fixture", user, "fixture-user", "Fixture User", systemAdmin), "not-used", scopes);
    }
    @Test void requiresAuthenticationAndAuthorizationPermission() throws Exception {
        mvc.perform(post(base + "preview").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isUnauthorized());
        for (String action : new String[] { "preview", "prepare" }) {
            mvc.perform(post(base + action).with(authentication(auth(null, "shop:read")))
                    .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isForbidden());
        }
        mvc.perform(post("/api/v1/platform-center/shops/" + shop + "/channels/shopify/native-link/confirm")
                .with(authentication(auth(null, "shop:read"))).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }
    @Test void neverAcceptsSystemAdministratorImpersonation() throws Exception {
        mvc.perform(post(base + "prepare").with(authentication(auth(UUID.randomUUID(), "shop:authorization:write")))
                .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }
    @Test void derivesActorFromNativeSessionAndDoesNotEchoProof() throws Exception {
        when(service.prepare(any(), eq(proof))).thenReturn(new NativeShopifyLinkService.PreparedShop(shop, "fixture.myshopify.com", "Fixture"));
        mvc.perform(post(base + "prepare").with(authentication(auth(null, "shop:authorization:write")))
                .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isOk())
                .andExpect(jsonPath("$.shopId").value(shop.toString())).andExpect(jsonPath("$.proof").doesNotExist());
        verify(service).prepare(argThat(actor -> tenant.equals(actor.tenantId()) && user.equals(actor.userId())
                && actor.systemAdminId() == null), eq(proof));
    }
    @Test void rejectsMalformedProofQueriesAndCallerIdentities() throws Exception {
        for (String invalid : new String[] { "{}", "{\"proof\":\"bad\"}", "{\"proof\":\"" + "B".repeat(43) + "\"}",
                body.replace("}", ",\"tenantId\":\"" + tenant + "\"}"),
                body.replace("}", ",\"shopDomain\":\"attacker.myshopify.com\"}") }) {
            mvc.perform(post(base + "preview").with(authentication(auth(null, "shop:authorization:write")))
                    .contentType(MediaType.APPLICATION_JSON).content(invalid)).andExpect(status().isBadRequest());
        }
        mvc.perform(post(base + "prepare?tenantId=other").with(authentication(auth(null, "shop:authorization:write")))
                .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }
    @Test void returnsSafeConflictInsteadOfProviderError() throws Exception {
        when(service.preview(any(), eq(proof))).thenThrow(new ConnectorUnavailableException("NATIVE_LINK_UNAVAILABLE", false, "private-correlation"));
        mvc.perform(post(base + "preview").with(authentication(auth(null, "shop:authorization:write")))
                .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("native_link_unavailable"))
                .andExpect(jsonPath("$.details").isEmpty());
    }
    @Configuration static class Beans {
        @Bean NativeShopifyLinkService nativeShopifyLinkService() { return mock(NativeShopifyLinkService.class); }
        @Bean NativeShopifyLinkController nativeShopifyLinkController(NativeShopifyLinkService service) { return new NativeShopifyLinkController(service); }
    }
}
