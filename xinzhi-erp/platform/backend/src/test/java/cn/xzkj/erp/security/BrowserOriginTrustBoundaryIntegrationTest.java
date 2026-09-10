package cn.xzkj.erp.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.read.ListAppender;
import com.jayway.jsonpath.JsonPath;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@TestMethodOrder(OrderAnnotation.class)
class BrowserOriginTrustBoundaryIntegrationTest {

    private static final String HOSTILE_ORIGIN =
            "https://browser-origin-gate.invalid";
    private static final String FILE_ORIGIN =
            "file://browser-origin-gate.invalid/private";
    private static final String HOST_CANARY =
            "host.browser-origin-gate.invalid";
    private static final String FORWARDED_HOST_CANARY =
            "forwarded.browser-origin-gate.invalid";
    private static final String FORWARDED_SERVER_CANARY =
            "server.browser-origin-gate.invalid";
    private static final String FORWARDED_PREFIX_CANARY =
            "/internal/browser-origin-gate";
    private static final String REFERER_CANARY =
            "https://referer.browser-origin-gate.invalid/private?token=canary";
    private static final String REQUEST_ID =
            "browser-origin-gate-request";
    private static final String TENANT_CODE =
            "browser_origin_gate_tenant";
    private static final String TENANT_USERNAME =
            "browser_origin_gate_admin@example.test";
    private static final String TENANT_PASSWORD =
            "browser-origin-gate-tenant-password";
    private static final String SECOND_PLATFORM_USERNAME =
            "browser_origin_gate_system_admin@example.test";
    private static final String SECOND_PLATFORM_PASSWORD =
            "browser-origin-gate-system-password";
    private static final List<String> REQUEST_CANARIES =
            List.of(
                    HOSTILE_ORIGIN,
                    FILE_ORIGIN,
                    HOST_CANARY,
                    FORWARDED_HOST_CANARY,
                    FORWARDED_SERVER_CANARY,
                    FORWARDED_PREFIX_CANARY,
                    REFERER_CANARY,
                    REQUEST_ID);
    private static final PostgresqlApiFixture FIXTURE =
            new PostgresqlApiFixture();

    private static MockMvc mockMvc;
    private static String platformToken;
    private static String secondPlatformToken;
    private static String tenantToken;
    private static String tenantCredential;
    private static String platformCredential;
    private static String platformTenantToken;
    private static UUID tenantId;
    private static UUID platformId;
    private static UUID shopifyPlatformId;
    private static UUID shopId;
    private static UUID skuId;

    @BeforeAll
    static void start() throws Exception {
        FIXTURE.start();
        mockMvc = FIXTURE.mockMvcWithFrameworkForwardHeaders();
    }

    @AfterAll
    static void stop() {
        FIXTURE.close();
    }

    @Test
    @Order(1)
    void usesOwnedPostgresql16AndAStatelessFilterChainWithoutCorsOrCsrf()
            throws Exception {
        assertThat(FIXTURE.isRunning()).isTrue();
        assertThat(FIXTURE.imageName()).isEqualTo("postgres:16-alpine");
        assertThat(FIXTURE.singleString("SHOW server_version"))
                .startsWith("16.");

        List<String> filters = FIXTURE.securityFilterClassNames();
        assertThat(filters)
                .anyMatch(name -> name.endsWith(
                        "BearerTokenAuthenticationFilter"))
                .noneMatch(name -> name.endsWith("CsrfFilter"))
                .noneMatch(name -> name.endsWith("CorsFilter"));
    }

