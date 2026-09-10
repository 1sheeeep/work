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
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
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
class IamPasswordCredentialIntegrationTest {

    private static final String TENANT_A =
            "b0000000-0000-0000-0000-000000000001";
    private static final String TENANT_B =
            "b0000000-0000-0000-0000-000000000002";
    private static final String ADMIN_USER =
            "b1000000-0000-0000-0000-000000000001";
    private static final String ORDINARY_USER =
            "b1000000-0000-0000-0000-000000000002";
    private static final String DISABLED_USER =
            "b1000000-0000-0000-0000-000000000003";
    private static final String ACTIVE_USER =
            "b1000000-0000-0000-0000-000000000004";
    private static final String FOREIGN_USER =
            "b1000000-0000-0000-0000-000000000005";
    private static final String CONCURRENT_USER =
            "b1000000-0000-0000-0000-000000000006";
    private static final String DISABLED_RESET_USER =
            "b1000000-0000-0000-0000-000000000007";
    private static final String FAILURE_USER =
            "b1000000-0000-0000-0000-000000000008";
    private static final String LISTING_USER =
            "b1000000-0000-0000-0000-000000000009";
    private static final String ADMIN_ROLE =
            "b2000000-0000-0000-0000-000000000001";
    private static final String USER_READ_PERMISSION =
            "a3000000-0000-0000-0000-000000000001";
    private static final String USER_WRITE_PERMISSION =
            "a3000000-0000-0000-0000-000000000002";
    private static final String AUDIT_READ_PERMISSION =
            "a3000000-0000-0000-0000-000000000007";

