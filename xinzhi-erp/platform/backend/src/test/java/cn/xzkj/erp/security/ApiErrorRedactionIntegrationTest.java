package cn.xzkj.erp.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.read.ListAppender;
import com.jayway.jsonpath.JsonPath;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
class ApiErrorRedactionIntegrationTest {

    private static final String TENANT_CODE = "error_gate_tenant";
    private static final String TENANT_ADMIN_USERNAME =
            "error_gate_user@example.test";
    private static final String TENANT_ADMIN_PASSWORD =
            "error-gate-tenant-admin-password";
    private static final Set<String> SAFE_ERROR_CODES =
            Set.of("invalid_request", "validation_failed");
    private static final Set<String> SAFE_ERROR_MESSAGES =
            Set.of("Request is invalid", "The request is invalid",
                    "Request body is invalid",
                    "Request validation failed");
    private static final PostgresqlApiFixture FIXTURE =
            new PostgresqlApiFixture();
    private static final List<String> REJECTED_CANARIES =
            new ArrayList<>();

    private static MockMvc mockMvc;
    private static String platformToken;
    private static String activationCredential;
    private static String tenantToken;
    private static String platformTenantToken;
    private static UUID tenantId;
    private static UUID platformId;
    private static UUID shopifyPlatformId;
    private static UUID shopId;
    private static UUID spuId;
    private static UUID skuId;

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
    void runsAgainstEphemeralPostgresql16() throws Exception {
        assertThat(FIXTURE.isRunning()).isTrue();
        assertThat(FIXTURE.imageName()).isEqualTo("postgres:16-alpine");
        assertThat(FIXTURE.jdbcUrl()).startsWith("jdbc:postgresql:");
        assertThat(FIXTURE.singleString("SHOW server_version"))
                .startsWith("16.");
        assertThat(FIXTURE.property("spring.web.error.include-path"))
                .isEqualTo("never");
    }