    @Test
    @Order(2)
    void hostilePreflightsNeverNegotiateCrossOriginAccess()
            throws Exception {
        List<PreflightCase> cases = List.of(
                new PreflightCase(
                        "/api/v1/platform-admin/auth/login",
                        "POST",
                        200),
                new PreflightCase(
                        "/api/v1/platform-admin/auth/password-credentials/redeem",
                        "POST",
                        200),
                new PreflightCase(
                        "/api/v1/auth/login",
                        "POST",
                        200),
                new PreflightCase(
                        "/api/v1/auth/password-credentials/redeem",
                        "POST",
                        200),
                new PreflightCase(
                        "/api/v1/platform-admin/tenants/"
                                + UUID.randomUUID()
                                + "/enter",
                        "POST",
                        401),
                new PreflightCase(
                        "/api/v1/platform-admin/tenant-session",
                        "DELETE",
                        401),
                new PreflightCase("/api/v1/iam/members", "POST", 401),
                new PreflightCase(
                        "/api/v1/product-center/spus",
                        "POST",
                        401),
                new PreflightCase(
                        "/api/v1/order-center/orders",
                        "POST",
                        401),
                new PreflightCase(
                        "/api/v1/warehouse-center/warehouses",
                        "POST",
                        401));

        for (PreflightCase testCase : cases) {
            MvcResult result = mockMvc.perform(hostile(options(testCase.path()))
                            .header(
                                    HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD,
                                    testCase.requestedMethod())
                            .header(
                                    HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS,
                                    "authorization, content-type"))
                    .andExpect(status().is(testCase.expectedStatus()))
                    .andReturn();
            assertBrowserBoundary(result);
        }
    }

    @Test
    @Order(3)
    void platformAndEnterpriseLoginAndCredentialExchangeRemainUnreadable()
            throws Exception {
        ListAppender<ILoggingEvent> logs = captureLogs();
        try {
            MvcResult failedPlatformLogin = mockMvc.perform(
                            hostile(
                                    post("/api/v1/platform-admin/auth/login"),
                                    "null")
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(loginBody(
                                            PostgresqlApiFixture
                                                    .SYSTEM_ADMIN_USERNAME,
                                            "wrong-password")))
                    .andExpect(status().isUnauthorized())
                    .andReturn();
            assertBrowserBoundary(failedPlatformLogin);

            MvcResult platformLogin = mockMvc.perform(
                            hostile(post(
                                    "/api/v1/platform-admin/auth/login"))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(loginBody(
                                            PostgresqlApiFixture
                                                    .SYSTEM_ADMIN_USERNAME,
                                            PostgresqlApiFixture
                                                    .SYSTEM_ADMIN_PASSWORD)))
                    .andExpect(status().isOk())
                    .andReturn();
            platformToken = accessToken(platformLogin);
            assertBrowserBoundary(
                    platformLogin,
                    platformToken,
                    PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD);

            MvcResult createdPlatformAdmin = mockMvc.perform(
                            authorized(hostile(post(
                                            "/api/v1/platform-admin/"
                                                    + "system-admins")),
                                    platformToken)
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("""
                                            {"email":"%s",
                                             "displayName":
                                               "Browser Origin Gate Admin"}
                                            """.formatted(
                                                SECOND_PLATFORM_USERNAME)))
                    .andExpect(status().isCreated())
                    .andReturn();
            platformCredential = JsonPath.read(
                    body(createdPlatformAdmin),
                    "$.activationCredential.token");
            assertBrowserBoundary(
                    createdPlatformAdmin,
                    platformCredential,
                    platformToken);

            MvcResult redeemedPlatformCredential = mockMvc.perform(
                            hostile(
                                    post("/api/v1/platform-admin/auth/"
                                            + "password-credentials/redeem"),
                                    FILE_ORIGIN)
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(credentialBody(
                                            platformCredential,
                                            SECOND_PLATFORM_PASSWORD)))
                    .andExpect(status().isNoContent())
                    .andReturn();
            assertBrowserBoundary(
                    redeemedPlatformCredential,
                    platformCredential,
                    SECOND_PLATFORM_PASSWORD);

            MvcResult secondPlatformLogin = mockMvc.perform(
                            hostile(post(
                                    "/api/v1/platform-admin/auth/login"))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(loginBody(
                                            SECOND_PLATFORM_USERNAME,
                                            SECOND_PLATFORM_PASSWORD)))
                    .andExpect(status().isOk())
                    .andReturn();
            secondPlatformToken = accessToken(secondPlatformLogin);
            assertBrowserBoundary(
                    secondPlatformLogin,
                    secondPlatformToken,
                    SECOND_PLATFORM_PASSWORD);

            MvcResult createdTenant = mockMvc.perform(
                            authorized(hostile(post(
                                            "/api/v1/platform-admin/tenants")),
                                    platformToken)
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("""
                                            {"code":"%s",
                                             "name":"Browser Origin Gate Tenant",
                                             "adminEmail":"%s",
                                             "adminDisplayName":
                                               "Browser Origin Gate Admin",
                                             "adminInitialPassword":"%s"}
                                             """.formatted(
                                                 TENANT_CODE,
                                                 TENANT_USERNAME,
                                                 TENANT_PASSWORD)))
                    .andExpect(status().isCreated())
                    .andReturn();
            tenantId = UUID.fromString(JsonPath.read(
                    body(createdTenant),
                    "$.tenant.id"));
            FIXTURE.enableErp(tenantId);
            tenantCredential = "direct-account-no-credential";
            assertBrowserBoundary(
                    createdTenant,
                    tenantCredential,
                    platformToken);

            MvcResult tenantLogin = mockMvc.perform(
                            hostile(
                                    post("/api/v1/auth/login"),
                                    FILE_ORIGIN)
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(tenantLoginBody()))
                    .andExpect(status().isOk())
                    .andReturn();
            tenantToken = accessToken(tenantLogin);
            assertBrowserBoundary(
                    tenantLogin,
                    tenantToken,
                    TENANT_PASSWORD);
            assertLogsSafe(
                    logs,
                    platformToken,
                    secondPlatformToken,
                    tenantToken,
                    platformCredential,
                    tenantCredential,
                    PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD,
                    SECOND_PLATFORM_PASSWORD,
                    TENANT_PASSWORD);
        } finally {
            stopCapturing(logs);
        }
    }

