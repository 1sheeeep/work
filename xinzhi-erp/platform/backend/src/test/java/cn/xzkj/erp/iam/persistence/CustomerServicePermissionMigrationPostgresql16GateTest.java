package cn.xzkj.erp.iam.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;

class CustomerServicePermissionMigrationPostgresql16GateTest {

    private static final String MIGRATION =
            "db/migration/V46__customer_service_permission.sql";

    private static PostgreSQLContainer<?> postgres;
    private static String jdbcUrl;
    private static String username;
    private static String password;

    @BeforeAll
    static void startPostgres16() {
        String externalUrl = System.getenv("ERP_TEST_DB_URL");
        if (externalUrl != null && !externalUrl.isBlank()) {
            jdbcUrl = externalUrl;
            username = System.getenv().getOrDefault(
                    "ERP_TEST_DB_USER",
                    "erp_test");
            password = System.getenv().getOrDefault(
                    "ERP_TEST_DB_PASSWORD",
                    "erp_test");
            return;
        }
        postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                .withImagePullPolicy(imageName -> false)
                .withDatabaseName("erp_customer_service_permission_gate")
                .withUsername("erp_test")
                .withPassword("erp_test");
        postgres.start();
        jdbcUrl = postgres.getJdbcUrl();
        username = postgres.getUsername();
        password = postgres.getPassword();
    }

    @BeforeEach
    void cleanDatabase() {
        flywayTo("46").clean();
    }

    @AfterAll
    static void stopPostgres16() {
        if (postgres != null) {
            postgres.stop();
        }
    }

    @Test
    void upgradesHistoricalTenantAdminsTenantScopedAndIdempotently()
            throws Exception {
        flywayTo("44").migrate();
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (id, code, name) VALUES
                      ('45000000-0000-0000-0000-000000000001',
                       'historical_a', 'Historical A'),
                      ('45000000-0000-0000-0000-000000000002',
                       'historical_b', 'Historical B')
                    """);
            statement.executeUpdate("""
                    INSERT INTO roles (
                        id, tenant_id, code, name, system_role
                    ) VALUES
                      ('45100000-0000-0000-0000-000000000001',
                       '45000000-0000-0000-0000-000000000001',
                       'tenant_admin', 'Tenant Admin A', true),
                      ('45100000-0000-0000-0000-000000000002',
                       '45000000-0000-0000-0000-000000000002',
                       'tenant_admin', 'Tenant Admin B', true),
                      ('45100000-0000-0000-0000-000000000003',
                       '45000000-0000-0000-0000-000000000001',
                       'support_agent', 'Support Agent', false)
                    """);
        }

        flywayTo("46").migrate();

        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            assertThat(singleLong(statement, """
                    SELECT count(*)
                    FROM role_permissions role_permission
                    JOIN permissions permission
                      ON permission.id = role_permission.permission_id
                    WHERE role_permission.role_id IN (
                      '45100000-0000-0000-0000-000000000001',
                      '45100000-0000-0000-0000-000000000002')
                      AND permission.module = 'customer_service'
                    """)).isEqualTo(12);
            assertThat(singleLong(statement, """
                    SELECT count(*)
                    FROM role_permissions role_permission
                    JOIN permissions permission
                      ON permission.id = role_permission.permission_id
                    WHERE role_permission.role_id =
                      '45100000-0000-0000-0000-000000000003'
                      AND permission.module = 'customer_service'
                    """)).isZero();
            assertThat(singleLong(statement, """
                    SELECT count(*)
                    FROM role_permissions role_permission
                    JOIN roles role ON role.id = role_permission.role_id
                    WHERE role_permission.tenant_id <> role.tenant_id
                    """)).isZero();

            statement.execute(loadMigrationSQL());
            assertThat(singleLong(statement, """
                    SELECT count(*)
                    FROM role_permissions role_permission
                    JOIN permissions permission
                      ON permission.id = role_permission.permission_id
                    WHERE permission.module = 'customer_service'
                    """)).isEqualTo(12);
        }
    }

    private static Flyway flywayTo(String version) {
        return Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion(version))
                .cleanDisabled(false)
                .load();
    }

    private static Connection connection() throws Exception {
        return DriverManager.getConnection(jdbcUrl, username, password);
    }

    private static long singleLong(Statement statement, String sql)
            throws Exception {
        try (ResultSet result = statement.executeQuery(sql)) {
            result.next();
            return result.getLong(1);
        }
    }

    private static String loadMigrationSQL() throws Exception {
        ClassLoader loader =
                CustomerServicePermissionMigrationPostgresql16GateTest.class
                        .getClassLoader();
        try (InputStream input = loader.getResourceAsStream(MIGRATION)) {
            if (input == null) {
                throw new IllegalStateException(
                        "Missing migration resource " + MIGRATION);
            }
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
