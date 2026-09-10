package cn.xzkj.erp.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.read.ListAppender;
import com.jayway.jsonpath.JsonPath;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.stream.Collectors;
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
class DynamicCodeExecutionSurfacePostgresql16GateTest {

    private static final String TENANT_CODE = "dynamic_surface_tenant";
    private static final String TENANT_ADMIN_EMAIL =
            "dynamic-surface-admin@example.invalid";
    private static final String TENANT_ADMIN_PASSWORD =
            "dynamic-surface-tenant-password";
    private static final String TYPE_CANARY = "java.lang.ProcessBuilder";
    private static final String NESTED_TYPE_CANARY =
            "com.example.XzErpNestedTypeCanary";
    private static final String EXPRESSION_CANARY =
            "${T(java.lang.Runtime).getRuntime().exec('xz-erp-process-canary')}";
    private static final String JNDI_CANARY =
            "jndi:ldap://127.0.0.1:9/xz-erp-jndi-canary";
    private static final String LOG_LOOKUP_CANARY =
            "${jndi:ldap://127.0.0.1:9/xz-erp-log-lookup-canary}";
    private static final String PROCESS_CANARY =
            "new java.lang.ProcessBuilder('xz-erp-process-canary').start()";
    private static final String SQL_CANARY =
            "xz-erp-sql-canary' OR 1=1 --";
    private static final String XXE_SYSTEM_ID = "urn:xz-erp:xxe-canary";
    private static final Set<String> SAFE_BAD_REQUEST_CODES =
            Set.of("invalid_request", "validation_failed");
    private static final PostgresqlApiFixture FIXTURE =
            new PostgresqlApiFixture();