    @Test
    @Order(4)
    void ambientCookiesNeverAuthenticateAndSimpleBodiesFailClosed()
            throws Exception {
        String cookies = "JSESSIONID=browser-session; access_token="
                + tenantToken
                + "; Authorization=Bearer%20"
                + tenantToken;

        for (String path : List.of(
                "/api/v1/auth/me",
                "/api/v1/iam/members",
                "/api/v1/product-center/spus",
                "/api/v1/order-center/orders",
                "/api/v1/warehouse-center/warehouses",
                "/api/v1/suppliers")) {
            MvcResult cookieOnlyRead = mockMvc.perform(
                            hostile(get(path))
                                    .header(HttpHeaders.COOKIE, cookies))
                    .andExpect(status().isUnauthorized())
                    .andReturn();
            assertBrowserBoundary(cookieOnlyRead, tenantToken);
        }

        for (String path : List.of(
                "/api/v1/iam/members",
                "/api/v1/product-center/spus",
                "/api/v1/order-center/orders",
                "/api/v1/warehouse-center/warehouses")) {
            MvcResult cookieOnlyWrite = mockMvc.perform(
                            hostile(post(path))
                                    .header(HttpHeaders.COOKIE, cookies)
                                    .contentType(
                                            MediaType
                                                    .APPLICATION_FORM_URLENCODED)
                                    .content("canary=ambient-cookie"))
                    .andExpect(status().isUnauthorized())
                    .andReturn();
            assertBrowserBoundary(cookieOnlyWrite, tenantToken);
        }

        ListAppender<ILoggingEvent> logs = captureLogs();
        try {
            MvcResult platformSimpleLogin = mockMvc.perform(
                            hostile(post(
                                            "/api/v1/platform-admin/auth/login"))
                                    .contentType(
                                            MediaType
                                                    .APPLICATION_FORM_URLENCODED)
                                    .content(
                                            "username="
                                                    + PostgresqlApiFixture
                                                            .SYSTEM_ADMIN_USERNAME
                                                    + "&password="
                                                    + PostgresqlApiFixture
                                                            .SYSTEM_ADMIN_PASSWORD))
                    .andExpect(status().isUnsupportedMediaType())
                    .andReturn();
            assertThat(JsonPath.<Map<String, Object>>read(
                            body(platformSimpleLogin),
                            "$"))
                    .containsExactlyInAnyOrderEntriesOf(Map.of(
                            "code",
                            "invalid_request",
                            "message",
                            "Content type is not supported"));
            assertBrowserBoundary(
                    platformSimpleLogin,
                    PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD);
            assertLogsSafe(
                    logs,
                    PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD);
        } finally {
            stopCapturing(logs);
        }

        MvcResult enterpriseSimpleLogin = mockMvc.perform(
                        hostile(post("/api/v1/auth/login"))
                                .contentType(
                                        MediaType
                                                .APPLICATION_FORM_URLENCODED)
                                .content(
                                        "tenantCode="
                                                + TENANT_CODE
                                                + "&username="
                                                + TENANT_USERNAME
                                                + "&password="
                                                + TENANT_PASSWORD))
                .andExpect(status().isUnsupportedMediaType())
                .andReturn();
        assertBrowserBoundary(
                enterpriseSimpleLogin,
                TENANT_PASSWORD);
    }

