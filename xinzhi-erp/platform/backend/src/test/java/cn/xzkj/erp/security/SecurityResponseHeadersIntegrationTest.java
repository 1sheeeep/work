package cn.xzkj.erp.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@TestMethodOrder(OrderAnnotation.class)
class SecurityResponseHeadersIntegrationTest {

    private static final String TENANT_CODE = "cache_gate_tenant";
    private static final String TENANT_ADMIN_USERNAME =
            "cache_gate_admin@example.test";
    private static final String TENANT_ADMIN_PASSWORD =
            "cache-gate-tenant-admin-password";
    private static final String SECOND_SYSTEM_ADMIN_USERNAME =
            "cache_gate_system_admin@example.test";
    private static final String SECOND_SYSTEM_ADMIN_PASSWORD =
            "cache-gate-system-admin-password";
    private static final String SUPPLIER_CONTACT_EMAIL =
            "security-gate-contact@example.invalid";
    private static final String ORIGIN_CANARY =
            "https://origin-cache-gate.invalid";
    private static final String HOST_CANARY =
            "host-cache-gate.invalid";
    private static final String FORWARDED_HOST_CANARY =
            "forwarded-cache-gate.invalid";
    private static final String FORWARDED_PREFIX_CANARY =
            "/srv/xz-erp/internal/cache-gate";
    private static final String REQUEST_ID_CANARY =
            "cache-gate-request-id";
    private static final String EXCEPTION_CANARY =
            "java.lang.IllegalStateException:cache-gate";
    private static final String CONDITIONAL_ETAG =
            "\"cache-gate-credential-validator\"";
    private static final PostgresqlApiFixture FIXTURE =
            new PostgresqlApiFixture();
    private static final List<String> GLOBAL_HEADER_CANARIES =
            List.of(
                    ORIGIN_CANARY,
                    HOST_CANARY,
                    FORWARDED_HOST_CANARY,
                    FORWARDED_PREFIX_CANARY,
                    REQUEST_ID_CANARY,
                    EXCEPTION_CANARY,
                    CONDITIONAL_ETAG);

    private static MockMvc mockMvc;
    private static String platformToken;
    private static String secondPlatformToken;
    private static String tenantToken;
    private static String repeatedTenantToken;
    private static String platformTenantToken;
    private static String platformCredential;
    private static String tenantCredential;
    private static UUID tenantId;

    @BeforeAll
    static void start() throws Exception {
        FIXTURE.start();
        mockMvc = FIXTURE.mockMvc();
    }

    @AfterAll
    static void stop() {
        FIXTURE.close();
    }

    @Test
    @Order(1)
    void runsOnlyAgainstOwnedEphemeralPostgresql16() throws Exception {
        assertThat(FIXTURE.isRunning()).isTrue();
        assertThat(FIXTURE.imageName()).isEqualTo("postgres:16-alpine");
        assertThat(FIXTURE.jdbcUrl()).startsWith("jdbc:postgresql:");
        assertThat(FIXTURE.singleString("SHOW server_version"))
                .startsWith("16.");
    }