    @Test
    @Order(2)
    void identityAndPlatformRequestsRejectUnknownFieldsButAllowContract()
            throws Exception {
        ListAppender<ILoggingEvent> logs = captureDefaultLogs();
        try {
            String platformLoginCanary = canary("platform-login");
            assertUnknownFieldRejected(
                    post("/api/v1/platform-admin/auth/login"),
                    """
                            {"username":"%s","password":"%s",
                             "../../Authorization":"%s"}
                            """.formatted(
                                PostgresqlApiFixture.SYSTEM_ADMIN_USERNAME,
                                PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD,
                                platformLoginCanary),
                    platformLoginCanary,
                    PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD);

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

            String tenantCanary = canary("platform-tenant");
            assertUnknownFieldRejected(
                    authorized(post("/api/v1/platform-admin/tenants"),
                            platformToken),
                    """
                            {"code":"error_gate_rejected",
                             "name":"Rejected enterprise",
                             "adminEmail":"rejected_admin@example.test",
                             "adminDisplayName":"Rejected Admin",
                             "adminInitialPassword":"rejected-admin-password",
                             "unknownCredentialRef":"%s"}
                            """.formatted(tenantCanary),
                    tenantCanary,
                    platformToken);

            MvcResult createdTenant = mockMvc.perform(
                            authorized(
                                    post("/api/v1/platform-admin/tenants"),
                                    platformToken)
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("""
                                            {"code":"%s",
                                             "name":"Error Gate Tenant",
                                             "adminEmail":"%s",
                                             "adminDisplayName":
                                                 "Error Gate Admin",
                                             "adminInitialPassword":"%s"}
                                             """.formatted(
                                                 TENANT_CODE,
                                                 TENANT_ADMIN_USERNAME,
                                                 TENANT_ADMIN_PASSWORD)))
                    .andExpect(status().isCreated())
                    .andReturn();
            String createdTenantBody = body(createdTenant);
            tenantId = UUID.fromString(JsonPath.read(
                    createdTenantBody,
                    "$.tenant.id"));
            FIXTURE.enableErp(tenantId);
            activationCredential = canary("legacy-credential-marker");

            String redeemCanary = canary("iam-credential-redeem");
            assertUnknownFieldRejected(
                    post("/api/v1/auth/password-credentials/redeem"),
                    """
                            {"token":"%s","newPassword":"%s",
                             "unexpectedSecret":"%s"}
                            """.formatted(
                                activationCredential,
                                TENANT_ADMIN_PASSWORD,
                                redeemCanary),
                    redeemCanary,
                    activationCredential,
                    TENANT_ADMIN_PASSWORD);

            String loginCanary = canary("iam-auth-login");
            assertUnknownFieldRejected(
                    post("/api/v1/auth/login"),
                    """
                            {"tenantCode":"%s","username":"%s",
                             "password":"%s","sessionToken":"%s"}
                            """.formatted(
                                TENANT_CODE,
                                TENANT_ADMIN_USERNAME,
                                TENANT_ADMIN_PASSWORD,
                                loginCanary),
                    loginCanary,
                    TENANT_ADMIN_PASSWORD);

            tenantToken = accessToken(mockMvc.perform(post(
                                    "/api/v1/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"tenantCode":"%s","username":"%s",
                                     "password":"%s"}
                                    """.formatted(
                                        TENANT_CODE,
                                        TENANT_ADMIN_USERNAME,
                                        TENANT_ADMIN_PASSWORD)))
                    .andExpect(status().isOk())
                    .andReturn());

            MvcResult entered = mockMvc.perform(authorized(
                                    post("/api/v1/platform-admin/tenants/"
                                            + tenantId
                                            + "/enter"),
                                    platformToken))
                    .andExpect(status().isOk())
                    .andReturn();
            platformTenantToken = accessToken(entered);

            String memberCanary = canary("iam-admin-member");
            assertUnknownFieldRejected(
                    authorized(post("/api/v1/iam/members"), tenantToken)
                            .header(
                                    "X-Request-Id",
                                    "gate-rejected-iam-member"),
                    """
                             {"email":"gate_rejected_member@example.test",
                              "displayName":"Rejected Member",
                              "initialPassword":"rejected-member-password",
                              "roleIds":[],
                              "unknownPassword":"%s"}
                            """.formatted(memberCanary),
                    memberCanary,
                    tenantToken);

            mockMvc.perform(authorized(
                                    post("/api/v1/iam/members"),
                                    tenantToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"email":"gate_valid_member@example.test",
                                     "displayName":"Valid Member",
                                     "initialPassword":"valid-member-password",
                                     "roleIds":[]}
                                    """))
                    .andExpect(status().isCreated());

            assertCapturedLogsSafe(logs);
        } finally {
            stopCapturing(logs);
        }
    }

