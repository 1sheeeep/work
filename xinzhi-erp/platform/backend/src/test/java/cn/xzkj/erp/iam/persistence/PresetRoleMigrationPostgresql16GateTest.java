package cn.xzkj.erp.iam.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import cn.xzkj.erp.iam.roles.PresetRoleCatalog;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;

class PresetRoleMigrationPostgresql16GateTest {

    private static PostgreSQLContainer<?> postgres;
    private static String jdbcUrl;
    private static String username;
    private static String password;

    @BeforeAll
    static void migrateHistoricalTenant() throws Exception {
        configureDatabase();
        flywayTo("114").clean();
        flywayTo("114").migrate();
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (id, code, name) VALUES
                      ('11500000-0000-4000-8000-000000000001',
                       'preset_role_gate', 'Preset Role Gate')
                    """);
            statement.executeUpdate("""
                    INSERT INTO roles (
                        id, tenant_id, code, name, description, system_role
                    ) VALUES
                      ('11500000-0000-4000-8000-000000000002',
                       '11500000-0000-4000-8000-000000000001',
                       'tenant_admin', 'Enterprise Administrator',
                       'Protected enterprise administrator role', true),
                      ('11500000-0000-4000-8000-000000000003',
                       '11500000-0000-4000-8000-000000000001',
                       'custom_auditor', '自定义审计员', null, false)
                    """);
        }
        flywayTo("115").migrate();
    }

    @AfterAll
    static void stop() {
        if (postgres != null) {
            postgres.stop();
        }
    }

    @Test
    void backfillsChineseAdminAndTwelveAssignableProtectedPresets()
            throws Exception {
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            assertThat(singleString(statement, """
                    SELECT name || ':' || system_role || ':' || preset_role
                    FROM roles
                    WHERE tenant_id = '11500000-0000-4000-8000-000000000001'
                      AND code = 'tenant_admin'
                    """)).isEqualTo("企业管理员:true:false");
            assertThat(singleLong(statement, """
                    SELECT count(*)
                    FROM roles
                    WHERE tenant_id = '11500000-0000-4000-8000-000000000001'
                      AND preset_role = true
                      AND system_role = false
                    """)).isEqualTo(12);
            assertThat(singleString(statement, """
                    SELECT name || ':' || system_role || ':' || preset_role
                    FROM roles
                    WHERE tenant_id = '11500000-0000-4000-8000-000000000001'
                      AND code = 'custom_auditor'
                    """)).isEqualTo("自定义审计员:false:false");
        }
    }

    @Test
    void backfillsExactDepartmentMatrixAndChinesePermissionCopy()
            throws Exception {
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            for (PresetRoleCatalog.Definition definition
                    : PresetRoleCatalog.DEFINITIONS) {
                assertThat(singleString(statement, """
                        SELECT string_agg(permission.code, ',' ORDER BY permission.code)
                        FROM roles role
                        JOIN role_permissions assignment
                          ON assignment.tenant_id = role.tenant_id
                         AND assignment.role_id = role.id
                        JOIN permissions permission
                          ON permission.id = assignment.permission_id
                        WHERE role.tenant_id = '11500000-0000-4000-8000-000000000001'
                          AND role.code = '%s'
                        """.formatted(definition.code())))
                        .isEqualTo(definition.permissionCodes().stream()
                                .sorted()
                                .collect(java.util.stream.Collectors.joining(",")));
            }
            assertThat(singleString(statement, """
                    SELECT name || ':' || description
                    FROM permissions
                    WHERE code = 'customer_service.read'
                    """)).startsWith("进入客服工作台:进入企业客服工作台");
            assertThat(singleLong(statement, """
                    SELECT count(*)
                    FROM role_permissions assignment
                    JOIN roles role ON role.id = assignment.role_id
                    WHERE assignment.tenant_id <> role.tenant_id
                    """)).isZero();
        }
    }

    @Test
    void databaseRejectsRoleThatIsBothSystemAndPreset() throws Exception {
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            assertThatThrownBy(() -> statement.executeUpdate("""
                    UPDATE roles
                    SET preset_role = true
                    WHERE id = '11500000-0000-4000-8000-000000000002'
                    """)).hasMessageContaining("ck_roles_managed_kind");
        }
    }

    private static void configureDatabase() {
        String externalUrl = System.getenv("ERP_TEST_DB_URL");
        if (externalUrl != null && !externalUrl.isBlank()) {
            jdbcUrl = externalUrl;
            username = System.getenv().getOrDefault(
                    "ERP_TEST_DB_USER", "erp_test");
            password = System.getenv().getOrDefault(
                    "ERP_TEST_DB_PASSWORD", "erp_test");
            return;
        }
        postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                .withImagePullPolicy(imageName -> false)
                .withDatabaseName("erp_preset_role_gate")
                .withUsername("erp_test")
                .withPassword("erp_test");
        postgres.start();
        jdbcUrl = postgres.getJdbcUrl();
        username = postgres.getUsername();
        password = postgres.getPassword();
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

    private static String singleString(Statement statement, String sql)
            throws Exception {
        try (ResultSet result = statement.executeQuery(sql)) {
            result.next();
            return result.getString(1);
        }
    }
}
