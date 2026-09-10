package cn.xzkj.erp.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.read.ListAppender;
import com.jayway.jsonpath.JsonPath;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.zip.GZIPOutputStream;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.Timeout;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@TestMethodOrder(OrderAnnotation.class)
@Timeout(value = 45, unit = TimeUnit.SECONDS)
class ApiResourceBoundaryIntegrationTest {

    private static final String TENANT_CODE = "resource_boundary_tenant";
    private static final String TENANT_ADMIN_USERNAME =
            "resource_boundary_admin@example.test";
    private static final String TENANT_ADMIN_PASSWORD =
            "resource-boundary-tenant-password";
    private static final String BODY_CANARY =
            "resource-boundary-request-body-password-token-credential-canary";
    private static final Set<String> SAFE_BAD_REQUEST_CODES =
            Set.of("invalid_request", "validation_failed");
    private static final PostgresqlApiFixture FIXTURE =
            new PostgresqlApiFixture();

    private static MockMvc mockMvc;
    private static String platformToken;
    private static String tenantToken;
    private static String platformTenantToken;
    private static String activationCredential;
    private static UUID tenantId;
    private static UUID tenantAdminId;

    @BeforeAll
    static void start() throws Exception {
        FIXTURE.start();
        mockMvc = FIXTURE.mockMvc();

        platformToken = accessToken(mockMvc.perform(
                        post("/api/v1/platform-admin/auth/login")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                        {"username":"%s","password":"%s"}
                                        """.formatted(
                                            PostgresqlApiFixture
                                                    .SYSTEM_ADMIN_USERNAME,
                                            PostgresqlApiFixture
                                                    .SYSTEM_ADMIN_PASSWORD)))
                .andExpect(status().isOk())
                .andReturn());

        MvcResult tenant = mockMvc.perform(authorized(
                                post("/api/v1/platform-admin/tenants"),
                                platformToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"code":"%s",
                                 "name":"Resource Boundary Tenant",
                                 "adminEmail":"%s",
                                 "adminDisplayName":"Resource Boundary Admin",
                                 "adminInitialPassword":"%s"}
                                 """.formatted(
                                     TENANT_CODE,
                                     TENANT_ADMIN_USERNAME,
                                     TENANT_ADMIN_PASSWORD)))
                .andExpect(status().isCreated())
                .andReturn();
        tenantId = UUID.fromString(JsonPath.read(body(tenant), "$.tenant.id"));
        FIXTURE.enableErp(tenantId);
        activationCredential = "direct-account-no-credential";

        MvcResult login = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"tenantCode":"%s","username":"%s",
                                 "password":"%s"}
                                """.formatted(
                                    TENANT_CODE,
                                    TENANT_ADMIN_USERNAME,
                                    TENANT_ADMIN_PASSWORD)))
                .andExpect(status().isOk())
                .andReturn();
        tenantToken = accessToken(login);
        tenantAdminId = UUID.fromString(JsonPath.read(body(login), "$.user.id"));

        platformTenantToken = accessToken(mockMvc.perform(authorized(
                                post("/api/v1/platform-admin/tenants/"
                                        + tenantId
                                        + "/enter"),
                                platformToken))
                .andExpect(status().isOk())
                .andReturn());
    }

    @AfterAll
    static void stop() {
        FIXTURE.close();
    }

    @Test
    @Order(1)
    void runsOnOneUsePostgresql16WithPinnedTestcontainers() throws Exception {
        assertThat(FIXTURE.imageName()).isEqualTo("postgres:16-alpine");
        assertThat(FIXTURE.singleString("SHOW server_version"))
                .startsWith("16.");
        assertThat(FIXTURE.isRunning()).isTrue();
    }

    @Test
    @Order(2)
    void representativeDeclaredDtoLimitsRejectBoundedOversizeInputs()
            throws Exception {
        assertSafeBadRequest(mockMvc.perform(
                        post("/api/v1/auth/password-credentials/redeem")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                        {"token":"%s","newPassword":"valid-password"}
                                        """.formatted("t".repeat(513))))
                .andExpect(status().isBadRequest())
                .andReturn(),
                "t".repeat(513));

        assertSafeBadRequest(mockMvc.perform(authorized(
                                post("/api/v1/platform-admin/tenants"),
                                platformToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"code":"resource_boundary_rejected",
                                 "name":"%s",
                                 "adminEmail":"resource_boundary_rejected@example.test",
                                 "adminDisplayName":"Rejected Admin",
                                 "adminInitialPassword":"rejected-admin-password"}
                                """.formatted("n".repeat(161))))
                .andExpect(status().isBadRequest())
                .andReturn(),
                platformToken,
                "n".repeat(161));

        assertSafeBadRequest(mockMvc.perform(authorized(
                                put("/api/v1/iam/members/{userId}/roles",
                                        tenantAdminId),
                                tenantToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"ids":[%s],"version":0}
                                """.formatted(uuidArray(201))))
                .andExpect(status().isBadRequest())
                .andReturn(),
                tenantToken);

        assertSafeBadRequest(mockMvc.perform(authorized(
                                post("/api/v1/platform-center/platforms"),
                                platformTenantToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"code":"RESOURCE_BOUNDARY_REJECTED",
                                 "displayName":"%s"}
                                """.formatted("p".repeat(161))))
                .andExpect(status().isBadRequest())
                .andReturn(),
                platformTenantToken,
                "p".repeat(161));

        assertSafeBadRequest(mockMvc.perform(authorized(
                                post("/api/v1/product-center/spus"),
                                platformTenantToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"businessCode":"RESOURCE_BOUNDARY_REJECTED",
                                 "name":"%s","description":"%s"}
                                """.formatted(
                                    "p".repeat(201),
                                    BODY_CANARY)))
                .andExpect(status().isBadRequest())
                .andReturn(),
                platformTenantToken,
                BODY_CANARY,
                "p".repeat(201));

        assertSafeBadRequest(mockMvc.perform(authorized(
                                post("/api/v1/order-center/orders"),
                                platformTenantToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(oversizedOrderBody()))
                .andExpect(status().isBadRequest())
                .andReturn(),
                platformTenantToken,
                BODY_CANARY);

        assertSafeBadRequest(mockMvc.perform(authorized(
                                post("/api/v1/warehouse-center/warehouses"),
                                platformTenantToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"businessCode":"RESOURCE_BOUNDARY_REJECTED",
                                 "name":"%s"}
                                """.formatted("w".repeat(201))))
                .andExpect(status().isBadRequest())
                .andReturn(),
                platformTenantToken,
                "w".repeat(201));

        assertThat(FIXTURE.singleLong("""
                SELECT count(*) FROM tenants
                WHERE code = 'resource_boundary_rejected'
                """)).isZero();
        assertThat(FIXTURE.singleLong("""
                SELECT count(*) FROM tenant_product_spus
                WHERE business_code = 'RESOURCE_BOUNDARY_REJECTED'
                """)).isZero();
    }

    @Test
    @Order(3)
    void malformedDeepTruncatedAndMediaTypeAnomaliesFailClosed()
            throws Exception {
        ListAppender<ILoggingEvent> logs = captureLogs();
        try {
            long tenantsBefore = FIXTURE.singleLong(
                    "SELECT count(*) FROM tenants");
            long usersBefore = FIXTURE.singleLong(
                    "SELECT count(*) FROM users");
            long sessionsBefore = FIXTURE.singleLong(
                    "SELECT count(*) FROM auth_sessions");
            long credentialsBefore = FIXTURE.singleLong(
                    "SELECT count(*) FROM password_credentials");
            long spusBefore = FIXTURE.singleLong(
                    "SELECT count(*) FROM tenant_product_spus");
            long ordersBefore = FIXTURE.singleLong(
                    "SELECT count(*) FROM tenant_orders");
            long successAuditBefore = successfulAuditCount();

            assertSafeBadRequest(mockMvc.perform(authorized(
                                    post("/api/v1/product-center/spus"),
                                    platformTenantToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"businessCode":"RESOURCE_BOUNDARY_TRUNCATED",
                                     "name":"Rejected","description":"%s"
                                    """.formatted(BODY_CANARY)))
                    .andExpect(status().isBadRequest())
                    .andReturn(),
                    platformTenantToken,
                    BODY_CANARY);

            String deepJson = """
                    {"businessCode":"RESOURCE_BOUNDARY_DEEP","name":"Deep",
                     "unknown":%s0%s}
                    """.formatted("[".repeat(1_200), "]".repeat(1_200));
            assertSafeBadRequest(mockMvc.perform(authorized(
                                    post("/api/v1/product-center/spus"),
                                    platformTenantToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(deepJson))
                    .andExpect(status().isBadRequest())
                    .andReturn(),
                    platformTenantToken);

            for (MediaTypeEndpoint endpoint : mediaTypeEndpoints()) {
                MvcResult malformed = mockMvc.perform(endpoint.request()
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("""
                                        {"canary":"%s"
                                        """.formatted(BODY_CANARY)))
                        .andExpect(status().isBadRequest())
                        .andReturn();
                assertSafeBadRequest(malformed, sensitiveMarkers());

                MvcResult missingContentType =
                        mockMvc.perform(endpoint.request()
                                        .content(endpoint.body()))
                                .andExpect(status().isUnsupportedMediaType())
                                .andReturn();
                assertUnsupportedMediaType(
                        missingContentType,
                        endpoint.detailsEnvelope());

                MvcResult wrongContentType =
                        mockMvc.perform(endpoint.request()
                                        .contentType(MediaType.TEXT_PLAIN)
                                        .content(endpoint.body()))
                                .andExpect(status().isUnsupportedMediaType())
                                .andReturn();
                assertUnsupportedMediaType(
                        wrongContentType,
                        endpoint.detailsEnvelope());
            }

            assertSafeBadRequest(mockMvc.perform(authorized(
                                    post("/api/v1/product-center/spus"),
                                    platformTenantToken)
                            .header(HttpHeaders.CONTENT_ENCODING, "gzip")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(gzip(productMediaTypeBody())))
                    .andExpect(status().isBadRequest())
                    .andReturn(),
                    platformTenantToken,
                    BODY_CANARY);

            assertThat(FIXTURE.singleLong(
                    "SELECT count(*) FROM tenants")).isEqualTo(tenantsBefore);
            assertThat(FIXTURE.singleLong(
                    "SELECT count(*) FROM users")).isEqualTo(usersBefore);
            assertThat(FIXTURE.singleLong(
                    "SELECT count(*) FROM auth_sessions"))
                    .isEqualTo(sessionsBefore);
            assertThat(FIXTURE.singleLong(
                    "SELECT count(*) FROM password_credentials"))
                    .isEqualTo(credentialsBefore);
            assertThat(FIXTURE.singleLong(
                    "SELECT count(*) FROM tenant_product_spus"))
                    .isEqualTo(spusBefore);
            assertThat(FIXTURE.singleLong(
                    "SELECT count(*) FROM tenant_orders"))
                    .isEqualTo(ordersBefore);
            assertThat(successfulAuditCount()).isEqualTo(successAuditBefore);
            assertThat(auditCanaryCount()).isZero();

            assertCapturedLogsSafe(logs, sensitiveMarkers());
            assertNoWarningOrErrorLogs(logs);
        } finally {
            stopCapturing(logs);
        }
    }

    @Test
    @Order(4)
    void everyListEndpointRejectsNegativeOverflowAndOversizedPaging()
            throws Exception {
        for (ListEndpoint endpoint : listEndpoints()) {
            assertSafeBadRequest(mockMvc.perform(endpoint.request()
                                    .queryParam("page", "-1"))
                    .andExpect(status().isBadRequest())
                    .andReturn(),
                    endpoint.token(),
                    "-1");

            assertSafeBadRequest(mockMvc.perform(endpoint.request()
                                    .queryParam("page", "2147483648"))
                    .andExpect(status().isBadRequest())
                    .andReturn(),
                    endpoint.token(),
                    "2147483648");

            String oversized = Integer.toString(endpoint.maxSize() + 1);
            assertSafeBadRequest(mockMvc.perform(endpoint.request()
                                    .queryParam("size", oversized))
                    .andExpect(status().isBadRequest())
                    .andReturn(),
                    endpoint.token(),
                    oversized);
        }
    }

    @Test
    @Order(5)
    void everyDeclaredSearchLimitRejectsOverlongQueryWithoutSqlLeak()
            throws Exception {
        for (SearchEndpoint endpoint : searchEndpoints()) {
            String overlong = "q".repeat(endpoint.maxLength() + 1);
            assertSafeBadRequest(mockMvc.perform(endpoint.request()
                                    .queryParam(endpoint.parameter(), overlong))
                    .andExpect(status().isBadRequest())
                    .andReturn(),
                    endpoint.token(),
                    overlong);
        }
    }

    @Test
    @Order(6)
    void duplicateParametersAndCheapRepeatedFailuresNeverReachFiveHundred()
            throws Exception {
        MvcResult duplicate = mockMvc.perform(authorized(
                                get("/api/v1/product-center/spus"),
                                platformTenantToken)
                        .queryParam("page", "-1", "0")
                        .queryParam("size", "201", "50"))
                .andReturn();
        assertThat(duplicate.getResponse().getStatus()).isIn(200, 400);
        assertResponseSafe(
                duplicate.getResponse(),
                platformTenantToken,
                "-1",
                "201");

        ListAppender<ILoggingEvent> logs = captureLogs();
        try {
            for (int attempt = 0; attempt < 25; attempt++) {
                MvcResult rejected = mockMvc.perform(authorized(
                                        post("/api/v1/product-center/spus"),
                                        platformTenantToken)
                                .contentType(MediaType.TEXT_PLAIN)
                                .content(BODY_CANARY))
                        .andExpect(status().isUnsupportedMediaType())
                        .andReturn();
                assertUnsupportedMediaType(rejected, true);
            }
            assertCapturedLogsSafe(logs, sensitiveMarkers());
            assertNoWarningOrErrorLogs(logs);
        } finally {
            stopCapturing(logs);
        }
    }

    private static List<MediaTypeEndpoint> mediaTypeEndpoints() {
        return List.of(
                new MediaTypeEndpoint(
                        ignored -> post("/api/v1/auth/login"),
                        """
                        {"tenantCode":"%s","username":"%s","password":"%s"}
                        """.formatted(
                            TENANT_CODE,
                            TENANT_ADMIN_USERNAME,
                            BODY_CANARY),
                        false),
                new MediaTypeEndpoint(
                        ignored -> post(
                                "/api/v1/auth/password-credentials/redeem"),
                        """
                        {"token":"%s","newPassword":"safe-rejected-password"}
                        """.formatted(BODY_CANARY),
                        false),
                new MediaTypeEndpoint(
                        ignored -> authorized(
                                post("/api/v1/iam/members"),
                                tenantToken),
                        """
                            {"email":"resource_boundary_media_member@example.test",
                         "displayName":"%s",
                         "initialPassword":"media-member-password",
                         "roleIds":[]}
                        """.formatted(BODY_CANARY),
                        false),
                new MediaTypeEndpoint(
                        ignored -> authorized(
                                post("/api/v1/platform-admin/tenants"),
                                platformToken),
                        """
                        {"code":"resource_boundary_media",
                         "name":"%s",
                         "adminEmail":"resource_boundary_media_admin@example.test",
                         "adminDisplayName":"Rejected Admin",
                         "adminInitialPassword":"media-admin-password"}
                        """.formatted(BODY_CANARY),
                        false),
                new MediaTypeEndpoint(
                        ignored -> authorized(
                                post("/api/v1/product-center/spus"),
                                platformTenantToken),
                        productMediaTypeBody(),
                        true),
                new MediaTypeEndpoint(
                        ignored -> authorized(
                                post("/api/v1/order-center/orders"),
                                platformTenantToken),
                        orderMediaTypeBody(),
                        true));
    }

    private static List<ListEndpoint> listEndpoints() {
        UUID unknown = UUID.randomUUID();
        return List.of(
                list("/api/v1/auth/sessions", tenantToken, 100),
                list("/api/v1/iam/audit-logs", tenantToken, 100),
                list("/api/v1/iam/members", tenantToken, 100),
                list("/api/v1/iam/permissions", tenantToken, 100),
                list("/api/v1/iam/roles", tenantToken, 100),
                list("/api/v1/iam/members/" + unknown
                                + "/password-credentials",
                        tenantToken, 100),
                list("/api/v1/order-center/orders",
                        platformTenantToken, 200),
                list("/api/v1/order-center/sku-match-queue",
                        platformTenantToken, 200),
                list("/api/v1/platform-admin/system-admins",
                        platformToken, 200),
                list("/api/v1/platform-admin/tenants",
                        platformToken, 200),
                list("/api/v1/platform-center/platforms",
                        platformTenantToken, 200),
                list("/api/v1/platform-center/shops",
                        platformTenantToken, 200),
                list("/api/v1/platform-center/shops/" + unknown
                                + "/sync-jobs",
                        platformTenantToken, 200),
                list("/api/v1/product-center/listings",
                        platformTenantToken, 200),
                list("/api/v1/product-center/skus",
                        platformTenantToken, 200),
                list("/api/v1/product-center/spus",
                        platformTenantToken, 200),
                list("/api/v1/suppliers",
                        platformTenantToken, 200),
                list("/api/v1/suppliers/" + unknown + "/sku-mappings",
                        platformTenantToken, 200),
                list("/api/v1/warehouse-center/warehouses",
                        platformTenantToken, 200),
                list("/api/v1/warehouse-center/warehouses/" + unknown
                                + "/locations",
                        platformTenantToken, 200));
    }

    private static List<SearchEndpoint> searchEndpoints() {
        UUID unknown = UUID.randomUUID();
        return List.of(
                search("/api/v1/iam/audit-logs",
                        tenantToken, "action", 160),
                search("/api/v1/iam/audit-logs",
                        tenantToken, "resourceType", 100),
                search("/api/v1/order-center/orders",
                        platformTenantToken, "keyword", 100),
                search("/api/v1/order-center/sku-match-queue",
                        platformTenantToken, "keyword", 100),
                search("/api/v1/product-center/listings",
                        platformTenantToken, "keyword", 100),
                search("/api/v1/product-center/skus",
                        platformTenantToken, "keyword", 100),
                search("/api/v1/product-center/spus",
                        platformTenantToken, "keyword", 100),
                search("/api/v1/suppliers",
                        platformTenantToken, "query", 100),
                search("/api/v1/suppliers/" + unknown + "/sku-mappings",
                        platformTenantToken, "query", 120),
                search("/api/v1/warehouse-center/warehouses",
                        platformTenantToken, "keyword", 100),
                search("/api/v1/warehouse-center/warehouses/" + unknown
                                + "/locations",
                        platformTenantToken, "keyword", 100));
    }

    private static ListEndpoint list(
            String path,
            String token,
            int maxSize) {
        return new ListEndpoint(
                ignored -> authorized(get(path), token),
                token,
                maxSize);
    }

    private static SearchEndpoint search(
            String path,
            String token,
            String parameter,
            int maxLength) {
        return new SearchEndpoint(
                ignored -> authorized(get(path), token),
                token,
                parameter,
                maxLength);
    }

    private static String oversizedOrderBody() {
        String line = """
                {"externalLineRef":"line","titleSnapshot":"%s",
                 "quantity":1,"unitPriceMinor":1,"currency":"CNY"}
                """.formatted(BODY_CANARY).strip();
        return """
                {"shopId":"%s",
                 "externalOrderRef":"RESOURCE-BOUNDARY-REJECTED",
                 "idempotencyKey":"resource-boundary-rejected",
                 "currency":"CNY","buyerReference":"Rejected",
                 "placedAt":"2026-01-02T03:04:05Z",
                 "lines":[%s]}
                """.formatted(
                    UUID.randomUUID(),
                    String.join(",", java.util.Collections.nCopies(201, line)));
    }

    private static String productMediaTypeBody() {
        return """
                {"businessCode":"RESOURCE_BOUNDARY_MEDIA",
                 "name":"Rejected","description":"%s"}
                """.formatted(BODY_CANARY);
    }

    private static String orderMediaTypeBody() {
        return """
                {"shopId":"%s",
                 "externalOrderRef":"RESOURCE-BOUNDARY-MEDIA",
                 "idempotencyKey":"resource-boundary-media",
                 "currency":"CNY","buyerReference":"%s",
                 "placedAt":"2026-01-02T03:04:05Z",
                 "lines":[
                   {"externalLineRef":"line-1","titleSnapshot":"Rejected",
                    "quantity":1,"unitPriceMinor":1,"currency":"CNY"}
                 ]}
                """.formatted(UUID.randomUUID(), BODY_CANARY);
    }

    private static String uuidArray(int count) {
        return java.util.stream.IntStream.range(0, count)
                .mapToObj(ignored -> "\"" + UUID.randomUUID() + "\"")
                .collect(Collectors.joining(","));
    }

    private static byte[] gzip(String value) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(output)) {
            gzip.write(value.getBytes(StandardCharsets.UTF_8));
        }
        return output.toByteArray();
    }

    private static String accessToken(MvcResult result) throws Exception {
        return JsonPath.read(body(result), "$.accessToken");
    }

    private static String body(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString(
                StandardCharsets.UTF_8);
    }

    private static MockHttpServletRequestBuilder authorized(
            MockHttpServletRequestBuilder request,
            String token) {
        return request.header(
                HttpHeaders.AUTHORIZATION,
                "Bearer " + token);
    }

    private static void assertSafeBadRequest(
            MvcResult result,
            String... forbiddenMarkers) throws Exception {
        Map<String, Object> error = JsonPath.read(body(result), "$");
        assertThat(error.keySet())
                .isSubsetOf("code", "message", "details")
                .contains("code", "message");
        assertThat(error.get("code")).isIn(SAFE_BAD_REQUEST_CODES);
        assertResponseSafe(result.getResponse(), forbiddenMarkers);
    }

    private static void assertUnsupportedMediaType(
            MvcResult result,
            boolean detailsEnvelope) throws Exception {
        Map<String, Object> error = JsonPath.read(body(result), "$");
        assertThat(error)
                .containsEntry("code", "invalid_request")
                .containsEntry(
                        "message",
                        "Content type is not supported");
        if (detailsEnvelope) {
            assertThat(error.keySet())
                    .containsExactlyInAnyOrder("code", "message", "details");
            assertThat(error.get("details")).isEqualTo(Map.of());
        } else {
            assertThat(error.keySet())
                    .containsExactlyInAnyOrder("code", "message");
        }
        assertThat(result.getResponse().getContentType())
                .startsWith(MediaType.APPLICATION_JSON_VALUE);
        assertResponseSafe(result.getResponse(), sensitiveMarkers());
    }

    private static void assertResponseSafe(
            MockHttpServletResponse response,
            String... forbiddenMarkers) throws Exception {
        String headers = response.getHeaderNames().stream()
                .flatMap(name -> response.getHeaders(name).stream()
                        .map(value -> name + ":" + value))
                .collect(Collectors.joining(System.lineSeparator()));
        String output = response.getContentAsString(StandardCharsets.UTF_8)
                + System.lineSeparator()
                + headers;
        assertThat(response.getStatus()).isNotEqualTo(500);
        assertThat(response.getHeader(HttpHeaders.LOCATION)).isNull();
        assertThat(headers.toLowerCase()).doesNotContain("authorization:");
        assertThat(output).doesNotContain(
                "UnrecognizedPropertyException",
                "HttpMessageNotReadableException",
                "DataIntegrityViolationException",
                "org.postgresql",
                "jdbc:postgresql:",
                "constraint",
                "stacktrace",
                "C:\\",
                "/workspace/");
        assertThat(output).doesNotContain(forbiddenMarkers);
    }

    private static ListAppender<ILoggingEvent> captureLogs() {
        Logger root =
                (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        root.addAppender(appender);
        return appender;
    }

    private static void stopCapturing(
            ListAppender<ILoggingEvent> appender) {
        Logger root =
                (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
        root.detachAppender(appender);
        appender.stop();
    }

    private static void assertCapturedLogsSafe(
            ListAppender<ILoggingEvent> appender,
            String... forbiddenMarkers) {
        String output = appender.list.stream()
                .map(event -> event.getFormattedMessage()
                        + System.lineSeparator()
                        + ThrowableProxyUtil.asString(
                                event.getThrowableProxy()))
                .collect(Collectors.joining(System.lineSeparator()));
        assertThat(output).doesNotContain(forbiddenMarkers);
    }

    private static void assertNoWarningOrErrorLogs(
            ListAppender<ILoggingEvent> appender) {
        assertThat(appender.list)
                .noneMatch(event -> event.getLevel()
                        .isGreaterOrEqual(Level.WARN));
    }

    private static String[] sensitiveMarkers() {
        return new String[] {
                BODY_CANARY,
                platformToken,
                tenantToken,
                platformTenantToken,
                activationCredential,
                TENANT_ADMIN_PASSWORD,
                PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD
        };
    }

    private static long successfulAuditCount() throws Exception {
        return FIXTURE.singleLong("""
                SELECT (
                    SELECT count(*) FROM audit_logs
                    WHERE action IN (
                        'iam.login.succeeded',
                        'iam.user.created',
                        'iam.user.activated',
                        'order.created'
                    )
                ) + (
                    SELECT count(*) FROM platform_admin_audit_logs
                    WHERE action IN (
                        'platform_admin.login.succeeded',
                        'platform_admin.password_credential.redeemed',
                        'platform_admin.tenant.created'
                    )
                )
                """);
    }

    private static long auditCanaryCount() throws Exception {
        return FIXTURE.singleLong("""
                SELECT (
                    SELECT count(*) FROM audit_logs
                    WHERE details::text LIKE
                        '%resource-boundary-request-body-password%'
                ) + (
                    SELECT count(*) FROM platform_admin_audit_logs
                    WHERE details::text LIKE
                        '%resource-boundary-request-body-password%'
                )
                """);
    }

    private record ListEndpoint(
            Function<Void, MockHttpServletRequestBuilder> factory,
            String token,
            int maxSize) {

        MockHttpServletRequestBuilder request() {
            return factory.apply(null);
        }
    }

    private record SearchEndpoint(
            Function<Void, MockHttpServletRequestBuilder> factory,
            String token,
            String parameter,
            int maxLength) {

        MockHttpServletRequestBuilder request() {
            return factory.apply(null);
        }
    }

    private record MediaTypeEndpoint(
            Function<Void, MockHttpServletRequestBuilder> factory,
            String body,
            boolean detailsEnvelope) {

        MockHttpServletRequestBuilder request() {
            return factory.apply(null);
        }
    }
}
