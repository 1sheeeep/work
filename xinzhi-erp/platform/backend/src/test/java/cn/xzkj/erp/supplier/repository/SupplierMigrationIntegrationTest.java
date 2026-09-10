package cn.xzkj.erp.supplier.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.containers.PostgreSQLContainer;

import cn.xzkj.erp.ErpApplication;
import cn.xzkj.erp.iam.application.SessionTokenService;
import jakarta.servlet.Filter;

class SupplierMigrationIntegrationTest {
    private static final UUID TENANT_A =
            UUID.fromString("97000000-0000-0000-0000-000000000001");
    private static final UUID TENANT_B =
            UUID.fromString("97000000-0000-0000-0000-000000000002");
    private static final UUID USER_A =
            UUID.fromString("97000000-0000-0000-0000-000000000011");
    private static final UUID SYSTEM_ADMIN =
            UUID.fromString("97000000-0000-0000-0000-000000000021");

    private static PostgreSQLContainer<?> postgres;
    private static String baseJdbcUrl;
    private static String v1JdbcUrl;
    private static String v37JdbcUrl;
    private static String emptyJdbcUrl;
    private static String username;
    private static String password;
    private static String v1Schema;
    private static String v37Schema;
    private static String emptySchema;

    @BeforeAll
    static void migrateV1V37AndEmptyDatabases() throws Exception {
        configureDatabase();
        v1Schema = "supplier_v1_" + compactUuid();
        v37Schema = "supplier_v37_" + compactUuid();
        emptySchema = "supplier_empty_" + compactUuid();
        createSchema(v1Schema);
        createSchema(v37Schema);
        createSchema(emptySchema);
        v1JdbcUrl = withSchema(baseJdbcUrl, v1Schema);
        v37JdbcUrl = withSchema(baseJdbcUrl, v37Schema);
        emptyJdbcUrl = withSchema(baseJdbcUrl, emptySchema);

        migrateTo(v1JdbcUrl, "1");
        seedTenants(v1JdbcUrl);
        migrateAll(v1JdbcUrl);

        migrateTo(v37JdbcUrl, "37");
        seedTenants(v37JdbcUrl);
        migrateAll(v37JdbcUrl);

        migrateAll(emptyJdbcUrl);
    }

    @AfterAll
    static void cleanUp() throws Exception {
        try {
            for (String schema :
                    new String[] {v1Schema, v37Schema, emptySchema}) {
                if (schema != null) {
                    dropSchema(schema);
                }
            }
        } finally {
            if (postgres != null) {
                postgres.stop();
            }
        }
    }

    @Test
    void migratesV1V37AndEmptySchemasThroughV38() throws Exception {
        for (String jdbcUrl :
                new String[] {v1JdbcUrl, v37JdbcUrl, emptyJdbcUrl}) {
            try (Connection connection = DriverManager.getConnection(
                            jdbcUrl,
                            username,
                            password);
                    Statement statement = connection.createStatement();
                    ResultSet result = statement.executeQuery("""
                            SELECT
                              (SELECT count(*)
                               FROM flyway_schema_history
                               WHERE version = '38' AND success),
                              (SELECT count(*)
                               FROM information_schema.tables
                               WHERE table_schema = current_schema()
                                 AND table_name = 'tenant_suppliers'),
                              (SELECT count(*)
                               FROM permissions
                               WHERE code IN (
                                 'suppliers.read',
                                 'suppliers.write'))
                            """)) {
                result.next();
                assertThat(result.getInt(1)).isOne();
                assertThat(result.getInt(2)).isOne();
                assertThat(result.getInt(3)).isEqualTo(2);
            }
        }
    }

    @Test
    void v38AddsNoRoleGrantOrTenantData() throws Exception {
        try (var stream = SupplierMigrationIntegrationTest.class
                .getResourceAsStream(
                        "/db/migration/V38__supplier_master_data.sql")) {
            assertThat(stream).isNotNull();
            String sql = new String(
                    stream.readAllBytes(),
                    StandardCharsets.UTF_8)
                    .toLowerCase();
            assertThat(sql).doesNotContain("insert into role_permissions");
            assertThat(sql).doesNotContain("insert into roles");
            assertThat(sql).doesNotContain("insert into tenants");
        }
    }