    private static MockMvc mockMvc;
    private static String platformToken;
    private static String tenantToken;

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
                                 "name":"Dynamic Surface Tenant",
                                 "adminEmail":"%s",
                                 "adminDisplayName":"Dynamic Surface Admin",
                                 "adminInitialPassword":"%s"}
                                 """.formatted(
                                     TENANT_CODE,
                                     TENANT_ADMIN_EMAIL,
                                     TENANT_ADMIN_PASSWORD)))
                .andExpect(status().isCreated())
                .andReturn();

        UUID tenantId = UUID.fromString(JsonPath.read(
                tenant.getResponse().getContentAsString(),
                "$.tenant.id"));
        FIXTURE.enableErp(tenantId);

        tenantToken = accessToken(mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"tenantCode":"%s","email":"%s",
                                 "password":"%s"}
                                 """.formatted(
                                    TENANT_CODE,
                                    TENANT_ADMIN_EMAIL,
                                    TENANT_ADMIN_PASSWORD)))
                .andExpect(status().isOk())
                .andReturn());

    }

    @AfterAll
    static void stop() {
        FIXTURE.close();
    }

    @Test
    @Order(1)
    void runsRealSpringOnOneUsePostgresql16() throws Exception {
        assertThat(FIXTURE.imageName()).isEqualTo("postgres:16-alpine");
        assertThat(FIXTURE.singleString("SHOW server_version"))
                .startsWith("16.");
        assertThat(FIXTURE.isRunning()).isTrue();
    }

    @Test
    @Order(2)
    void rootAndNestedJacksonTypeHintsFailClosedAcrossInputDomains()
            throws Exception {
        DatabaseSnapshot before = snapshot();
        ListAppender<ILoggingEvent> logs = captureLogs();
        try {
            for (Endpoint endpoint : typeHintEndpoints()) {
                MvcResult result = mockMvc.perform(endpoint.request()
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(endpoint.body()))
                        .andExpect(status().isBadRequest())
                        .andReturn();
                assertSafeBadRequest(result);
            }
            assertNoDatabaseMutation(before);
            assertCapturedLogsSafe(logs);
        } finally {
            stopCapturing(logs);
        }
    }

    @Test
    @Order(3)
    void xmlAndExternalEntityPayloadsAreRejectedBeforeParsing()
            throws Exception {
        DatabaseSnapshot before = snapshot();
        ListAppender<ILoggingEvent> logs = captureLogs();
        try {
            for (Endpoint endpoint : xmlEndpoints()) {
                MvcResult result = mockMvc.perform(endpoint.request()
                                .contentType(MediaType.APPLICATION_XML)
                                .content(xmlBody()))
                        .andExpect(status().isUnsupportedMediaType())
                        .andReturn();
                assertSafeUnsupportedMediaType(result);
            }
            assertNoDatabaseMutation(before);
            assertCapturedLogsSafe(logs);
        } finally {
            stopCapturing(logs);
        }
    }

    @Test
    @Order(4)
    void expressionJndiProcessSqlAndLogLookupCanariesFailClosed()
            throws Exception {
        DatabaseSnapshot before = snapshot();
        ListAppender<ILoggingEvent> logs = captureLogs();
        try {
            for (Endpoint endpoint : executionCanaryEndpoints()) {
                MvcResult result = mockMvc.perform(endpoint.request()
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(endpoint.body()))
                        .andExpect(status().isBadRequest())
                        .andReturn();
                assertSafeBadRequest(result);
            }
            assertNoDatabaseMutation(before);
            assertCapturedLogsSafe(logs);
        } finally {
            stopCapturing(logs);
        }
    }

    private static List<Endpoint> typeHintEndpoints() {
        return List.of(
                new Endpoint(
                        () -> authorized(
                                post("/api/v1/iam/members"),
                                tenantToken),
                        """
                        {"username":"dynamic_hint_member",
                         "displayName":"Rejected",
                         "@class":"%s"}
                        """.formatted(TYPE_CANARY)),
                new Endpoint(
                        () -> authorized(
                                post("/api/v1/platform-center/platforms"),
                                tenantToken),
                        """
                        {"code":"DYNAMIC_HINT_PLATFORM",
                         "displayName":"Rejected",
                         "@type":"%s"}
                        """.formatted(TYPE_CANARY)),
                new Endpoint(
                        () -> authorized(
                                post("/api/v1/product-center/spus"),
                                tenantToken),
                        """
                        {"businessCode":"DYNAMIC_HINT_PRODUCT",
                         "name":"Rejected",
                         "nested":{"@class":"%s"}}
                        """.formatted(NESTED_TYPE_CANARY)),
                new Endpoint(
                        () -> authorized(
                                post("/api/v1/order-center/orders"),
                                tenantToken),
                        """
                        {"shopId":"%s",
                         "externalOrderRef":"DYNAMIC-HINT-ORDER",
                         "idempotencyKey":"dynamic-hint-order",
                         "currency":"CNY","placedAt":"2026-01-02T03:04:05Z",
                         "lines":[{
                           "externalLineRef":"dynamic-hint-line",
                           "titleSnapshot":"Rejected","quantity":1,
                           "unitPriceMinor":1,"currency":"CNY",
                           "@type":"%s"}]}
                        """.formatted(UUID.randomUUID(), NESTED_TYPE_CANARY)));
    }

    private static List<Endpoint> executionCanaryEndpoints() {
        return List.of(
                new Endpoint(
                        () -> authorized(
                                post("/api/v1/iam/members"),
                                tenantToken),
                        """
                        {"username":"dynamic_expression_member",
                         "displayName":"Rejected",
                         "expression":"%s"}
                        """.formatted(EXPRESSION_CANARY)),
                new Endpoint(
                        () -> authorized(
                                post("/api/v1/platform-center/platforms"),
                                tenantToken),
                        """
                        {"code":"DYNAMIC_JNDI_PLATFORM",
                         "displayName":"Rejected",
                         "lookup":"%s"}
                        """.formatted(JNDI_CANARY)),
                new Endpoint(
                        () -> authorized(
                                post("/api/v1/product-center/spus"),
                                tenantToken),
                        """
                        {"businessCode":"DYNAMIC_LOG_PRODUCT",
                         "name":"Rejected",
                         "description":"%s",
                         "template":"%s"}
                        """.formatted(LOG_LOOKUP_CANARY, EXPRESSION_CANARY)),
                new Endpoint(
                        () -> authorized(
                                post("/api/v1/order-center/orders"),
                                tenantToken),
                        """
                        {"shopId":"%s",
                         "externalOrderRef":"DYNAMIC-PROCESS-ORDER",
                         "idempotencyKey":"dynamic-process-order",
                         "currency":"CNY","placedAt":"2026-01-02T03:04:05Z",
                         "lines":[{
                           "externalLineRef":"dynamic-process-line",
                           "titleSnapshot":"Rejected","quantity":1,
                           "unitPriceMinor":1,"currency":"CNY"}],
                         "process":"%s"}
                        """.formatted(UUID.randomUUID(), PROCESS_CANARY)));
    }

    private static List<Endpoint> xmlEndpoints() {
        return List.of(
                new Endpoint(
                        () -> authorized(
                                post("/api/v1/iam/members"),
                                tenantToken),
                        ""),
                new Endpoint(
                        () -> authorized(
                                post("/api/v1/platform-center/platforms"),
                                tenantToken),
                        ""),
                new Endpoint(
                        () -> authorized(
                                post("/api/v1/product-center/spus"),
                                tenantToken),
                        ""),
                new Endpoint(
                        () -> authorized(
                                post("/api/v1/order-center/orders"),
                                tenantToken),
                        ""));
    }

    private static String xmlBody() {
        return """
                <?xml version="1.0"?>
                <!DOCTYPE request [
                  <!ENTITY xzErpCanary SYSTEM "urn:xz-erp:xxe-canary">
                ]>
                <request>
                  <name>&xzErpCanary;</name>
                </request>
                """;
    }

    private static DatabaseSnapshot snapshot() throws Exception {
        return new DatabaseSnapshot(
                FIXTURE.singleLong("SELECT count(*) FROM auth_sessions"),
                FIXTURE.singleLong("SELECT count(*) FROM users"),
                FIXTURE.singleLong("SELECT count(*) FROM platform_catalog"),
                FIXTURE.singleLong("SELECT count(*) FROM tenant_product_spus"),
                FIXTURE.singleLong("SELECT count(*) FROM tenant_orders"),
                FIXTURE.singleLong("SELECT count(*) FROM tenant_suppliers"),
                FIXTURE.singleLong("""
                        SELECT count(*) FROM audit_logs
                        WHERE action <>
                            'platform_admin.tenant_write_attempted'
                        """),
                FIXTURE.singleLong("""
                        SELECT count(*) FROM audit_logs
                        WHERE action =
                            'platform_admin.tenant_write_attempted'
                        """),
                FIXTURE.singleLong(
                        "SELECT count(*) FROM platform_admin_audit_logs"),
                FIXTURE.singleLong(
                        "SELECT count(*) FROM iam_login_throttles"),
                FIXTURE.singleLong(
                        "SELECT count(*) FROM platform_admin_login_throttles"));
    }

    private static void assertNoDatabaseMutation(DatabaseSnapshot before)
            throws Exception {
        DatabaseSnapshot after = snapshot();
        assertThat(after.sessions()).isEqualTo(before.sessions());
        assertThat(after.users()).isEqualTo(before.users());
        assertThat(after.platforms()).isEqualTo(before.platforms());
        assertThat(after.products()).isEqualTo(before.products());
        assertThat(after.orders()).isEqualTo(before.orders());
        assertThat(after.suppliers()).isEqualTo(before.suppliers());
        assertThat(after.successTenantAudits())
                .isEqualTo(before.successTenantAudits());
        assertThat(after.attemptedTenantAudits())
                .isEqualTo(before.attemptedTenantAudits());
        assertThat(after.platformAudits())
                .isEqualTo(before.platformAudits());
        assertThat(after.tenantLoginThrottles())
                .isEqualTo(before.tenantLoginThrottles());
        assertThat(after.platformLoginThrottles())
                .isEqualTo(before.platformLoginThrottles());
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE action =
                    'platform_admin.tenant_write_attempted'
                  AND (
                    resource_type <> 'api_request'
                    OR details <> '{"method":"POST"}'::jsonb
                  )
                """)).isZero();
        for (String canary : canaries()) {
            assertThat(FIXTURE.singleLong("""
                    SELECT count(*)
                    FROM audit_logs
                    WHERE details::text LIKE ?
                    """, "%" + canary + "%"))
                    .as("tenant audit must not contain a canary")
                    .isZero();
            assertThat(FIXTURE.singleLong("""
                    SELECT count(*)
                    FROM platform_admin_audit_logs
                    WHERE details::text LIKE ?
                    """, "%" + canary + "%"))
                    .as("platform audit must not contain a canary")
                    .isZero();
        }
    }

    private static void assertSafeBadRequest(MvcResult result)
            throws Exception {
        Map<String, Object> error = JsonPath.read(body(result), "$");
        assertThat(error.keySet())
                .isSubsetOf("code", "message", "details")
                .contains("code", "message");
        assertThat(error.get("code")).isIn(SAFE_BAD_REQUEST_CODES);
        assertResponseSafe(result.getResponse());
    }

    private static void assertSafeUnsupportedMediaType(MvcResult result)
            throws Exception {
        Map<String, Object> error = JsonPath.read(body(result), "$");
        assertThat(error.get("code")).isEqualTo("invalid_request");
        assertThat(error.get("message"))
                .isEqualTo("Content type is not supported");
        assertThat(error.keySet())
                .isSubsetOf("code", "message", "details");
        assertResponseSafe(result.getResponse());
    }

    private static void assertResponseSafe(
            MockHttpServletResponse response) throws Exception {
        String headers = response.getHeaderNames().stream()
                .flatMap(name -> response.getHeaders(name).stream()
                        .map(value -> name + ":" + value))
                .collect(Collectors.joining(System.lineSeparator()));
        String output = response.getContentAsString()
                + System.lineSeparator()
                + headers;
        assertThat(response.getStatus()).isIn(400, 415);
        assertThat(response.getHeader(HttpHeaders.LOCATION)).isNull();
        assertThat(output).doesNotContain(canaries().toArray(String[]::new));
        assertThat(output).doesNotContain(
                "Exception",
                "StackTrace",
                "java.lang.",
                "org.springframework.",
                "org.postgresql.",
                "classpath",
                "target/classes",
                "jdbc:postgresql:",
                "C:\\",
                "/workspace/");
    }

    private static ListAppender<ILoggingEvent> captureLogs() {
        Logger root = (Logger) LoggerFactory.getLogger(
                Logger.ROOT_LOGGER_NAME);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        root.addAppender(appender);
        return appender;
    }

    private static void stopCapturing(
            ListAppender<ILoggingEvent> appender) {
        Logger root = (Logger) LoggerFactory.getLogger(
                Logger.ROOT_LOGGER_NAME);
        root.detachAppender(appender);
        appender.stop();
    }

    private static void assertCapturedLogsSafe(
            ListAppender<ILoggingEvent> appender) {
        String output = appender.list.stream()
                .map(event -> event.getFormattedMessage()
                        + System.lineSeparator()
                        + ThrowableProxyUtil.asString(
                                event.getThrowableProxy()))
                .collect(Collectors.joining(System.lineSeparator()));
        assertThat(output).doesNotContain(canaries().toArray(String[]::new));
        assertThat(output).doesNotContain(
                "StackTrace",
                "classpath",
                "target/classes",
                "jdbc:postgresql:",
                "C:\\",
                "/workspace/");
        assertThat(appender.list)
                .noneMatch(event ->
                        event.getLevel().isGreaterOrEqual(Level.WARN));
    }

    private static List<String> canaries() {
        return List.of(
                TYPE_CANARY,
                NESTED_TYPE_CANARY,
                EXPRESSION_CANARY,
                JNDI_CANARY,
                LOG_LOOKUP_CANARY,
                PROCESS_CANARY,
                SQL_CANARY,
                XXE_SYSTEM_ID);
    }

    private static String accessToken(MvcResult result) throws Exception {
        return JsonPath.read(body(result), "$.accessToken");
    }

    private static MockHttpServletRequestBuilder authorized(
            MockHttpServletRequestBuilder request,
            String token) {
        return request.header(
                HttpHeaders.AUTHORIZATION,
                "Bearer " + token);
    }

    private static String body(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString();
    }

    private record Endpoint(
            Supplier<MockHttpServletRequestBuilder> requestSupplier,
            String body) {

        MockHttpServletRequestBuilder request() {
            return requestSupplier.get();
        }
    }

    private record DatabaseSnapshot(
            long sessions,
            long users,
            long platforms,
            long products,
            long orders,
            long suppliers,
            long successTenantAudits,
            long attemptedTenantAudits,
            long platformAudits,
            long tenantLoginThrottles,
            long platformLoginThrottles) {
    }
}