    @Test
    @Order(3)
    void businessRequestsRejectUnknownFieldsButAllowApprovedShapes()
            throws Exception {
        ListAppender<ILoggingEvent> logs = captureDefaultLogs();
        try {
            String platformCanary = canary("platform-catalog");
            assertUnknownFieldRejected(
                    authorized(post(
                                    "/api/v1/platform-center/platforms"),
                            platformTenantToken),
                    """
                            {"code":"ERROR_GATE_REJECTED",
                             "displayName":"Rejected Platform",
                             "description":null,
                             "credentialRef":"%s"}
                            """.formatted(platformCanary),
                    platformCanary,
                    platformTenantToken);
            platformId = createdId(authorized(
                            post("/api/v1/platform-center/platforms"),
                            platformTenantToken)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                            {"code":"ERROR_GATE_APPROVED",
                             "displayName":"Approved Platform",
                             "description":"Approved platform"}
                            """));
            shopifyPlatformId = UUID.fromString(FIXTURE.singleString("""
                    SELECT id::text
                    FROM platform_catalog
                    WHERE code = 'SHOPIFY'
                    """));

            String shopCanary = canary("shop");
            assertUnknownFieldRejected(
                    authorized(post("/api/v1/platform-center/shops"),
                            platformTenantToken)
                            .header("X-Request-Id", "gate-rejected-shop"),
                    """
                            {"platformId":"%s",
                             "externalShopRef":"gate-rejected-shop",
                             "displayName":"Rejected Shop",
                             "authorizationToken":"%s"}
                            """.formatted(shopifyPlatformId, shopCanary),
                    shopCanary,
                    platformTenantToken);
            shopId = createdId(authorized(
                            post("/api/v1/platform-center/shops"),
                            platformTenantToken)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                            {"platformId":"%s",
                             "externalShopRef":"gate-approved-shop"}
                            """.formatted(shopifyPlatformId)));

            String productCanary = canary("product");
            String longField = "x".repeat(512);
            assertUnknownFieldRejected(
                    authorized(post("/api/v1/product-center/spus"),
                            platformTenantToken),
                    """
                            {"businessCode":"ERROR_GATE_REJECTED_PRODUCT",
                             "name":"Rejected Product",
                             "%s":"%s"}
                            """.formatted(longField, productCanary),
                    productCanary,
                    platformTenantToken,
                    longField);
            spuId = createdId(authorized(
                            post("/api/v1/product-center/spus"),
                            platformTenantToken)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                            {"businessCode":"ERROR_GATE_PRODUCT",
                             "name":"Approved Product",
                             "brandName":null,"productNote":null}
                            """));
            skuId = createdId(authorized(
                            post("/api/v1/product-center/spus/"
                                    + spuId
                                    + "/skus"),
                            platformTenantToken)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("""
                            {"businessCode":"ERROR_GATE_SKU",
                             "name":"Approved SKU",
                             "variantSummary":null}
                            """));

            String orderCanary = canary("order");
            assertUnknownFieldRejected(
                    authorized(post("/api/v1/order-center/orders"),
                            platformTenantToken)
                            .header("X-Request-Id", "gate-rejected-order"),
                    orderBody(
                            "ERROR-GATE-REJECTED-ORDER",
                            "gate-rejected-order",
                            orderCanary),
                    orderCanary,
                    platformTenantToken);
            mockMvc.perform(authorized(
                                    post("/api/v1/order-center/orders"),
                                    platformTenantToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(orderBody(
                                    "ERROR-GATE-APPROVED-ORDER",
                                    "gate-approved-order",
                                    null)))
                    .andExpect(status().isCreated());

            String warehouseCanary = canary("warehouse");
            assertUnknownFieldRejected(
                    authorized(post(
                                    "/api/v1/warehouse-center/warehouses"),
                            platformTenantToken),
                    """
                            {"businessCode":"ERROR_GATE_REJECTED_WAREHOUSE",
                             "name":"Rejected Warehouse",
                             "databaseUsername":"%s"}
                            """.formatted(warehouseCanary),
                    warehouseCanary,
                    platformTenantToken);
            mockMvc.perform(authorized(
                                    post("/api/v1/warehouse-center/warehouses"),
                                    platformTenantToken)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"businessCode":"ERROR_GATE_WAREHOUSE",
                                     "name":"Approved Warehouse"}
                                    """))
                    .andExpect(status().isCreated());

            String malformedCanary = canary("malformed-json");
            assertUnknownFieldRejected(
                    authorized(post("/api/v1/product-center/spus"),
                            platformTenantToken),
                    """
                            {"businessCode":"ERROR_GATE_MALFORMED",
                             "name":"Malformed","secret":"%s"
                            """.formatted(malformedCanary),
                    malformedCanary,
                    platformTenantToken);