    @Test
    void databaseEnforcesTenantValidationUniquenessAndSoftDelete()
            throws Exception {
        seedSupplierRows();
        try (Connection connection = DriverManager.getConnection(
                        v37JdbcUrl,
                        username,
                        password);
                Statement statement = connection.createStatement()) {
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_suppliers (
                      tenant_id, business_code, name)
                    VALUES (
                      '97000000-0000-0000-0000-000000000001',
                      'SUP_A',
                      'Duplicate')
                    """))
                    .hasMessageContaining("uq_tenant_suppliers_code");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO tenant_suppliers (
                      tenant_id, business_code, name)
                    VALUES (
                      '97000000-0000-0000-0000-000000000001',
                      'lowercase',
                      'Invalid')
                    """))
                    .hasMessageContaining("ck_tenant_suppliers_code");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    UPDATE tenant_suppliers
                    SET contact_name = repeat('x', 121)
                    WHERE id =
                      '97000000-0000-0000-0000-000000000031'
                    """))
                    .hasMessageContaining(
                            "value too long for type character varying(120)");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    UPDATE tenant_suppliers
                    SET contact_name = '   '
                    WHERE id =
                      '97000000-0000-0000-0000-000000000031'
                    """))
                    .hasMessageContaining(
                            "ck_tenant_suppliers_contact_name");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    UPDATE tenant_suppliers
                    SET status = 'DELETED'
                    WHERE id =
                      '97000000-0000-0000-0000-000000000031'
                    """))
                    .hasMessageContaining("ck_tenant_suppliers_status");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    DELETE FROM tenant_suppliers
                    WHERE id =
                      '97000000-0000-0000-0000-000000000031'
                    """))
                    .hasMessageContaining(
                            "tenant suppliers must be archived");
        }
    }

    @Test
    void indexSupportsStableTenantScopedLists() throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        v37JdbcUrl,
                        username,
                        password);
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("""
                        SELECT indexname
                        FROM pg_indexes
                        WHERE schemaname = current_schema()
                          AND indexname =
                            'idx_tenant_suppliers_list'
                        """)) {
            assertThat(result.next()).isTrue();
            assertThat(result.getString(1))
                    .isEqualTo("idx_tenant_suppliers_list");
        }
    }

    @Test
    void systemAdminTenantSessionDynamicallyGetsSupplierAccess()
            throws Exception {
        seedSupplierRows();
        seedSystemAdminTenantSession();
        try (ConfigurableApplicationContext context = startApplication()) {
            MockMvc mockMvc = MockMvcBuilders
                    .webAppContextSetup(
                            (WebApplicationContext) context)
                    .addFilters(context.getBean(
                            "springSecurityFilterChain",
                            Filter.class))
                    .build();
            String token = "T".repeat(43);

            mockMvc.perform(get("/api/v1/suppliers")
                            .header(
                                    "Authorization",
                                    "Bearer " + token))
                    .andExpect(status().isOk());
            mockMvc.perform(get("/api/v1/suppliers/{supplierId}",
                                    "97000000-0000-0000-0000-000000000031")
                            .header(
                                    "Authorization",
                                    "Bearer " + token)
                            .header(
                                    "X-Tenant-Id",
                                    TENANT_B.toString()))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.businessCode")
                            .value("SUP_A"));
        }
    }

    private static ConfigurableApplicationContext startApplication() {
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource(
                "supplier-integration-test",
                Map.of(
                        "server.port", "0",
                        "spring.datasource.url", v37JdbcUrl,
                        "spring.datasource.username", username,
                        "spring.datasource.password", password,
                        "erp.environment", "integration-test")));
        return new SpringApplicationBuilder(ErpApplication.class)
                .web(WebApplicationType.SERVLET)
                .environment(environment)
                .run();
    }

    private static void seedTenants(String jdbcUrl) throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        jdbcUrl,
                        username,
                        password);
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (id, code, name)
                    VALUES
                      (
                        '97000000-0000-0000-0000-000000000001',
                        'supplier_a',
                        'Supplier A'
                      ),
                      (
                        '97000000-0000-0000-0000-000000000002',
                        'supplier_b',
                        'Supplier B'
                      )
                    """);
        }
    }

    private static void seedUsers() throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        v37JdbcUrl,
                        username,
                        password);
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO users (
                      id, tenant_id, username, display_name)
                    VALUES (
                      '97000000-0000-0000-0000-000000000011',
                      '97000000-0000-0000-0000-000000000001',
                      'supplier_user',
                      'Supplier User')
                    ON CONFLICT (id) DO NOTHING
                    """);
        }
    }

    private static void seedSupplierRows() throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        v37JdbcUrl,
                        username,
                        password);
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenant_suppliers (
                      id, tenant_id, business_code, name)
                    VALUES
                      (
                        '97000000-0000-0000-0000-000000000031',
                        '97000000-0000-0000-0000-000000000001',
                        'SUP_A',
                        'Supplier A'
                      ),
                      (
                        '97000000-0000-0000-0000-000000000032',
                        '97000000-0000-0000-0000-000000000002',
                        'SUP_A',
                        'Supplier A Tenant B'
                      )
                    ON CONFLICT (id) DO NOTHING
                    """);
        }
    }

    private static void seedSystemAdminTenantSession()
            throws Exception {
        String tenantTokenHash = sha256("T".repeat(43));
        String platformTokenHash = sha256("P".repeat(43));
        try (Connection connection = DriverManager.getConnection(
                        v37JdbcUrl,
                        username,
                        password);
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO system_admins (
                      id, username, display_name, password_hash,
                      status, created_at, updated_at)
                    VALUES (
                      '97000000-0000-0000-0000-000000000021',
                      'supplier_system_admin',
                      'Supplier System Admin',
                      '{noop}integration-only',
                      'ACTIVE',
                      now(),
                      now())
                    ON CONFLICT (id) DO NOTHING
                    """);
            statement.executeUpdate("""
                    INSERT INTO platform_admin_sessions (
                      id, system_admin_id, token_hash,
                      expires_at, created_at)
                    VALUES (
                      '97000000-0000-0000-0000-000000000022',
                      '97000000-0000-0000-0000-000000000021',
                      '%s',
                      now() + interval '1 hour',
                      now())
                    ON CONFLICT (id) DO NOTHING
                    """.formatted(platformTokenHash));
            statement.executeUpdate("""
                    INSERT INTO platform_admin_tenant_sessions (
                      id, platform_session_id, system_admin_id,
                      tenant_id, token_hash, expires_at, created_at)
                    VALUES (
                      '97000000-0000-0000-0000-000000000023',
                      '97000000-0000-0000-0000-000000000022',
                      '97000000-0000-0000-0000-000000000021',
                      '97000000-0000-0000-0000-000000000001',
                      '%s',
                      now() + interval '1 hour',
                      now())
                    ON CONFLICT (id) DO NOTHING
                    """.formatted(tenantTokenHash));
        }
    }

    private static String sha256(String value) {
        SessionTokenService tokenService = new SessionTokenService(
                new java.security.SecureRandom(),
                java.time.Clock.systemUTC(),
                java.time.Duration.ofHours(8));
        return tokenService.hash(value);
    }

    private static void migrateTo(String jdbcUrl, String version) {
        Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion(version))
                .load()
                .migrate();
    }

    private static void migrateAll(String jdbcUrl) {
        Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .load()
                .migrate();
    }

    private static void configureDatabase() {
        String external = System.getenv("ERP_TEST_DB_URL");
        if (external != null && !external.isBlank()) {
            baseJdbcUrl = external;
            username = required("ERP_TEST_DB_USER");
            password = required("ERP_TEST_DB_PASSWORD");
            return;
        }
        try {
            postgres = new PostgreSQLContainer<>(
                    "postgres:16-alpine")
                    .withDatabaseName("erp_supplier_test")
                    .withUsername("erp_test")
                    .withPassword("integration-test-only");
            postgres.start();
            baseJdbcUrl = postgres.getJdbcUrl();
            username = postgres.getUsername();
            password = postgres.getPassword();
        } catch (RuntimeException unavailable) {
            Assumptions.assumeTrue(
                    false,
                    "Docker is unavailable and ERP_TEST_DB_URL was not supplied");
        }
    }

    private static void createSchema(String schema) throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        baseJdbcUrl,
                        username,
                        password);
                Statement statement = connection.createStatement()) {
            statement.execute("CREATE SCHEMA \"" + schema + "\"");
        }
    }

    private static void dropSchema(String schema) throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        baseJdbcUrl,
                        username,
                        password);
                Statement statement = connection.createStatement()) {
            statement.execute(
                    "DROP SCHEMA \"" + schema + "\" CASCADE");
        }
    }

    private static String withSchema(
            String jdbcUrl,
            String schema) {
        return jdbcUrl
                + (jdbcUrl.contains("?") ? "&" : "?")
                + "currentSchema="
                + schema;
    }

    private static String compactUuid() {
        return UUID.randomUUID()
                .toString()
                .replace("-", "");
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is required");
        }
        return value;
    }
}
