package cn.xzkj.erp.iam.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cn.xzkj.erp.ErpApplication;
import cn.xzkj.erp.testing.BusinessApplicationTestData;
import com.jayway.jsonpath.JsonPath;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer.OrderAnnotation;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.containers.PostgreSQLContainer;

@TestMethodOrder(OrderAnnotation.class)
class IamSessionManagementIntegrationTest {

    private static final String TENANT_A =
            "e0000000-0000-0000-0000-000000000001";
    private static final String TENANT_B =
            "e0000000-0000-0000-0000-000000000002";
    private static final String ORDINARY_USER =
            "e1000000-0000-0000-0000-000000000002";
    private static final String OTHER_USER =
            "e1000000-0000-0000-0000-000000000003";
    private static final String FOREIGN_USER =
            "e1000000-0000-0000-0000-000000000005";
    private static final ConcurrentRequestBarrier REQUEST_BARRIER =
            new ConcurrentRequestBarrier();

    private static PostgreSQLContainer<?> postgres;
    private static ConfigurableApplicationContext context;
    private static MockMvc mockMvc;
    private static String jdbcUrl;
    private static String username;
    private static String password;
    private static String ordinaryTokenOne;
    private static String ordinaryTokenTwo;
    private static String ordinaryTokenThree;
    private static String otherToken;
    private static String foreignToken;

    @BeforeAll
    static void start() throws Exception {
        configureDatabase();
        Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .load()
                .migrate();
        seedContract();
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource(
                "iam-session-management-integration-test",
                Map.of(
                        "server.port", "0",
                        "spring.datasource.url", jdbcUrl,
                        "spring.datasource.username", username,
                        "spring.datasource.password", password,
                        "erp.environment", "integration-test",
                        // Retired deployment flags must not disable native login or require discovery.
                        "erp.one.oidc.enabled", "true",
                        "erp.one.oidc.issuer", "http://127.0.0.1:9/unavailable-one")));
        context = new SpringApplicationBuilder(ErpApplication.class)
                .web(WebApplicationType.SERVLET)
                .environment(environment)
                .run();
        mockMvc = MockMvcBuilders
                .webAppContextSetup((WebApplicationContext) context)
                .addFilters(
                        context.getBean("springSecurityFilterChain", Filter.class),
                        REQUEST_BARRIER)
                .build();

