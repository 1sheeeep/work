package cn.xzkj.erp.iam.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cn.xzkj.erp.ErpApplication;
import cn.xzkj.erp.iam.web.AuthController;
import cn.xzkj.erp.testing.BusinessApplicationTestData;
import com.jayway.jsonpath.JsonPath;
import jakarta.servlet.Filter;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.WebApplicationContext;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;

class IamMigrationIntegrationTest {

    private static final String CONTRACT_TENANT_ID =
            "40000000-0000-0000-0000-000000000001";
    private static final String CONTRACT_USER_ID =
            "50000000-0000-0000-0000-000000000001";
    private static PostgreSQLContainer<?> postgres;
    private static String jdbcUrl;
    private static String username;
    private static String password;

    @BeforeAll
    static void migrate() {
        configureDatabase();
        Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .load()
                .migrate();
    }

    @AfterAll
    static void stopContainer() {
        if (postgres != null) {
            postgres.stop();
        }
    }

    @Test
    void appliesV1V10V20V21V30AndV31WithPasswordCredentialSchema()
            throws Exception {
        try (Connection connection = connection();
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("""
                        SELECT COUNT(*)
                        FROM flyway_schema_history
                        WHERE success = true
                          AND version IN ('1', '10', '20', '21', '30', '31')
                        """)) {
            result.next();
            assertThat(result.getInt(1)).isEqualTo(6);
        }

        try (Connection connection = connection();
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("""
                        SELECT COUNT(*)
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'password_credentials'
                          AND column_name IN (
                            'tenant_id',
                            'user_id',
                            'purpose',
                            'token_hash',
                            'expires_at',
                            'consumed_at',
                            'revoked_at',
                            'created_by_user_id',
                            'version'
                          )
                        """)) {
            result.next();
            assertThat(result.getInt(1)).isEqualTo(9);
        }

        try (Connection connection = connection();
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("""
                        SELECT COUNT(*)
                        FROM information_schema.tables
                        WHERE table_schema = 'public' AND table_name = 'auth_sessions'
                        """)) {
            result.next();
            assertThat(result.getInt(1)).isOne();
        }

        try (Connection connection = connection();
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("""
                        SELECT COUNT(*)
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name IN ('users', 'roles')
                          AND column_name = 'version'
                          AND is_nullable = 'NO'
                        """)) {
            result.next();
            assertThat(result.getInt(1)).isEqualTo(2);
        }
    }