    @Test
    @Order(2)
    void platformAuthenticationAndSingleUseCredentialResponsesAreNotCacheable()
            throws Exception {
        MvcResult failedLogin = perform(hostile(post(
                                "/api/v1/platform-admin/auth/login"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(
                                PostgresqlApiFixture.SYSTEM_ADMIN_USERNAME,
                                "jdbc:postgresql://db.internal/erp?"
                                        + "password=cache-gate")))
                .andExpect(status().isUnauthorized())
                .andReturn();
        assertSensitiveResponse(
                failedLogin,
                PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD);

        MvcResult malformedLogin = perform(hostile(post(
                                "/api/v1/platform-admin/auth/login"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"username":"%s","password":"%s
                                """.formatted(
                                    PostgresqlApiFixture
                                            .SYSTEM_ADMIN_USERNAME,
                                    EXCEPTION_CANARY)))
                .andExpect(status().isBadRequest())
                .andReturn();
        assertSensitiveResponse(
                malformedLogin,
                EXCEPTION_CANARY,
                PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD);

        MvcResult firstLogin = perform(hostile(post(
                                "/api/v1/platform-admin/auth/login"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(
                                PostgresqlApiFixture.SYSTEM_ADMIN_USERNAME,
                                PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD)))
                .andExpect(status().isOk())
                .andReturn();
        platformToken = accessToken(firstLogin);
        assertSensitiveResponse(
                firstLogin,
                platformToken,
                PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD);

        MvcResult repeatedLogin = perform(hostile(post(
                                "/api/v1/platform-admin/auth/login"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(
                                PostgresqlApiFixture.SYSTEM_ADMIN_USERNAME,
                                PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD)))
                .andExpect(status().isOk())
                .andReturn();
        assertSensitiveResponse(
                repeatedLogin,
                accessToken(repeatedLogin),
                platformToken,
                PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD);

        MvcResult createdAdmin = perform(authorized(hostile(post(
                                "/api/v1/platform-admin/system-admins")),
                        platformToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"%s",
                                 "displayName":"Cache Gate System Admin"}
                                """.formatted(
                                    SECOND_SYSTEM_ADMIN_USERNAME)))
                .andExpect(status().isCreated())
                .andReturn();
        platformCredential = JsonPath.read(
                body(createdAdmin),
                "$.activationCredential.token");
        assertSensitiveResponse(
                createdAdmin,
                platformCredential,
                platformToken);

        MvcResult redeemed = perform(hostile(post(
                                "/api/v1/platform-admin/auth/"
                                        + "password-credentials/redeem"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(credentialBody(
                                platformCredential,
                                SECOND_SYSTEM_ADMIN_PASSWORD)))
                .andExpect(status().isNoContent())
                .andReturn();
        assertSensitiveResponse(
                redeemed,
                platformCredential,
                SECOND_SYSTEM_ADMIN_PASSWORD);

        MvcResult repeatedRedemption = perform(hostile(post(
                                "/api/v1/platform-admin/auth/"
                                        + "password-credentials/redeem"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(credentialBody(
                                platformCredential,
                                SECOND_SYSTEM_ADMIN_PASSWORD)))
                .andExpect(status().isUnauthorized())
                .andReturn();
        assertSensitiveResponse(
                repeatedRedemption,
                platformCredential,
                SECOND_SYSTEM_ADMIN_PASSWORD);

        MvcResult secondLogin = perform(hostile(post(
                                "/api/v1/platform-admin/auth/login"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(
                                SECOND_SYSTEM_ADMIN_USERNAME,
                                SECOND_SYSTEM_ADMIN_PASSWORD)))
                .andExpect(status().isOk())
                .andReturn();
        secondPlatformToken = accessToken(secondLogin);
        assertSensitiveResponse(
                secondLogin,
                secondPlatformToken,
                SECOND_SYSTEM_ADMIN_PASSWORD);

        MvcResult platformMe = perform(authorized(hostile(get(
                                "/api/v1/platform-admin/auth/me")),
                        secondPlatformToken))
                .andExpect(status().isOk())
                .andReturn();
        assertSensitiveResponse(platformMe, secondPlatformToken);

        MvcResult logout = perform(authorized(hostile(delete(
                                "/api/v1/platform-admin/auth/session")),
                        secondPlatformToken))
                .andExpect(status().isNoContent())
                .andReturn();
        assertSensitiveResponse(logout, secondPlatformToken);

        MvcResult revoked = perform(authorized(hostile(get(
                                "/api/v1/platform-admin/auth/me")),
                        secondPlatformToken))
                .andExpect(status().isUnauthorized())
                .andReturn();
        assertSensitiveResponse(revoked, secondPlatformToken);
    }

    @Test
    @Order(3)
    void enterpriseAuthenticationAndSingleUseCredentialResponsesAreNotCacheable()
            throws Exception {
        MvcResult createdTenant = perform(authorized(hostile(post(
                                "/api/v1/platform-admin/tenants")),
                        platformToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"code":"%s",
                                 "name":"Cache Gate Enterprise",
                                 "adminEmail":"%s",
                                 "adminDisplayName":"Cache Gate Admin",
                                 "adminInitialPassword":"%s"}
                                 """.formatted(
                                     TENANT_CODE,
                                     TENANT_ADMIN_USERNAME,
                                     TENANT_ADMIN_PASSWORD)))
                .andExpect(status().isCreated())
                .andReturn();
        tenantId = UUID.fromString(JsonPath.read(
                body(createdTenant),
                "$.tenant.id"));
        FIXTURE.enableErp(tenantId);
        tenantCredential = "direct-account-no-credential";
        assertSensitiveResponse(
                createdTenant,
                tenantCredential,
                platformToken);

        MvcResult failedLogin = perform(hostile(post("/api/v1/auth/login"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(tenantLoginBody(
                                TENANT_CODE,
                                TENANT_ADMIN_USERNAME,
                                "/srv/xz-erp/internal/wrong-password")))
                .andExpect(status().isUnauthorized())
                .andReturn();
        assertSensitiveResponse(failedLogin, TENANT_ADMIN_PASSWORD);

        MvcResult firstLogin = perform(hostile(post("/api/v1/auth/login"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(tenantLoginBody(
                                TENANT_CODE,
                                TENANT_ADMIN_USERNAME,
                                TENANT_ADMIN_PASSWORD)))
                .andExpect(status().isOk())
                .andReturn();
        tenantToken = accessToken(firstLogin);
        assertSensitiveResponse(
                firstLogin,
                tenantToken,
                TENANT_ADMIN_PASSWORD);

        MvcResult secondLogin = perform(hostile(post("/api/v1/auth/login"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(tenantLoginBody(
                                TENANT_CODE,
                                TENANT_ADMIN_USERNAME,
                                TENANT_ADMIN_PASSWORD)))
                .andExpect(status().isOk())
                .andReturn();
        repeatedTenantToken = accessToken(secondLogin);
        assertThat(repeatedTenantToken).isNotEqualTo(tenantToken);
        assertSensitiveResponse(
                secondLogin,
                repeatedTenantToken,
                tenantToken,
                TENANT_ADMIN_PASSWORD);
    }

    @Test
    @Order(4)
    void sensitiveAdministrativeMemberAuditSessionAndSupplierGetsAreNotCacheable()
            throws Exception {
        MvcResult createdMember = perform(authorized(hostile(post(
                                "/api/v1/iam/members")),
                        tenantToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"cache_gate_member@example.test",
                                 "displayName":"Cache Gate Member",
                                 "initialPassword":"cache-member-password",
                                 "roleIds":[]}
                                """))
                .andExpect(status().isCreated())
                .andReturn();
        assertSensitiveResponse(createdMember, tenantToken);

        FIXTURE.executeUpdate("""
                        INSERT INTO tenant_suppliers (
                            id, tenant_id, business_code, name, status,
                            contact_name, contact_phone, contact_email,
                            address, notes
                        ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)
                        """,
                UUID.randomUUID(),
                tenantId,
                "CACHE_GATE_SUPPLIER",
                "Cache Gate Supplier",
                "Sensitive Contact",
                "+86-138-0000-0000",
                SUPPLIER_CONTACT_EMAIL,
                "Internal cache gate address",
                "Sensitive supplier notes");

        assertSensitiveGet(
                authorized(hostile(get(
                                "/api/v1/platform-admin/system-admins")),
                        platformToken),
                "Cache Gate System Admin",
                platformToken);
        assertSensitiveGet(
                authorized(hostile(get("/api/v1/auth/me")),
                        tenantToken),
                TENANT_ADMIN_USERNAME,
                tenantToken);
        MvcResult sessions = perform(authorized(hostile(get(
                                "/api/v1/auth/sessions")),
                        tenantToken))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(body(sessions)).contains("\"current\":true");
        List<String> sessionHeaderCanaries = new ArrayList<>(
                JsonPath.read(body(sessions), "$.items[*].id"));
        sessionHeaderCanaries.add(tenantToken);
        assertSensitiveResponse(
                sessions,
                sessionHeaderCanaries.toArray(String[]::new));
        assertSensitiveGet(
                authorized(hostile(get("/api/v1/iam/members")),
                        tenantToken),
                "Cache Gate Member",
                tenantToken);
        assertSensitiveGet(
                authorized(hostile(get("/api/v1/iam/audit-logs")),
                        tenantToken),
                REQUEST_ID_CANARY,
                tenantToken);
        assertSensitiveGet(
                authorized(hostile(get("/api/v1/suppliers")),
                        tenantToken),
                SUPPLIER_CONTACT_EMAIL,
                tenantToken);
    }

    @Test
    @Order(5)
    void repeatedAndConditionalRequestsCannotCreateCacheableCredentialResponses()
            throws Exception {
        MvcResult repeatedMe = perform(authorized(hostile(get(
                                "/api/v1/auth/me")),
                        tenantToken))
                .andExpect(status().isOk())
                .andReturn();
        assertSensitiveResponse(
                repeatedMe,
                tenantToken,
                repeatedTenantToken,
                tenantCredential);

        MvcResult conditionalMe = perform(authorized(hostile(get(
                                "/api/v1/auth/me")
                                .header(HttpHeaders.IF_NONE_MATCH,
                                        CONDITIONAL_ETAG)
                                .header(
                                        HttpHeaders.IF_MODIFIED_SINCE,
                                        "Wed, 21 Oct 2015 07:28:00 GMT")),
                        tenantToken))
                .andExpect(status().isOk())
                .andReturn();
        assertSensitiveResponse(
                conditionalMe,
                tenantToken,
                repeatedTenantToken,
                tenantCredential,
                CONDITIONAL_ETAG);

        MvcResult conditionalSupplier = perform(authorized(hostile(get(
                                "/api/v1/suppliers")
                                .header(HttpHeaders.IF_NONE_MATCH,
                                        CONDITIONAL_ETAG)),
                        tenantToken))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(body(conditionalSupplier)).contains(SUPPLIER_CONTACT_EMAIL);
        assertSensitiveResponse(
                conditionalSupplier,
                tenantToken,
                tenantCredential,
                CONDITIONAL_ETAG);
    }

    @Test
    @Order(6)
    void authorizationFailuresAndPlatformTenantSwitchesAreNotCacheable()
            throws Exception {
        MvcResult platformDenied = perform(authorized(hostile(get(
                                "/api/v1/suppliers")),
                        platformToken))
                .andExpect(status().isForbidden())
                .andReturn();
        assertSensitiveResponse(platformDenied, platformToken);

        MvcResult tenantDenied = perform(authorized(hostile(get(
                                "/api/v1/platform-admin/system-admins")),
                        tenantToken))
                .andExpect(status().isForbidden())
                .andReturn();
        assertSensitiveResponse(tenantDenied, tenantToken);

        MvcResult entered = perform(authorized(hostile(post(
                                "/api/v1/platform-admin/tenants/"
                                        + tenantId
                                        + "/enter")),
                        platformToken))
                .andExpect(status().isOk())
                .andReturn();
        platformTenantToken = accessToken(entered);
        assertSensitiveResponse(
                entered,
                platformTenantToken,
                platformToken);

        MvcResult tenantSessionMe = perform(authorized(hostile(get(
                                "/api/v1/auth/me")),
                        platformTenantToken))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(body(tenantSessionMe))
                .contains(PostgresqlApiFixture.SYSTEM_ADMIN_USERNAME);
        assertSensitiveResponse(
                tenantSessionMe,
                platformTenantToken,
                platformToken);

        MvcResult left = perform(authorized(hostile(delete(
                                "/api/v1/platform-admin/tenant-session")),
                        platformTenantToken))
                .andExpect(status().isNoContent())
                .andReturn();
        assertSensitiveResponse(left, platformTenantToken);

        MvcResult revokedTenantSession = perform(authorized(hostile(get(
                                "/api/v1/auth/me")),
                        platformTenantToken))
                .andExpect(status().isUnauthorized())
                .andReturn();
        assertSensitiveResponse(revokedTenantSession, platformTenantToken);

        MvcResult baseSessionStillValid = perform(authorized(hostile(get(
                                "/api/v1/platform-admin/auth/me")),
                        platformToken))
                .andExpect(status().isOk())
                .andReturn();
        assertSensitiveResponse(
                baseSessionStillValid,
                platformToken,
                platformTenantToken);
    }

    @Test
    @Order(7)
    void enterpriseLogoutRevokesTokensWithoutLeakingSessionMaterial()
            throws Exception {
        MvcResult logout = perform(authorized(hostile(delete(
                                "/api/v1/auth/session")),
                        tenantToken))
                .andExpect(status().isNoContent())
                .andReturn();
        assertSensitiveResponse(logout, tenantToken);

        MvcResult revoked = perform(authorized(hostile(get(
                                "/api/v1/auth/me")),
                        tenantToken))
                .andExpect(status().isUnauthorized())
                .andReturn();
        assertSensitiveResponse(revoked, tenantToken);

        MvcResult secondLogout = perform(authorized(hostile(delete(
                                "/api/v1/auth/session")),
                        repeatedTenantToken))
                .andExpect(status().isNoContent())
                .andReturn();
        assertSensitiveResponse(
                secondLogout,
                repeatedTenantToken,
                tenantToken);
    }

    private static void assertSensitiveGet(
            MockHttpServletRequestBuilder request,
            String expectedBodyFragment,
            String... forbiddenHeaderFragments) throws Exception {
        MvcResult result = perform(request)
                .andExpect(status().isOk())
                .andReturn();
        assertThat(body(result)).contains(expectedBodyFragment);
        assertSensitiveResponse(result, forbiddenHeaderFragments);
    }

    private static void assertSensitiveResponse(
            MvcResult result,
            String... forbiddenHeaderFragments) {
        MockHttpServletResponse response = result.getResponse();
        assertThat(response.getStatus() < 300 || response.getStatus() >= 400)
                .as("sensitive API responses must not redirect")
                .isTrue();
        assertThat(response.getHeader(HttpHeaders.LOCATION)).isNull();
        assertCoreSecurityHeaders(response);
        assertOptionalHeaderSurface(response);
        assertHeaderSurfaceSafe(response, forbiddenHeaderFragments);
    }

    private static void assertCoreSecurityHeaders(
            MockHttpServletResponse response) {
        assertThat(directives(response.getHeader(HttpHeaders.CACHE_CONTROL)))
                .contains(
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
        String frameOptions = response.getHeader("X-Frame-Options");
        String contentSecurityPolicy =
                response.getHeader("Content-Security-Policy");
        assertThat(
                "DENY".equalsIgnoreCase(frameOptions)
                        || containsFrameAncestorsNone(contentSecurityPolicy))
                .as("a frame policy must deny embedding")
                .isTrue();
        assertThat(response.getHeaders(HttpHeaders.SET_COOKIE)).isEmpty();
    }

    private static void assertOptionalHeaderSurface(
            MockHttpServletResponse response) {
        String challenge = response.getHeader(HttpHeaders.WWW_AUTHENTICATE);
        if (challenge != null) {
            assertThat(challenge)
                    .doesNotContain("\r", "\n")
                    .startsWithIgnoringCase("Bearer");
        }
        assertOptionalSingleLineHeader(response, "Referrer-Policy");
        assertOptionalSingleLineHeader(
                response,
                "Content-Security-Policy");
        assertOptionalSingleLineHeader(
                response,
                "Strict-Transport-Security");
    }

    private static void assertOptionalSingleLineHeader(
            MockHttpServletResponse response,
            String headerName) {
        String value = response.getHeader(headerName);
        if (value != null) {
            assertThat(value)
                    .isNotBlank()
                    .doesNotContain("\r", "\n");
        }
    }

    private static void assertHeaderSurfaceSafe(
            MockHttpServletResponse response,
            String... forbiddenHeaderFragments) {
        List<String> forbidden = new ArrayList<>(GLOBAL_HEADER_CANARIES);
        forbidden.addAll(Arrays.asList(forbiddenHeaderFragments));
        String headerSurface = response.getHeaderNames().stream()
                .flatMap(name -> response.getHeaders(name).stream()
                        .map(value -> name + ":" + value))
                .map(value -> value.toLowerCase(Locale.ROOT))
                .reduce("", (left, right) -> left + "\n" + right);
        for (String fragment : forbidden) {
            if (fragment != null && !fragment.isBlank()) {
                assertThat(headerSurface)
                        .doesNotContain(fragment.toLowerCase(Locale.ROOT));
            }
        }
    }

    private static List<String> directives(String cacheControl) {
        assertThat(cacheControl).isNotBlank();
        return Arrays.stream(cacheControl.split(","))
                .map(String::strip)
                .map(value -> value.toLowerCase(Locale.ROOT))
                .toList();
    }

    private static boolean containsFrameAncestorsNone(String policy) {
        return policy != null
                && policy.toLowerCase(Locale.ROOT)
                        .contains("frame-ancestors 'none'");
    }

    private static MockHttpServletRequestBuilder hostile(
            MockHttpServletRequestBuilder request) {
        return request
                .header(HttpHeaders.ORIGIN, ORIGIN_CANARY)
                .header(HttpHeaders.HOST, HOST_CANARY)
                .header("Forwarded",
                        "for=192.0.2.60;host=" + FORWARDED_HOST_CANARY
                                + ";proto=http")
                .header("X-Forwarded-For", "192.0.2.60")
                .header("X-Forwarded-Host", FORWARDED_HOST_CANARY)
                .header("X-Forwarded-Proto", "http")
                .header("X-Forwarded-Prefix", FORWARDED_PREFIX_CANARY)
                .header("X-Request-Id", REQUEST_ID_CANARY)
                .header("X-Exception-Canary", EXCEPTION_CANARY);
    }

    private static MockHttpServletRequestBuilder authorized(
            MockHttpServletRequestBuilder request,
            String token) {
        return request.header(
                HttpHeaders.AUTHORIZATION,
                "Bearer " + token);
    }

    private static org.springframework.test.web.servlet.ResultActions perform(
            MockHttpServletRequestBuilder request) throws Exception {
        return mockMvc.perform(request);
    }

    private static String accessToken(MvcResult result) throws Exception {
        return JsonPath.read(body(result), "$.accessToken");
    }

    private static String body(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString();
    }

    private static String loginBody(
            String username,
            String password) {
        return """
                {"username":"%s","password":"%s"}
                """.formatted(username, password);
    }

    private static String tenantLoginBody(
            String tenantCode,
            String username,
            String password) {
        return """
                {"tenantCode":"%s","username":"%s","password":"%s"}
                """.formatted(tenantCode, username, password);
    }

    private static String credentialBody(
            String token,
            String newPassword) {
        return """
                {"token":"%s","newPassword":"%s"}
                """.formatted(token, newPassword);
    }
}