        ordinaryTokenOne =
                login("phase4_tenant_a", "ordinary_user", "phase4-ordinary-password");
        ordinaryTokenTwo =
                login("phase4_tenant_a", "ordinary_user", "phase4-ordinary-password");
        ordinaryTokenThree =
                login("phase4_tenant_a", "ordinary_user", "phase4-ordinary-password");
        otherToken =
                login("phase4_tenant_a", "other_user", "phase4-other-password");
        foreignToken =
                login("phase4_tenant_b", "foreign_user", "phase4-foreign-password");
    }

    @AfterAll
    static void stop() {
        if (context != null) {
            context.close();
        }
        if (postgres != null) {
            postgres.stop();
        }
    }

    @Test
    @Order(1)
    void listsOnlyOwnMinimalSessionsWithStablePagination() throws Exception {
        mockMvc.perform(get("/api/v1/auth/sessions"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("authentication_required"));

        MvcResult defaultPage = mockMvc.perform(get("/api/v1/auth/sessions")
                        .header("Authorization", bearer(ordinaryTokenOne))
                        .header("X-Tenant-Id", TENANT_B))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.totalPages").value(1))
                .andReturn();

        List<Map<String, Object>> sessions = JsonPath.read(
                defaultPage.getResponse().getContentAsString(),
                "$.items");
        assertThat(sessions).hasSize(3);
        assertThat(sessions)
                .allSatisfy(session -> assertThat(session.keySet()).containsExactlyInAnyOrder(
                        "id",
                        "createdAt",
                        "expiresAt",
                        "revokedAt",
                        "current"));
        assertThat(sessions.stream()
                        .filter(session -> Boolean.TRUE.equals(session.get("current"))))
                .hasSize(1);
        assertThat(sessions.stream()
                        .map(session -> session.get("id").toString()))
                .doesNotContain(currentSessionId(otherToken));

        mockMvc.perform(get("/api/v1/auth/sessions")
                        .header("Authorization", bearer(ordinaryTokenOne))
                        .param("size", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.size").value(2))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.totalPages").value(2));

        mockMvc.perform(get("/api/v1/auth/sessions")
                        .header("Authorization", bearer(ordinaryTokenOne))
                        .param("size", "101"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));

        mockMvc.perform(get("/api/v1/auth/sessions")
                        .header("Authorization", bearer(ordinaryTokenOne))
                        .param("page", "1000001"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));
    }

    @Test
    @Order(3)
    void revokesOnlyOwnSessionIdempotentlyAndInvalidatesCurrentBearer()
            throws Exception {
        String secondSessionId = currentSessionId(ordinaryTokenTwo);
        String otherSessionId = currentSessionId(otherToken);
        String foreignSessionId = currentSessionId(foreignToken);

        mockMvc.perform(delete("/api/v1/auth/sessions/" + secondSessionId)
                        .header("Authorization", bearer(ordinaryTokenOne))
                        .header("X-Request-Id", "phase4-self-revoke"))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", bearer(ordinaryTokenTwo)))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(delete("/api/v1/auth/sessions/" + secondSessionId)
                        .header("Authorization", bearer(ordinaryTokenOne))
                        .header("X-Request-Id", "phase4-self-revoke-repeat"))
                .andExpect(status().isNoContent());
        assertSingleSelfRevocationAudit(secondSessionId);
        MvcResult sessionsAfterRevocation = mockMvc.perform(
                        get("/api/v1/auth/sessions")
                                .header("Authorization", bearer(ordinaryTokenThree))
                                .param("size", "100"))
                .andExpect(status().isOk())
                .andReturn();
        List<Map<String, Object>> sessions = JsonPath.read(
                sessionsAfterRevocation.getResponse().getContentAsString(),
                "$.items");
        assertThat(sessions.stream()
                        .filter(session -> secondSessionId.equals(session.get("id")))
                        .map(session -> session.get("revokedAt")))
                .singleElement()
                .isNotNull();

        mockMvc.perform(delete("/api/v1/auth/sessions/" + otherSessionId)
                        .header("Authorization", bearer(ordinaryTokenOne)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));
        mockMvc.perform(delete("/api/v1/auth/sessions/" + foreignSessionId)
                        .header("Authorization", bearer(ordinaryTokenOne))
                        .header("X-Tenant-Id", TENANT_B))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));
        mockMvc.perform(delete("/api/v1/auth/sessions/" + UUID.randomUUID())
                        .header("Authorization", bearer(ordinaryTokenOne)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));

        String currentSessionId = currentSessionId(ordinaryTokenOne);
        mockMvc.perform(delete("/api/v1/auth/sessions/" + currentSessionId)
                        .header("Authorization", bearer(ordinaryTokenOne)))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/v1/auth/sessions")
                        .header("Authorization", bearer(ordinaryTokenOne)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("authentication_required"));
    }

    @Test
    @Order(5)
    void concurrentOwnRevocationIsAtomicAndAuditedOnce() throws Exception {
        String sourceTokenTwo =
                login("phase4_tenant_a", "ordinary_user", "phase4-ordinary-password");
        String targetToken =
                login("phase4_tenant_a", "ordinary_user", "phase4-ordinary-password");
        String targetSessionId = currentSessionId(targetToken);
        List<String> requestIds = List.of(
                "phase4-concurrent-own-a",
                "phase4-concurrent-own-b");

        String targetPath = "/api/v1/auth/sessions/" + targetSessionId;
        REQUEST_BARRIER.enable(targetPath, 2);
        List<Integer> statuses;
        try {
            statuses = deleteConcurrently(
                    targetPath,
                    List.of(ordinaryTokenThree, sourceTokenTwo),
                    requestIds);
        } finally {
            REQUEST_BARRIER.disable();
        }

        assertThat(statuses).containsExactlyInAnyOrder(204, 204);
        assertSessionRevoked(targetSessionId);
        mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", bearer(targetToken)))
                .andExpect(status().isUnauthorized());
        assertSingleConcurrentRevocationAudit(
                targetSessionId,
                requestIds,
                List.of(ordinaryTokenThree, sourceTokenTwo, targetToken));
    }

    @Test
    @Order(6)
    void concurrentLogoutWithSameBearerIsAtomicAndAuditedOnce() throws Exception {
        String logoutToken =
                login("phase4_tenant_a", "ordinary_user", "phase4-ordinary-password");
        String logoutSessionId = currentSessionId(logoutToken);
        List<String> requestIds = List.of(
                "phase4-concurrent-logout-a",
                "phase4-concurrent-logout-b");

        REQUEST_BARRIER.enable("/api/v1/auth/session", 2);
        List<Integer> statuses;
        try {
            statuses = deleteConcurrently(
                    "/api/v1/auth/session",
                    List.of(logoutToken, logoutToken),
                    requestIds);
        } finally {
            REQUEST_BARRIER.disable();
        }

        assertThat(statuses).containsExactlyInAnyOrder(204, 204);
        assertSessionRevoked(logoutSessionId);
        mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", bearer(logoutToken)))
                .andExpect(status().isUnauthorized());
        assertSingleConcurrentRevocationAudit(
                logoutSessionId,
                requestIds,
                List.of(logoutToken));
    }

    private static String currentSessionId(String accessToken) throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/auth/sessions")
                        .header("Authorization", bearer(accessToken))
                        .param("size", "100"))
                .andExpect(status().isOk())
                .andReturn();
        List<Map<String, Object>> sessions = JsonPath.read(
                result.getResponse().getContentAsString(),
                "$.items");
        return sessions.stream()
                .filter(session -> Boolean.TRUE.equals(session.get("current")))
                .map(session -> session.get("id").toString())
                .findFirst()
                .orElseThrow();
    }

    private static void assertSingleSelfRevocationAudit(String sessionId)
            throws Exception {
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        SELECT actor_user_id::text, request_id, details::text
                        FROM audit_logs
                        WHERE tenant_id = ?::uuid
                          AND action = 'iam.session.revoked'
                          AND resource_type = 'auth_session'
                          AND resource_id = ?
                        """)) {
            statement.setString(1, TENANT_A);
            statement.setString(2, sessionId);
            try (ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getString("actor_user_id"))
                        .isEqualTo(ORDINARY_USER);
                assertThat(result.getString("request_id"))
                        .isEqualTo("phase4-self-revoke");
                assertThat(result.getString("details")).isEqualTo("{}");
                assertThat(result.next()).isFalse();
            }
        }
    }

    private static List<Integer> deleteConcurrently(
            String path,
            List<String> accessTokens,
            List<String> requestIds) throws Exception {
        assertThat(accessTokens).hasSameSizeAs(requestIds);
        ExecutorService executor = Executors.newFixedThreadPool(accessTokens.size());
        CountDownLatch ready = new CountDownLatch(accessTokens.size());
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Integer>> futures = new ArrayList<>();
        try {
            for (int index = 0; index < accessTokens.size(); index++) {
                String accessToken = accessTokens.get(index);
                String requestId = requestIds.get(index);
                futures.add(executor.submit(() -> {
                    ready.countDown();
                    if (!start.await(10, TimeUnit.SECONDS)) {
                        throw new IllegalStateException("Concurrent requests did not start");
                    }
                    return mockMvc.perform(delete(path)
                                    .header("Authorization", bearer(accessToken))
                                    .header("X-Request-Id", requestId))
                            .andReturn()
                            .getResponse()
                            .getStatus();
                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> future : futures) {
                statuses.add(future.get(20, TimeUnit.SECONDS));
            }
            return statuses;
        } finally {
            executor.shutdownNow();
            if (!executor.awaitTermination(10, TimeUnit.SECONDS)) {
                throw new IllegalStateException(
                        "Concurrent request executor did not terminate");
            }
        }
    }

    private static void assertSessionRevoked(String sessionId) throws Exception {
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        SELECT revoked_at
                        FROM auth_sessions
                        WHERE id = ?::uuid
                        """)) {
            statement.setString(1, sessionId);
            try (ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getTimestamp("revoked_at")).isNotNull();
                assertThat(result.next()).isFalse();
            }
        }
    }

    private static void assertSingleConcurrentRevocationAudit(
            String sessionId,
            List<String> allowedRequestIds,
            List<String> rawTokens) throws Exception {
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        SELECT actor_user_id::text, request_id, details::text,
                               row_to_json(audit)::text AS audit_record
                        FROM audit_logs audit
                        WHERE tenant_id = ?::uuid
                          AND action = 'iam.session.revoked'
                          AND resource_type = 'auth_session'
                          AND resource_id = ?
                        """)) {
            statement.setString(1, TENANT_A);
            statement.setString(2, sessionId);
            try (ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getString("actor_user_id"))
                        .isEqualTo(ORDINARY_USER);
                assertThat(result.getString("request_id"))
                        .isIn(allowedRequestIds);
                String details = result.getString("details");
                assertThat(details)
                        .isEqualTo("{}")
                        .doesNotContainIgnoringCase("token")
                        .doesNotContainIgnoringCase("hash")
                        .doesNotContainIgnoringCase("request");
                rawTokens.forEach(token -> assertThat(details).doesNotContain(token));
                String auditRecord = result.getString("audit_record");
                rawTokens.forEach(token -> assertThat(auditRecord)
                        .doesNotContain(token)
                        .doesNotContain(sha256(token)));
                assertThat(result.next()).isFalse();
            }
        }
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.US_ASCII));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private static String login(
            String tenantCode,
            String loginUsername,
            String loginPassword) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "tenantCode":"%s",
                                  "username":"%s",
                                  "password":"%s"
                                }
                                """.formatted(
                                tenantCode,
                                loginUsername,
                                loginPassword)))
                .andExpect(status().isOk())
                .andReturn();
        return JsonPath.read(
                result.getResponse().getContentAsString(),
                "$.accessToken");
    }

    private static String bearer(String token) {
        return "Bearer " + token;
    }

    private static void seedContract() throws Exception {
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (id, code, name) VALUES
                      ('%s', 'phase4_tenant_a', 'Phase 4 Tenant A'),
                      ('%s', 'phase4_tenant_b', 'Phase 4 Tenant B')
                    ON CONFLICT (id) DO NOTHING
                    """.formatted(TENANT_A, TENANT_B));
            insertUser(
                    connection,
                    ORDINARY_USER,
                    TENANT_A,
                    "ordinary_user",
                    "Ordinary User",
                    hash("phase4-ordinary-password"));
            insertUser(
                    connection,
                    OTHER_USER,
                    TENANT_A,
                    "other_user",
                    "Other User",
                    hash("phase4-other-password"));
            insertUser(
                    connection,
                    FOREIGN_USER,
                    TENANT_B,
                    "foreign_user",
                    "Foreign User",
                    hash("phase4-foreign-password"));
            BusinessApplicationTestData.enableErpForTenant(
                    connection,
                    UUID.fromString(TENANT_A));
            BusinessApplicationTestData.enableErpForTenant(
                    connection,
                    UUID.fromString(TENANT_B));
        }
    }

    private static void insertUser(
            Connection connection,
            String id,
            String tenantId,
            String userName,
            String displayName,
            String passwordHash) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO users (
                    id, tenant_id, username, display_name, password_hash, status
                ) VALUES (?::uuid, ?::uuid, ?, ?, ?, 'ACTIVE')
                ON CONFLICT (id) DO UPDATE SET
                  password_hash = EXCLUDED.password_hash,
                  status = 'ACTIVE'
                """)) {
            statement.setString(1, id);
            statement.setString(2, tenantId);
            statement.setString(3, userName);
            statement.setString(4, displayName);
            statement.setString(5, passwordHash);
            statement.executeUpdate();
        }
    }

    private static String hash(String raw) {
        return "{bcrypt}" + new BCryptPasswordEncoder(4).encode(raw);
    }

    private static Connection connection() throws Exception {
        return DriverManager.getConnection(jdbcUrl, username, password);
    }

    private static void configureDatabase() {
        String externalUrl = System.getenv("ERP_TEST_DB_URL");
        if (externalUrl != null && !externalUrl.isBlank()) {
            jdbcUrl = externalUrl;
            username = requiredEnvironment("ERP_TEST_DB_USER");
            password = requiredEnvironment("ERP_TEST_DB_PASSWORD");
            return;
        }
        try {
            postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("erp_iam_phase4_test")
                    .withUsername("erp_test")
                    .withPassword("integration-test-only");
            postgres.start();
            jdbcUrl = postgres.getJdbcUrl();
            username = postgres.getUsername();
            password = postgres.getPassword();
        } catch (RuntimeException unavailableDocker) {
            Assumptions.assumeTrue(
                    false,
                    "Docker is unavailable and ERP_TEST_DB_URL was not supplied");
        }
    }

    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(
                    name + " is required when ERP_TEST_DB_URL is set");
        }
        return value;
    }

    private static final class ConcurrentRequestBarrier implements Filter {

        private volatile ActiveBarrier activeBarrier;

        void enable(String path, int requestCount) {
            activeBarrier = new ActiveBarrier(path, new CountDownLatch(requestCount));
        }

        void disable() {
            activeBarrier = null;
        }

        @Override
        public void doFilter(
                ServletRequest request,
                ServletResponse response,
                FilterChain chain) throws IOException, ServletException {
            ActiveBarrier barrier = activeBarrier;
            if (barrier != null
                    && request instanceof HttpServletRequest httpRequest
                    && "DELETE".equals(httpRequest.getMethod())
                    && barrier.path().equals(httpRequest.getRequestURI())) {
                barrier.arrivals().countDown();
                try {
                    if (!barrier.arrivals().await(10, TimeUnit.SECONDS)) {
                        throw new ServletException(
                                "Concurrent requests did not reach controller");
                    }
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new ServletException(interrupted);
                }
            }
            chain.doFilter(request, response);
        }

        private record ActiveBarrier(String path, CountDownLatch arrivals) {
        }
    }
}