    @Test
    @Order(5)
    void bearerWritesWithoutCsrfSucceedButNeverExposeCorsOrProxyCanaries()
            throws Exception {
        ListAppender<ILoggingEvent> logs = captureLogs();
        try {
            MvcResult entered = mockMvc.perform(
                            authorized(hostile(post(
                                            "/api/v1/platform-admin/tenants/"
                                                    + tenantId
                                                    + "/enter")),
                                    platformToken))
                    .andExpect(status().isOk())
                    .andReturn();
            platformTenantToken = accessToken(entered);
            assertBrowserBoundary(
                    entered,
                    platformTenantToken,
                    platformToken);

            List<String> reads = List.of(
                    "/api/v1/iam/members",
                    "/api/v1/product-center/spus",
                    "/api/v1/order-center/orders",
                    "/api/v1/warehouse-center/warehouses",
                    "/api/v1/suppliers");
            for (String path : reads) {
                MvcResult result = mockMvc.perform(
                                authorized(hostile(get(path)),
                                        platformTenantToken))
                        .andExpect(status().isOk())
                        .andReturn();
                assertBrowserBoundary(result, platformTenantToken);
            }

            MvcResult member = created(authorized(
                            hostile(post("/api/v1/iam/members")),
                            tenantToken)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                             {"email":"browser_origin_gate_member@example.test",
                              "displayName":"Browser Origin Gate Member",
                              "initialPassword":"browser-member-password",
                              "roleIds":[]}
                            """));
            assertBrowserBoundary(member, platformTenantToken);

            MvcResult platform = created(authorized(
                            hostile(post(
                                    "/api/v1/platform-center/platforms")),
                            platformTenantToken)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                            {"code":"BROWSER_ORIGIN_GATE",
                             "displayName":"Browser Origin Gate",
                             "description":null}
                            """));
            platformId = createdId(platform);
            assertBrowserBoundaryWithRelativeLocation(
                    platform,
                    platformTenantToken);
            shopifyPlatformId = UUID.fromString(FIXTURE.singleString("""
                    SELECT id::text
                    FROM platform_catalog
                    WHERE code = 'SHOPIFY'
                    """));

            MvcResult shop = created(authorized(
                            hostile(post("/api/v1/platform-center/shops")),
                            platformTenantToken)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                            {"platformId":"%s",
                             "externalShopRef":"browser-origin-gate-shop"}
                            """.formatted(shopifyPlatformId)));
            shopId = createdId(shop);
            assertBrowserBoundaryWithRelativeLocation(
                    shop,
                    platformTenantToken);

            MvcResult spu = created(authorized(
                            hostile(post("/api/v1/product-center/spus")),
                            platformTenantToken)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                            {"businessCode":"BROWSER_ORIGIN_GATE_SPU",
                             "name":"Browser Origin Gate Product",
                             "brandName":null,"productNote":null}
                            """));
            UUID spuId = createdId(spu);
            assertBrowserBoundaryWithRelativeLocation(
                    spu,
                    platformTenantToken);