    @Test
    void databaseRejectsCrossTenantRoleAssignment() throws Exception {
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (id, code, name) VALUES
                      ('10000000-0000-0000-0000-000000000001', 'tenant_a', 'Tenant A'),
                      ('10000000-0000-0000-0000-000000000002', 'tenant_b', 'Tenant B')
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO users (id, tenant_id, username, display_name) VALUES
                      ('20000000-0000-0000-0000-000000000001',
                       '10000000-0000-0000-0000-000000000001', 'user_a', 'User A')
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO roles (id, tenant_id, code, name) VALUES
                      ('30000000-0000-0000-0000-000000000001',
                       '10000000-0000-0000-0000-000000000002', 'viewer', 'Viewer')
                    ON CONFLICT (id) DO NOTHING
                    """);

            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES
                      ('10000000-0000-0000-0000-000000000001',
                       '20000000-0000-0000-0000-000000000001',
                       '30000000-0000-0000-0000-000000000001')
                    """))
                    .hasMessageContaining("fk_user_roles_role_tenant");
        }
    }

    @Test
    void databaseRejectsCrossTenantPasswordCredentials() throws Exception {
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (id, code, name) VALUES
                      ('c0000000-0000-0000-0000-000000000001',
                       'credential_tenant_a',
                       'Credential Tenant A'),
                      ('c0000000-0000-0000-0000-000000000002',
                       'credential_tenant_b',
                       'Credential Tenant B')
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO users (id, tenant_id, username, display_name) VALUES
                      ('c1000000-0000-0000-0000-000000000001',
                       'c0000000-0000-0000-0000-000000000001',
                       'credential_user_a',
                       'Credential User A'),
                      ('c1000000-0000-0000-0000-000000000002',
                       'c0000000-0000-0000-0000-000000000002',
                       'credential_user_b',
                       'Credential User B')
                    ON CONFLICT (id) DO NOTHING
                    """);

            assertThatThrownBy(() -> statement.executeUpdate("""
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
                      'c2000000-0000-0000-0000-000000000001',
                      'c0000000-0000-0000-0000-000000000001',
                      'c1000000-0000-0000-0000-000000000002',
                      'PASSWORD_RESET',
                      repeat('a', 64),
                      now() + interval '30 minutes',
                      'c1000000-0000-0000-0000-000000000001',
                      now()
                    )
                    """))
                    .hasMessageContaining("fk_password_credentials_user_tenant");

            assertThatThrownBy(() -> statement.executeUpdate("""
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
                      'c2000000-0000-0000-0000-000000000002',
                      'c0000000-0000-0000-0000-000000000001',
                      'c1000000-0000-0000-0000-000000000001',
                      'PASSWORD_RESET',
                      repeat('b', 64),
                      now() + interval '30 minutes',
                      'c1000000-0000-0000-0000-000000000002',
                      now()
                    )
                    """))
                    .hasMessageContaining("fk_password_credentials_creator_tenant");
        }
    }

    @Test
    void rejectsInvalidLoginDocumentsWithStableSafeErrors() throws Exception {
        StandardEnvironment environment = integrationEnvironment();
        try (ConfigurableApplicationContext context =
                new SpringApplicationBuilder(ErpApplication.class)
                        .web(WebApplicationType.SERVLET)
                        .environment(environment)
                        .run()) {
            MockMvc mockMvc = securityMockMvc(context);

            mockMvc.perform(post("/api/v1/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {
                                      "tenantCode": "",
                                      "username": "",
                                      "password": ""
                                    }
                                    """))
                    .andExpect(status().isBadRequest())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                    .andExpect(jsonPath("$.code").value("validation_failed"))
                    .andExpect(jsonPath("$.message").value("Request validation failed"));

            mockMvc.perform(post("/api/v1/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {
                                      "tenantCode": "INVALID!",
                                      "username": "operator",
                                      "password": "supplied-password"
                                    }
                                    """))
                    .andExpect(status().isBadRequest())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                    .andExpect(jsonPath("$.code").value("validation_failed"))
                    .andExpect(jsonPath("$.message").value("Request validation failed"));

            mockMvc.perform(post("/api/v1/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"tenantCode":"acme","username":
                                    """))
                    .andExpect(status().isBadRequest())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                    .andExpect(jsonPath("$.code").value("invalid_request"))
                    .andExpect(jsonPath("$.message").value("Request body is invalid"));
        }
    }

    @Test
    void exposesCompleteIdentityAndConsistentSecurityErrors() throws Exception {
        prepareContractIdentity();
        StandardEnvironment environment = integrationEnvironment();
        try (ConfigurableApplicationContext context =
                new SpringApplicationBuilder(
                        ErpApplication.class,
                        PermissionProbeController.class)
                        .web(WebApplicationType.SERVLET)
                        .environment(environment)
                        .run()) {
            assertThat(context.getBean(AuthController.class)).isNotNull();
            assertThat(context.getBean(AuthSessionRepository.class)).isNotNull();
            MockMvc mockMvc = securityMockMvc(context);

            mockMvc.perform(get("/api/v1/auth/me"))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("authentication_required"))
                    .andExpect(jsonPath("$.message").value("Authentication is required"));

            mockMvc.perform(post("/api/v1/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {
                                      "tenantCode": "contract_tenant",
                                      "username": "contract_user",
                                      "password": "wrong-password"
                                    }
                                    """))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("invalid_credentials"))
                    .andExpect(jsonPath("$.message")
                            .value("Invalid tenant, username, or password"));

            MvcResult login = mockMvc.perform(post("/api/v1/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {
                                      "tenantCode": "contract_tenant",
                                      "username": "contract_user",
                                      "password": "integration-contract-password"
                                    }
                                    """))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.tokenType").value("Bearer"))
                    .andExpect(jsonPath("$.accessToken").isString())
                    .andExpect(jsonPath("$.expiresAt").isString())
                    .andExpect(jsonPath("$.tenant.id").value(CONTRACT_TENANT_ID))
                    .andExpect(jsonPath("$.tenant.code").value("contract_tenant"))
                    .andExpect(jsonPath("$.tenant.name").value("Contract Tenant"))
                    .andExpect(jsonPath("$.user.id").value(CONTRACT_USER_ID))
                    .andExpect(jsonPath("$.user.username").value("contract_user"))
                    .andExpect(jsonPath("$.user.displayName").value("Contract User"))
                    .andExpect(jsonPath("$.permissions").value(containsInAnyOrder(
                            "orders.read",
                            "shop:read",
                            "shop:authorization:write")))
                    .andReturn();
            String accessToken = JsonPath.read(
                    login.getResponse().getContentAsString(), "$.accessToken");

            mockMvc.perform(get("/api/v1/auth/me")
                            .header("Authorization", "Bearer " + accessToken))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.tenant.id").value(CONTRACT_TENANT_ID))
                    .andExpect(jsonPath("$.tenant.code").value("contract_tenant"))
                    .andExpect(jsonPath("$.user.id").value(CONTRACT_USER_ID))
                    .andExpect(jsonPath("$.permissions").value(containsInAnyOrder(
                            "orders.read",
                            "shop:read",
                            "shop:authorization:write")))
                    .andExpect(jsonPath("$.expiresAt").isString());

            mockMvc.perform(get("/api/v1/integration/tenant-probe")
                            .header("Authorization", "Bearer " + accessToken))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.tenantId").value(CONTRACT_TENANT_ID));

            mockMvc.perform(get("/api/v1/integration/permission-probe")
                            .header("Authorization", "Bearer " + accessToken))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("permission_denied"))
                    .andExpect(jsonPath("$.message").value("Permission is required"));

            mockMvc.perform(delete("/api/v1/auth/session")
                            .header("Authorization", "Bearer " + accessToken))
                    .andExpect(status().isNoContent());

            mockMvc.perform(get("/api/v1/auth/me")
                            .header("Authorization", "Bearer " + accessToken))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("authentication_required"));
        }
    }

    private static StandardEnvironment integrationEnvironment() {
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource(
                "iam-integration-test",
                Map.of(
                        "server.port", "0",
                        "spring.datasource.url", jdbcUrl,
                        "spring.datasource.username", username,
                        "spring.datasource.password", password,
                        "erp.environment", "integration-test")));
        return environment;
    }

    private static MockMvc securityMockMvc(ConfigurableApplicationContext context) {
        return MockMvcBuilders
                .webAppContextSetup((WebApplicationContext) context)
                .addFilters(context.getBean("springSecurityFilterChain", Filter.class))
                .build();
    }

    private static void prepareContractIdentity() throws Exception {
        String passwordHash = "{bcrypt}"
                + new BCryptPasswordEncoder(4).encode("integration-contract-password");
        try (Connection connection = connection()) {
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO tenants (id, code, name)
                    VALUES (?::uuid, 'contract_tenant', 'Contract Tenant')
                    ON CONFLICT (id) DO NOTHING
                    """)) {
                statement.setString(1, CONTRACT_TENANT_ID);
                statement.executeUpdate();
            }
            try (PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO users (
                        id, tenant_id, username, display_name, password_hash
                    ) VALUES (
                        ?::uuid, ?::uuid, 'contract_user', 'Contract User', ?
                    )
                    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash
                    """)) {
                statement.setString(1, CONTRACT_USER_ID);
                statement.setString(2, CONTRACT_TENANT_ID);
                statement.setString(3, passwordHash);
                statement.executeUpdate();
            }
            try (Statement statement = connection.createStatement()) {
                statement.executeUpdate("""
                        INSERT INTO roles (id, tenant_id, code, name)
                        VALUES (
                          '60000000-0000-0000-0000-000000000001',
                          '40000000-0000-0000-0000-000000000001',
                          'reader',
                          'Reader'
                        )
                        ON CONFLICT (id) DO NOTHING
                        """);
                statement.executeUpdate("""
                        INSERT INTO permissions (id, code, module, name)
                        VALUES
                          (
                            '70000000-0000-0000-0000-000000000001',
                            'orders.read',
                            'orders',
                            'Read orders'
                          ),
                          (
                            '70000000-0000-0000-0000-000000000002',
                            'shop:read',
                            'shop',
                            'Read shops'
                          ),
                          (
                            '70000000-0000-0000-0000-000000000003',
                            'shop:authorization:write',
                            'shop',
                            'Manage shop authorization'
                          )
                        ON CONFLICT (id) DO NOTHING
                        """);
                statement.executeUpdate("""
                        INSERT INTO user_roles (tenant_id, user_id, role_id)
                        VALUES (
                          '40000000-0000-0000-0000-000000000001',
                          '50000000-0000-0000-0000-000000000001',
                          '60000000-0000-0000-0000-000000000001'
                        )
                        ON CONFLICT (user_id, role_id) DO NOTHING
                        """);
                statement.executeUpdate("""
                        INSERT INTO role_permissions (tenant_id, role_id, permission_id)
                        VALUES
                          (
                            '40000000-0000-0000-0000-000000000001',
                            '60000000-0000-0000-0000-000000000001',
                            '70000000-0000-0000-0000-000000000001'
                          ),
                          (
                            '40000000-0000-0000-0000-000000000001',
                            '60000000-0000-0000-0000-000000000001',
                            '70000000-0000-0000-0000-000000000002'
                          ),
                          (
                            '40000000-0000-0000-0000-000000000001',
                            '60000000-0000-0000-0000-000000000001',
                            '70000000-0000-0000-0000-000000000003'
                          )
                        ON CONFLICT (role_id, permission_id) DO NOTHING
                        """);
            }
            BusinessApplicationTestData.enableErpForTenant(
                    connection,
                    UUID.fromString(CONTRACT_TENANT_ID));
        }
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
                    .withDatabaseName("erp_iam_test")
                    .withUsername("erp_test")
                    .withPassword("integration-test-only");
            postgres.start();
            jdbcUrl = postgres.getJdbcUrl();
            username = postgres.getUsername();
            password = postgres.getPassword();
        } catch (RuntimeException unavailableDocker) {
            Assumptions.assumeTrue(false,
                    "Docker is unavailable and ERP_TEST_DB_URL was not supplied");
        }
    }

    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is required when ERP_TEST_DB_URL is set");
        }
        return value;
    }

    @RestController
    static class PermissionProbeController {

        @GetMapping("/api/v1/integration/permission-probe")
        @PreAuthorize("hasAuthority('shop:write')")
        Map<String, String> probe() {
            return Map.of("status", "allowed");
        }

        @GetMapping("/api/v1/integration/tenant-probe")
        @PreAuthorize("hasAuthority('shop:read')")
        Map<String, UUID> tenant(
                @AuthenticationPrincipal(expression = "tenantId") UUID tenantId) {
            return Map.of("tenantId", tenantId);
        }
    }
}