    private static PostgreSQLContainer<?> postgres;
    private static ConfigurableApplicationContext context;
    private static MockMvc mockMvc;
    private static String jdbcUrl;
    private static String username;
    private static String password;
    private static String adminToken;

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
                "iam-password-credential-integration-test",
                Map.of(
                        "server.port", "0",
                        "spring.datasource.url", jdbcUrl,
                        "spring.datasource.username", username,
                        "spring.datasource.password", password,
                        "erp.environment", "integration-test",
                        "erp.security.password-credential-ttl", "PT30M")));
        context = new SpringApplicationBuilder(ErpApplication.class)
                .web(WebApplicationType.SERVLET)
                .environment(environment)
                .run();
        mockMvc = MockMvcBuilders
                .webAppContextSetup((WebApplicationContext) context)
                .addFilters(context.getBean("springSecurityFilterChain", Filter.class))
                .build();
        adminToken = login(
                "phase3_tenant_a",
                "iam_admin",
                "phase3-admin-password");
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
    void validatesPublicDocumentsThroughTheRealSecurityChain() throws Exception {
        mockMvc.perform(post("/api/v1/auth/password-credentials/redeem")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"token":"opaque","newPassword":
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("invalid_request"))
                .andExpect(jsonPath("$.message").value("Request body is invalid"));

        mockMvc.perform(post("/api/v1/auth/password-credentials/redeem")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "token":"opaque",
                                  "newPassword":"phase3-valid-password",
                                  "tenantId":"%s",
                                  "userId":"%s"
                                }
                                """.formatted(TENANT_A, DISABLED_USER)))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("validation_failed"))
                .andExpect(jsonPath("$.message").value("Request validation failed"));

        mockMvc.perform(post("/api/v1/auth/password-credentials/redeem")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "token":"opaque",
                                  "newPassword":""
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));

        mockMvc.perform(post(
                                "/api/v1/iam/members/%s/password-credentials"
                                        .formatted(DISABLED_USER))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"purpose":"ACTIVATION"}
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("authentication_required"));

        mockMvc.perform(post(
                                "/api/v1/iam/members/%s/password-credentials"
                                        .formatted(DISABLED_USER))
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "purpose":"ACTIVATION",
                                  "password":"must-not-be-accepted"
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));

        mockMvc.perform(post(
                                "/api/v1/iam/members/%s/password-credentials"
                                        .formatted(DISABLED_USER))
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "purpose":"ACTIVATION",
                                  "expiresInMinutes":121
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));
    }

    @Test
    @Order(2)
    void listsOnlyTenantScopedCredentialMetadataAndDerivedStates()
            throws Exception {
        Issued active = issue(ACTIVE_USER, "PASSWORD_RESET", 30);
        Issued revoked = issue(ACTIVE_USER, "PASSWORD_RESET", 30);
        mockMvc.perform(delete(
                                "/api/v1/iam/members/%s/password-credentials/%s"
                                        .formatted(ACTIVE_USER, revoked.id()))
                        .header("Authorization", bearer(adminToken)))
                .andExpect(status().isNoContent());
        Issued consumed = issue(LISTING_USER, "ACTIVATION", 30);
        redeem(consumed.token(), "phase3-listed-consumed-password")
                .andExpect(status().isNoContent());
        Issued open = issue(ORDINARY_USER, "PASSWORD_RESET", 30);
        insertExpiredCredential(ACTIVE_USER);

        String ordinaryToken = login(
                "phase3_tenant_a",
                "ordinary_user",
                "phase3-ordinary-password");
        mockMvc.perform(get(
                                "/api/v1/iam/members/%s/password-credentials"
                                        .formatted(ACTIVE_USER))
                        .header("Authorization", bearer(ordinaryToken)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));

        MvcResult result = mockMvc.perform(get(
                                "/api/v1/iam/members/%s/password-credentials"
                                        .formatted(ACTIVE_USER))
                        .header("Authorization", bearer(adminToken))
                        .header("X-Tenant-Id", TENANT_B)
                        .param("size", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(100))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.items[*].status")
                        .value(org.hamcrest.Matchers.hasItems(
                                "REVOKED",
                                "EXPIRED")))
                .andExpect(jsonPath("$.items[*].id")
                        .value(org.hamcrest.Matchers.hasItem(active.id())))
                .andExpect(jsonPath("$.items[0].token").doesNotExist())
                .andExpect(jsonPath("$.items[0].tokenHash").doesNotExist())
                .andExpect(jsonPath("$.items[0].createdByUserId").doesNotExist())
                .andExpect(jsonPath("$.items[0].tenantId").doesNotExist())
                .andReturn();
        List<Map<String, Object>> credentials = JsonPath.read(
                result.getResponse().getContentAsString(),
                "$.items");
        assertThat(credentials)
                .allSatisfy(credential -> assertThat(credential.keySet())
                        .containsExactlyInAnyOrder(
                                "id",
                                "purpose",
                                "status",
                                "expiresAt",
                                "createdAt",
                                "consumedAt",
                                "revokedAt"));

        mockMvc.perform(get(
                                "/api/v1/iam/members/%s/password-credentials"
                                        .formatted(ORDINARY_USER))
                        .header("Authorization", bearer(adminToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath(
                                "$.items[?(@.id == '%s')].status"
                                        .formatted(open.id()))
                        .value(org.hamcrest.Matchers.contains("ACTIVE")));

        mockMvc.perform(get(
                                "/api/v1/iam/members/%s/password-credentials"
                                        .formatted(LISTING_USER))
                        .header("Authorization", bearer(adminToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.id == '%s')].status"
                        .formatted(consumed.id()))
                        .value(org.hamcrest.Matchers.contains("CONSUMED")));

        mockMvc.perform(get(
                                "/api/v1/iam/members/%s/password-credentials"
                                        .formatted(FOREIGN_USER))
                        .header("Authorization", bearer(adminToken)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));

        mockMvc.perform(get(
                                "/api/v1/iam/members/%s/password-credentials"
                                        .formatted(UUID.randomUUID()))
                        .header("Authorization", bearer(adminToken)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));

        mockMvc.perform(get(
                                "/api/v1/iam/members/%s/password-credentials"
                                        .formatted(ACTIVE_USER))
                        .header("Authorization", bearer(adminToken))
                        .param("page", "1000001"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("validation_failed"));
    }

    @Test
    @Order(3)
    void enforcesPermissionTenantBoundaryForgedHeaderAndSelfProtection()
            throws Exception {
        String ordinaryToken = login(
                "phase3_tenant_a",
                "ordinary_user",
                "phase3-ordinary-password");

        mockMvc.perform(post(
                                "/api/v1/iam/members/%s/password-credentials"
                                        .formatted(DISABLED_USER))
                        .header("Authorization", bearer(ordinaryToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"purpose\":\"ACTIVATION\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("permission_denied"));

        mockMvc.perform(post(
                                "/api/v1/iam/members/%s/password-credentials"
                                        .formatted(FOREIGN_USER))
                        .header("Authorization", bearer(adminToken))
                        .header("X-Tenant-Id", TENANT_B)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"purpose\":\"PASSWORD_RESET\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));

        mockMvc.perform(delete(
                                "/api/v1/iam/members/%s/password-credentials/%s"
                                        .formatted(
                                                FOREIGN_USER,
                                                UUID.randomUUID()))
                        .header("Authorization", bearer(adminToken))
                        .header("X-Tenant-Id", TENANT_B))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"));

        mockMvc.perform(post(
                                "/api/v1/iam/members/%s/password-credentials"
                                        .formatted(ADMIN_USER))
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"purpose\":\"PASSWORD_RESET\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("self_service_not_allowed"));

        mockMvc.perform(post(
                                "/api/v1/iam/members/%s/password-credentials"
                                        .formatted(ACTIVE_USER))
                        .header("Authorization", bearer(adminToken))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"purpose\":\"ACTIVATION\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("conflict"));
    }

    @Test
    @Order(4)
    void activationStoresOnlyHashActivatesOnceAndAuditsWithoutSecrets()
            throws Exception {
        assertInvalidLogin(
                "phase3_tenant_a",
                "disabled_user",
                "phase3-activated-password");

        Issued issued = issue(DISABLED_USER, "ACTIVATION", null);
        assertThat(issued.token()).hasSize(43);

        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        SELECT token_hash, purpose,
                               extract(epoch FROM (expires_at - created_at)) AS ttl_seconds
                        FROM password_credentials
                        WHERE id = ?::uuid
                        """)) {
            statement.setString(1, issued.id());
            try (ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getString("token_hash"))
                        .hasSize(64)
                        .doesNotContain(issued.token())
                        .doesNotContain("phase3-activated-password");
                assertThat(result.getString("purpose")).isEqualTo("ACTIVATION");
                assertThat(result.getLong("ttl_seconds")).isEqualTo(1_800);
            }
        }

        redeem(issued.token(), "phase3-activated-password")
                .andExpect(status().isNoContent());
        assertInvalidCredential(issued.token(), "phase3-other-password");
        login(
                "phase3_tenant_a",
                "disabled_user",
                "phase3-activated-password");

        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        SELECT status, password_hash
                        FROM users
                        WHERE id = ?::uuid
                        """)) {
            statement.setString(1, DISABLED_USER);
            try (ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getString("status")).isEqualTo("ACTIVE");
                assertThat(result.getString("password_hash"))
                        .startsWith("{argon2id}$argon2id$")
                        .doesNotContain("phase3-activated-password");
            }
        }

        assertAuditIsSanitized(
                DISABLED_USER,
                issued.token(),
                "phase3-activated-password");
    }

    @Test
    @Order(5)
    void resetRevokesSessionsPreservesDisabledStatusAndUniformlyRejectsFailures()
            throws Exception {
        String previousSession = login(
                "phase3_tenant_a",
                "active_user",
                "phase3-active-password");
        Issued reset = issue(ACTIVE_USER, "PASSWORD_RESET", 30);
        redeem(reset.token(), "phase3-new-active-password")
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", bearer(previousSession)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("authentication_required"));
        assertInvalidLogin(
                "phase3_tenant_a",
                "active_user",
                "phase3-active-password");
        login(
                "phase3_tenant_a",
                "active_user",
                "phase3-new-active-password");

        Issued disabledReset =
                issue(DISABLED_RESET_USER, "PASSWORD_RESET", null);
        redeem(disabledReset.token(), "phase3-disabled-reset")
                .andExpect(status().isNoContent());
        assertInvalidLogin(
                "phase3_tenant_a",
                "disabled_reset_user",
                "phase3-disabled-reset");
        assertUserStatus(DISABLED_RESET_USER, "DISABLED");

        Issued expired = issue(FAILURE_USER, "PASSWORD_RESET", null);
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        UPDATE password_credentials
                        SET created_at = now() - interval '10 minutes',
                            expires_at = now() - interval '5 minutes'
                        WHERE id = ?::uuid
                        """)) {
            statement.setString(1, expired.id());
            assertThat(statement.executeUpdate()).isOne();
        }
        assertInvalidCredential(expired.token(), "phase3-failure-password");

        Issued revoked = issue(FAILURE_USER, "PASSWORD_RESET", null);
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        SELECT revoked_at IS NOT NULL
                        FROM password_credentials
                        WHERE id = ?::uuid
                        """)) {
            statement.setString(1, expired.id());
            try (ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getBoolean(1)).isTrue();
            }
        }
        mockMvc.perform(delete(
                                "/api/v1/iam/members/%s/password-credentials/%s"
                                        .formatted(FAILURE_USER, revoked.id()))
                        .header("Authorization", bearer(adminToken)))
                .andExpect(status().isNoContent());
        mockMvc.perform(delete(
                                "/api/v1/iam/members/%s/password-credentials/%s"
                                        .formatted(FAILURE_USER, revoked.id()))
                        .header("Authorization", bearer(adminToken)))
                .andExpect(status().isNoContent());
        assertInvalidCredential(revoked.token(), "phase3-failure-password");
        assertInvalidCredential(
                "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
                "phase3-failure-password");

        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        SELECT actor_user_id::text, details::text
                        FROM audit_logs
                        WHERE tenant_id = ?::uuid
                          AND resource_id = ?
                          AND action = 'iam.user.password_credential_revoked'
                        """)) {
            statement.setString(1, TENANT_A);
            statement.setString(2, FAILURE_USER);
            try (ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getString("actor_user_id")).isEqualTo(ADMIN_USER);
                assertThat(result.getString("details"))
                        .contains("\"purpose\"")
                        .doesNotContain(revoked.token())
                        .doesNotContain("phase3-failure-password");
                assertThat(result.next()).isFalse();
            }
        }
    }

    @Test
    @Order(6)
    void concurrentRedemptionAllowsExactlyOneWinner() throws Exception {
        Issued issued = issue(CONCURRENT_USER, "PASSWORD_RESET", null);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Integer>> futures = new ArrayList<>();
            for (int index = 0; index < 2; index++) {
                futures.add(executor.submit(() -> {
                    ready.countDown();
                    start.await();
                    return redeem(
                                    issued.token(),
                                    "phase3-concurrent-password")
                            .andReturn()
                            .getResponse()
                            .getStatus();
                }));
            }
            ready.await();
            start.countDown();
            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> future : futures) {
                statuses.add(future.get());
            }
            Collections.sort(statuses);
            assertThat(statuses).containsExactly(204, 400);
        } finally {
            executor.shutdownNow();
        }

        login(
                "phase3_tenant_a",
                "concurrent_user",
                "phase3-concurrent-password");
        mockMvc.perform(get(
                                "/api/v1/iam/members/%s/password-credentials"
                                        .formatted(CONCURRENT_USER))
                        .header("Authorization", bearer(adminToken)))
                .andExpect(status().isOk())
                .andExpect(jsonPath(
                                "$.items[?(@.id == '%s')].status"
                                        .formatted(issued.id()))
                        .value(org.hamcrest.Matchers.contains("CONSUMED")));
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        SELECT count(*)
                        FROM audit_logs
                        WHERE tenant_id = ?::uuid
                          AND resource_id = ?
                          AND action = 'iam.user.password_reset'
                        """)) {
            statement.setString(1, TENANT_A);
            statement.setString(2, CONCURRENT_USER);
            try (ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getInt(1)).isOne();
            }
        }
    }

    private static Issued issue(
            String userId,
            String purpose,
            Integer expiresInMinutes) throws Exception {
        String ttlProperty = expiresInMinutes == null
                ? ""
                : ",\"expiresInMinutes\":" + expiresInMinutes;
        MvcResult result = mockMvc.perform(post(
                                "/api/v1/iam/members/%s/password-credentials"
                                        .formatted(userId))
                        .header("Authorization", bearer(adminToken))
                        .header("X-Request-Id", "phase3-issue")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"purpose":"%s"%s}
                                """.formatted(purpose, ttlProperty)))
                .andExpect(status().isCreated())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.id").isString())
                .andExpect(jsonPath("$.purpose").value(purpose))
                .andExpect(jsonPath("$.token").isString())
                .andExpect(jsonPath("$.expiresAt").isString())
                .andReturn();
        String json = result.getResponse().getContentAsString();
        return new Issued(
                JsonPath.read(json, "$.id"),
                JsonPath.read(json, "$.token"));
    }

    private static org.springframework.test.web.servlet.ResultActions redeem(
            String token,
            String newPassword) throws Exception {
        return mockMvc.perform(post("/api/v1/auth/password-credentials/redeem")
                .header("X-Request-Id", "phase3-redeem")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {
                          "token":"%s",
                          "newPassword":"%s"
                        }
                        """.formatted(token, newPassword)));
    }

    private static void assertInvalidCredential(
            String token,
            String newPassword) throws Exception {
        redeem(token, newPassword)
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("invalid_password_credential"))
                .andExpect(jsonPath("$.message")
                        .value("Credential is invalid or expired"));
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

    private static void assertInvalidLogin(
            String tenantCode,
            String loginUsername,
            String loginPassword) throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
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
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("invalid_credentials"));
    }

    private static void assertUserStatus(String userId, String expected)
            throws Exception {
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        SELECT status
                        FROM users
                        WHERE id = ?::uuid
                        """)) {
            statement.setString(1, userId);
            try (ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getString(1)).isEqualTo(expected);
            }
        }
    }

    private static void assertAuditIsSanitized(
            String userId,
            String rawToken,
            String rawPassword) throws Exception {
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        SELECT action, actor_user_id::text, details::text,
                               request_id, host(source_ip)
                        FROM audit_logs
                        WHERE tenant_id = ?::uuid
                          AND resource_id = ?
                          AND action IN (
                            'iam.user.password_credential_issued',
                            'iam.user.activated'
                          )
                        ORDER BY created_at
                        """)) {
            statement.setString(1, TENANT_A);
            statement.setString(2, userId);
            try (ResultSet result = statement.executeQuery()) {
                int rows = 0;
                while (result.next()) {
                    rows++;
                    String details = result.getString("details");
                    assertThat(details)
                            .contains("\"purpose\"")
                            .doesNotContain(rawToken)
                            .doesNotContain(rawPassword)
                            .doesNotContainIgnoringCase("\"token\"")
                            .doesNotContainIgnoringCase("\"password\"");
                    assertThat(result.getString("request_id"))
                            .isIn("phase3-issue", "phase3-redeem");
                    assertThat(result.getString("host")).isNotBlank();
                    if (result.getString("action").endsWith("issued")) {
                        assertThat(result.getString("actor_user_id"))
                                .isEqualTo(ADMIN_USER);
                    } else {
                        assertThat(result.getString("actor_user_id")).isNull();
                    }
                }
                assertThat(rows).isEqualTo(2);
            }
        }
    }

    private static String bearer(String token) {
        return "Bearer " + token;
    }

    private static void seedContract() throws Exception {
        String adminHash = hash("phase3-admin-password");
        String ordinaryHash = hash("phase3-ordinary-password");
        String activeHash = hash("phase3-active-password");
        String concurrentHash = hash("phase3-concurrent-old");
        String failureHash = hash("phase3-failure-old");
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (id, code, name) VALUES
                      ('%s', 'phase3_tenant_a', 'Phase 3 Tenant A'),
                      ('%s', 'phase3_tenant_b', 'Phase 3 Tenant B')
                    ON CONFLICT (id) DO NOTHING
                    """.formatted(TENANT_A, TENANT_B));
            insertUser(
                    connection,
                    ADMIN_USER,
                    TENANT_A,
                    "iam_admin",
                    "IAM Administrator",
                    adminHash,
                    "ACTIVE");
            insertUser(
                    connection,
                    ORDINARY_USER,
                    TENANT_A,
                    "ordinary_user",
                    "Ordinary User",
                    ordinaryHash,
                    "ACTIVE");
            insertUser(
                    connection,
                    DISABLED_USER,
                    TENANT_A,
                    "disabled_user",
                    "Disabled User",
                    null,
                    "DISABLED");
            insertUser(
                    connection,
                    ACTIVE_USER,
                    TENANT_A,
                    "active_user",
                    "Active User",
                    activeHash,
                    "ACTIVE");
            insertUser(
                    connection,
                    FOREIGN_USER,
                    TENANT_B,
                    "foreign_user",
                    "Foreign User",
                    ordinaryHash,
                    "ACTIVE");
            insertUser(
                    connection,
                    CONCURRENT_USER,
                    TENANT_A,
                    "concurrent_user",
                    "Concurrent User",
                    concurrentHash,
                    "ACTIVE");
            insertUser(
                    connection,
                    DISABLED_RESET_USER,
                    TENANT_A,
                    "disabled_reset_user",
                    "Disabled Reset User",
                    null,
                    "DISABLED");
            insertUser(
                    connection,
                    FAILURE_USER,
                    TENANT_A,
                    "failure_user",
                    "Failure User",
                    failureHash,
                    "ACTIVE");
            insertUser(
                    connection,
                    LISTING_USER,
                    TENANT_A,
                    "listing_user",
                    "Listing User",
                    null,
                    "DISABLED");
            statement.executeUpdate("""
                    INSERT INTO roles (
                        id, tenant_id, code, name, system_role
                    ) VALUES (
                      '%s', '%s', 'phase3_iam_admin', 'Phase 3 IAM Admin', false
                    )
                    ON CONFLICT (id) DO NOTHING
                    """.formatted(ADMIN_ROLE, TENANT_A));
            statement.executeUpdate("""
                    INSERT INTO permissions (id, code, module, name) VALUES
                      ('%s', 'iam:user:read', 'iam', 'Read members'),
                      ('%s', 'iam:user:write', 'iam', 'Write members'),
                      ('%s', 'iam:audit:read', 'iam', 'Read audit logs')
                    ON CONFLICT (id) DO NOTHING
                    """.formatted(
                    USER_READ_PERMISSION,
                    USER_WRITE_PERMISSION,
                    AUDIT_READ_PERMISSION));
            statement.executeUpdate("""
                    INSERT INTO user_roles (tenant_id, user_id, role_id)
                    VALUES ('%s', '%s', '%s')
                    ON CONFLICT (user_id, role_id) DO NOTHING
                    """.formatted(TENANT_A, ADMIN_USER, ADMIN_ROLE));
            statement.executeUpdate("""
                    INSERT INTO role_permissions (
                        tenant_id, role_id, permission_id
                    ) VALUES
                      ('%s', '%s', '%s'),
                      ('%s', '%s', '%s'),
                      ('%s', '%s', '%s')
                    ON CONFLICT (role_id, permission_id) DO NOTHING
                    """.formatted(
                    TENANT_A, ADMIN_ROLE, USER_READ_PERMISSION,
                    TENANT_A, ADMIN_ROLE, USER_WRITE_PERMISSION,
                    TENANT_A, ADMIN_ROLE, AUDIT_READ_PERMISSION));
            BusinessApplicationTestData.enableErpForTenant(
                    connection,
                    UUID.fromString(TENANT_A));
            BusinessApplicationTestData.enableErpForTenant(
                    connection,
                    UUID.fromString(TENANT_B));
        }
    }

    private static void insertExpiredCredential(String userId) throws Exception {
        try (Connection connection = connection();
                PreparedStatement statement = connection.prepareStatement("""
                        INSERT INTO password_credentials (
                            id,
                            tenant_id,
                            user_id,
                            purpose,
                            token_hash,
                            expires_at,
                            created_by_user_id,
                            created_at
                        ) VALUES (
                            ?::uuid,
                            ?::uuid,
                            ?::uuid,
                            'PASSWORD_RESET',
                            ?,
                            now() - interval '1 hour',
                            ?::uuid,
                            now() - interval '2 hours'
                        )
                        """)) {
            statement.setString(1, UUID.randomUUID().toString());
            statement.setString(2, TENANT_A);
            statement.setString(3, userId);
            statement.setString(4, "f".repeat(64));
            statement.setString(5, ADMIN_USER);
            statement.executeUpdate();
        }
    }

    private static void insertUser(
            Connection connection,
            String id,
            String tenantId,
            String userName,
            String displayName,
            String passwordHash,
            String status) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO users (
                    id, tenant_id, username, display_name, password_hash, status
                ) VALUES (?::uuid, ?::uuid, ?, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET
                  password_hash = EXCLUDED.password_hash,
                  status = EXCLUDED.status
                """)) {
            statement.setString(1, id);
            statement.setString(2, tenantId);
            statement.setString(3, userName);
            statement.setString(4, displayName);
            statement.setString(5, passwordHash);
            statement.setString(6, status);
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
                    .withDatabaseName("erp_iam_phase3_test")
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

    private record Issued(String id, String token) {
    }
}