            MvcResult sku = created(authorized(
                            hostile(post(
                                    "/api/v1/product-center/spus/"
                                            + spuId
                                            + "/skus")),
                            platformTenantToken)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                            {"businessCode":"BROWSER_ORIGIN_GATE_SKU",
                             "name":"Browser Origin Gate SKU",
                             "variantSummary":null}
                            """));
            skuId = createdId(sku);
            assertBrowserBoundaryWithRelativeLocation(
                    sku,
                    platformTenantToken);

            MvcResult order = created(authorized(
                            hostile(post("/api/v1/order-center/orders")),
                            platformTenantToken)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(orderBody()));
            assertBrowserBoundaryWithRelativeLocation(
                    order,
                    platformTenantToken);

            MvcResult warehouse = created(authorized(
                            hostile(post(
                                    "/api/v1/warehouse-center/warehouses")),
                            platformTenantToken)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                            {"businessCode":"BROWSER_ORIGIN_GATE_WH",
                             "name":"Browser Origin Gate Warehouse"}
                            """));
            assertBrowserBoundaryWithRelativeLocation(
                    warehouse,
                    platformTenantToken);

            assertThat(FIXTURE.singleLong("""
                    SELECT count(*) FROM users
                WHERE email = 'browser_origin_gate_member@example.test'
                    """)).isEqualTo(1);
            assertThat(FIXTURE.singleLong("""
                    SELECT count(*) FROM tenant_orders
                    WHERE external_order_ref = 'BROWSER-ORIGIN-GATE-ORDER'
                    """)).isEqualTo(1);

            MvcResult platformForbidden = mockMvc.perform(
                            authorized(hostile(get(
                                            "/api/v1/product-center/spus")),
                                    platformToken))
                    .andExpect(status().isForbidden())
                    .andReturn();
            assertBrowserBoundary(platformForbidden, platformToken);

            MvcResult tenantForbidden = mockMvc.perform(
                            authorized(hostile(get(
                                            "/api/v1/platform-admin/"
                                                    + "system-admins")),
                                    tenantToken))
                    .andExpect(status().isForbidden())
                    .andReturn();
            assertBrowserBoundary(tenantForbidden, tenantToken);

            assertLogsSafe(
                    logs,
                    platformToken,
                    platformTenantToken,
                    tenantToken,
                    PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD);
        } finally {
            stopCapturing(logs);
        }
    }

    @Test
    @Order(6)
    void tenantLeaveAndRevocationRemainCrossOriginUnreadable()
            throws Exception {
        MvcResult left = mockMvc.perform(
                        authorized(hostile(delete(
                                        "/api/v1/platform-admin/"
                                                + "tenant-session")),
                                platformTenantToken))
                .andExpect(status().isNoContent())
                .andReturn();
        assertBrowserBoundary(left, platformTenantToken);

        MvcResult revoked = mockMvc.perform(
                        authorized(hostile(get("/api/v1/auth/me")),
                                platformTenantToken))
                .andExpect(status().isUnauthorized())
                .andReturn();
        assertBrowserBoundary(revoked, platformTenantToken);

        MvcResult platformSessionStillValid = mockMvc.perform(
                        authorized(hostile(get(
                                        "/api/v1/platform-admin/auth/me")),
                                platformToken))
                .andExpect(status().isOk())
                .andReturn();
        assertBrowserBoundary(
                platformSessionStillValid,
                platformToken,
                platformTenantToken);
    }

    private static MvcResult created(
            MockHttpServletRequestBuilder request) throws Exception {
        return mockMvc.perform(request)
                .andExpect(status().isCreated())
                .andReturn();
    }

    private static UUID createdId(MvcResult result) throws Exception {
        return UUID.fromString(JsonPath.read(body(result), "$.id"));
    }

    private static void assertBrowserBoundary(
            MvcResult result,
            String... forbiddenHeaderFragments) {
        MockHttpServletResponse response = result.getResponse();
        assertThat(response.getStatus() < 300 || response.getStatus() >= 400)
                .as("browser-facing APIs must not redirect")
                .isTrue();
        assertThat(response.getHeader(HttpHeaders.LOCATION)).isNull();
        assertCommonBrowserBoundary(result, forbiddenHeaderFragments);
    }

    private static void assertBrowserBoundaryWithRelativeLocation(
            MvcResult result,
            String... forbiddenHeaderFragments) {
        String location = result.getResponse()
                .getHeader(HttpHeaders.LOCATION);
        assertThat(location)
                .startsWith("/api/v1/")
                .doesNotContain(
                        "://",
                        "//" + HOST_CANARY,
                        "//" + FORWARDED_HOST_CANARY,
                        "?",
                        "#",
                        "@");
        assertCommonBrowserBoundary(result, forbiddenHeaderFragments);
    }

    private static void assertCommonBrowserBoundary(
            MvcResult result,
            String... forbiddenHeaderFragments) {
        MockHttpServletResponse response = result.getResponse();
        assertThat(response.getHeaders(
                HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN)).isEmpty();
        assertThat(response.getHeaders(
                HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS)).isEmpty();
        assertThat(response.getHeaders(
                HttpHeaders.ACCESS_CONTROL_ALLOW_HEADERS)).isEmpty();
        assertThat(response.getHeaders(
                HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS)).isEmpty();
        assertThat(response.getHeaders(
                HttpHeaders.ACCESS_CONTROL_EXPOSE_HEADERS)).isEmpty();
        assertThat(response.getHeaders(HttpHeaders.SET_COOKIE)).isEmpty();
        assertThat(result.getRequest().getSession(false)).isNull();

        List<String> cacheDirectives = Arrays.stream(
                        response.getHeader(HttpHeaders.CACHE_CONTROL)
                                .split(","))
                .map(String::strip)
                .map(value -> value.toLowerCase(Locale.ROOT))
                .toList();
        assertThat(cacheDirectives).contains(
                "no-store",
                "no-cache",
                "max-age=0",
                "must-revalidate");
        assertThat(response.getHeader(HttpHeaders.PRAGMA))
                .isEqualToIgnoringCase("no-cache");
        assertThat(response.getHeader(HttpHeaders.EXPIRES))
                .isEqualTo("0");
        assertThat(response.getHeader("X-Content-Type-Options"))
                .isEqualToIgnoringCase("nosniff");

        List<String> forbidden = new ArrayList<>(REQUEST_CANARIES);
        forbidden.addAll(Arrays.asList(forbiddenHeaderFragments));
        String headers = response.getHeaderNames().stream()
                .flatMap(name -> response.getHeaders(name).stream()
                        .map(value -> name + ":" + value))
                .map(value -> value.toLowerCase(Locale.ROOT))
                .collect(Collectors.joining("\n"));
        for (String fragment : forbidden) {
            if (fragment != null && !fragment.isBlank()) {
                assertThat(headers)
                        .doesNotContain(fragment.toLowerCase(Locale.ROOT));
            }
        }
    }

    private static MockHttpServletRequestBuilder hostile(
            MockHttpServletRequestBuilder request) {
        return hostile(request, HOSTILE_ORIGIN);
    }

    private static MockHttpServletRequestBuilder hostile(
            MockHttpServletRequestBuilder request,
            String origin) {
        return request
                .header(HttpHeaders.ORIGIN, origin)
                .header(HttpHeaders.REFERER, REFERER_CANARY)
                .header(HttpHeaders.HOST, HOST_CANARY)
                .header(
                        "Forwarded",
                        "for=192.0.2.77;host="
                                + FORWARDED_HOST_CANARY
                                + ";proto=http")
                .header("X-Forwarded-For", "192.0.2.78")
                .header("X-Forwarded-Host", FORWARDED_HOST_CANARY)
                .header("X-Forwarded-Proto", "http")
                .header("X-Forwarded-Port", "81")
                .header("X-Forwarded-Prefix", FORWARDED_PREFIX_CANARY)
                .header("X-Forwarded-Server", FORWARDED_SERVER_CANARY)
                .header("X-Forwarded-Ssl", "off")
                .header("X-Request-Id", REQUEST_ID);
    }

    private static MockHttpServletRequestBuilder authorized(
            MockHttpServletRequestBuilder request,
            String token) {
        return request.header(
                HttpHeaders.AUTHORIZATION,
                "Bearer " + token);
    }

    private static String accessToken(MvcResult result) throws Exception {
        return JsonPath.read(body(result), "$.accessToken");
    }

    private static String body(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString();
    }

    private static String loginBody(String username, String password) {
        return """
                {"username":"%s","password":"%s"}
                """.formatted(username, password);
    }

    private static String tenantLoginBody() {
        return """
                {"tenantCode":"%s","username":"%s","password":"%s"}
                """.formatted(
                    TENANT_CODE,
                    TENANT_USERNAME,
                    TENANT_PASSWORD);
    }

    private static String credentialBody(
            String token,
            String newPassword) {
        return """
                {"token":"%s","newPassword":"%s"}
                """.formatted(token, newPassword);
    }

    private static String orderBody() {
        return """
                {"shopId":"%s",
                 "externalOrderRef":"BROWSER-ORIGIN-GATE-ORDER",
                 "idempotencyKey":"browser-origin-gate-order",
                 "currency":"CNY",
                 "buyerReference":"Browser Origin Gate Buyer",
                 "placedAt":"2026-01-02T03:04:05Z",
                 "lines":[{
                   "skuId":"%s",
                   "externalListingRef":"browser-origin-listing",
                   "externalVariantRef":"browser-origin-variant",
                   "externalLineRef":"browser-origin-line",
                   "titleSnapshot":"Browser Origin Gate Line",
                   "quantity":1,"unitPriceMinor":9900,
                   "currency":"CNY"
                 }]}
                """.formatted(shopId, skuId);
    }

    private static ListAppender<ILoggingEvent> captureLogs() {
        Logger root = (Logger) LoggerFactory.getLogger(
                org.slf4j.Logger.ROOT_LOGGER_NAME);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        root.addAppender(appender);
        return appender;
    }

    private static void stopCapturing(
            ListAppender<ILoggingEvent> appender) {
        Logger root = (Logger) LoggerFactory.getLogger(
                org.slf4j.Logger.ROOT_LOGGER_NAME);
        root.detachAppender(appender);
        appender.stop();
    }

    private static void assertLogsSafe(
            ListAppender<ILoggingEvent> appender,
            String... forbiddenFragments) {
        String output = appender.list.stream()
                .map(event -> event.getFormattedMessage()
                        + System.lineSeparator()
                        + ThrowableProxyUtil.asString(
                                event.getThrowableProxy()))
                .collect(Collectors.joining(System.lineSeparator()));
        List<String> forbidden = new ArrayList<>(REQUEST_CANARIES);
        forbidden.addAll(Arrays.asList(forbiddenFragments));
        assertThat(output).doesNotContain(
                forbidden.toArray(String[]::new));
    }

    private record PreflightCase(
            String path,
            String requestedMethod,
            int expectedStatus) {
    }
}