            assertCapturedLogsSafe(logs);
        } finally {
            stopCapturing(logs);
        }
    }

    @Test
    @Order(4)
    void invalidParametersAndAuthorizationFailuresAreSafe()
            throws Exception {
        assertSafeError(mockMvc.perform(authorized(
                                get("/api/v1/product-center/spus/not-a-uuid"),
                                tenantToken))
                        .andExpect(status().isBadRequest())
                        .andReturn(),
                tenantToken,
                "not-a-uuid");
        assertSafeError(mockMvc.perform(authorized(
                                get("/api/v1/order-center/orders")
                                        .queryParam("page", "-1")
                                        .queryParam("size", "999999"),
                                tenantToken))
                        .andExpect(status().isBadRequest())
                        .andReturn(),
                tenantToken,
                "999999");
        MvcResult forbidden = mockMvc.perform(authorized(
                                get("/api/v1/product-center/spus"),
                                platformToken))
                .andExpect(status().isForbidden())
                .andReturn();
        assertStrictSecurityError(
                forbidden,
                "permission_denied",
                "Permission is required",
                platformToken);
    }

    @Test
    @Order(5)
    void rejectedRequestsLeaveNoStateOrSensitiveAuditMaterial()
            throws Exception {
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM tenants
                WHERE code = 'error_gate_rejected'
                """)).isZero();
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM users
                WHERE email = 'gate_rejected_member@example.test'
                """)).isZero();
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM platform_catalog
                WHERE code = 'ERROR_GATE_REJECTED'
                """)).isZero();
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM tenant_shops
                WHERE external_shop_ref = 'gate-rejected-shop'
                """)).isZero();
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM tenant_product_spus
                WHERE business_code IN (
                    'ERROR_GATE_REJECTED_PRODUCT',
                    'ERROR_GATE_MALFORMED'
                )
                """)).isZero();
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM tenant_orders
                WHERE external_order_ref =
                      'ERROR-GATE-REJECTED-ORDER'
                """)).isZero();
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM tenant_warehouses
                WHERE business_code =
                      'ERROR_GATE_REJECTED_WAREHOUSE'
                """)).isZero();
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE request_id LIKE 'gate-rejected-%'
                  AND action <>
                      'platform_admin.tenant_write_attempted'
                """)).isZero();
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE request_id LIKE 'gate-rejected-%'
                  AND action =
                      'platform_admin.tenant_write_attempted'
                  AND resource_type = 'api_request'
                  AND details = '{"method":"POST"}'::jsonb
                """)).isEqualTo(2);
        assertThat(FIXTURE.singleLong("""
                SELECT count(*)
                FROM audit_logs
                WHERE details::text ~*
                    '(password|token|credential|jdbc:|constraint|'
                    'request.?body)'
                """)).isZero();
        for (String marker : sensitiveAuditMarkers()) {
            assertThat(FIXTURE.singleLong("""
                    SELECT count(*)
                    FROM audit_logs
                    WHERE details::text LIKE ?
                    """, "%" + marker + "%"))
                    .as("audit details must not contain %s", marker)
                    .isZero();
        }
    }

    private static String orderBody(
            String externalOrderRef,
            String idempotencyKey,
            String unknownCanary) {
        String unknown = unknownCanary == null
                ? ""
                : ",\"internalSql\":\"" + unknownCanary + "\"";
        return """
                {"shopId":"%s",
                 "externalOrderRef":"%s",
                 "idempotencyKey":"%s",
                 "currency":"CNY",
                 "buyerReference":"Approved Buyer",
                 "placedAt":"2026-01-02T03:04:05Z",
                 "lines":[{
                   "skuId":"%s",
                   "externalListingRef":"gate-listing",
                   "externalVariantRef":"gate-variant",
                   "externalLineRef":"gate-line",
                   "titleSnapshot":"Approved Line",
                   "quantity":1,"unitPriceMinor":9900,
                   "currency":"CNY"
                 }]%s}
                """.formatted(
                    shopId,
                    externalOrderRef,
                    idempotencyKey,
                    skuId,
                    unknown);
    }

    private static String canary(String module) {
        String value = "api-error-gate-" + module
                + "-password-token-credential-jdbc-sql-path";
        REJECTED_CANARIES.add(value);
        return value;
    }

    private static String accessToken(MvcResult result) throws Exception {
        return JsonPath.read(body(result), "$.accessToken");
    }

    private static UUID createdId(
            MockHttpServletRequestBuilder request) throws Exception {
        MvcResult result = mockMvc.perform(request)
                .andExpect(status().isCreated())
                .andReturn();
        return UUID.fromString(JsonPath.read(body(result), "$.id"));
    }

    private static MockHttpServletRequestBuilder authorized(
            MockHttpServletRequestBuilder request,
            String token) {
        return request.header(
                HttpHeaders.AUTHORIZATION,
                "Bearer " + token);
    }

    private static void assertUnknownFieldRejected(
            MockHttpServletRequestBuilder request,
            String requestBody,
            String... forbiddenMarkers) throws Exception {
        MvcResult result = mockMvc.perform(request
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isBadRequest())
                .andReturn();
        assertSafeError(result, forbiddenMarkers);
    }

    private static void assertSafeError(
            MvcResult result,
            String... forbiddenMarkers) throws Exception {
        String responseBody = body(result);
        Map<String, Object> error = JsonPath.read(responseBody, "$");
        assertThat(error.keySet())
                .isSubsetOf("code", "message", "details")
                .contains("code", "message");
        assertThat(error.get("code")).isIn(SAFE_ERROR_CODES);
        assertThat(error.get("message")).isIn(SAFE_ERROR_MESSAGES);
        if (error.containsKey("details")) {
            assertThat(error.get("details")).isEqualTo(Map.of());
        }
        assertResponseDoesNotExpose(
                result.getResponse(),
                forbiddenMarkers);
    }

    private static void assertStrictSecurityError(
            MvcResult result,
            String code,
            String message,
            String... forbiddenMarkers) throws Exception {
        Map<String, Object> error = JsonPath.read(body(result), "$");
        assertThat(error)
                .containsExactlyInAnyOrderEntriesOf(Map.of(
                        "code", code,
                        "message", message));
        assertResponseDoesNotExpose(
                result.getResponse(),
                forbiddenMarkers);
    }

    private static void assertResponseDoesNotExpose(
            MockHttpServletResponse response,
            String... forbiddenMarkers) throws Exception {
        String headers = response.getHeaderNames().stream()
                .flatMap(name -> response.getHeaders(name).stream()
                        .map(value -> name + ":" + value))
                .collect(Collectors.joining(System.lineSeparator()));
        String output = response.getContentAsString()
                + System.lineSeparator()
                + headers;
        assertThat(response.getHeader(HttpHeaders.LOCATION)).isNull();
        assertThat(headers.toLowerCase())
                .doesNotContain("authorization:");
        assertThat(output)
                .doesNotContain(
                        "UnrecognizedPropertyException",
                        "HttpMessageNotReadableException",
                        "IllegalStateException",
                        "DataIntegrityViolationException",
                        "org.postgresql",
                        "tenant_product_",
                        "uk_",
                        "jdbc:postgresql:",
                        "C:\\",
                        "/workspace/");
        assertThat(output).doesNotContain(forbiddenMarkers);
    }

    private static ListAppender<ILoggingEvent> captureDefaultLogs() {
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
        assertThat(output).doesNotContain(
                REJECTED_CANARIES.toArray(String[]::new));
    }

    private static List<String> sensitiveAuditMarkers() {
        List<String> markers = new ArrayList<>(REJECTED_CANARIES);
        markers.add(PostgresqlApiFixture.SYSTEM_ADMIN_PASSWORD);
        markers.add(TENANT_ADMIN_PASSWORD);
        markers.add(activationCredential);
        markers.add(platformToken);
        markers.add(tenantToken);
        markers.add(platformTenantToken);
        markers.add("jdbc:postgresql:");
        return markers;
    }

    private static String body(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString();
    }
}
