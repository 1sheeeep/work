package cn.xzkj.erp.iam.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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

class IamEmailLoginMigrationPostgresql16GateTest {

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
                .withDatabaseName("erp_iam_email_gate")
                .withUsername("erp_test")
                .withPassword("erp_test");
        postgres.start();
        jdbcUrl = postgres.getJdbcUrl();
        username = postgres.getUsername();
        password = postgres.getPassword();
    }

    @BeforeEach
    void cleanDatabase() {
        flyway().clean();
    }

    @AfterAll
    static void stopPostgres16() {
        if (postgres != null) {
            postgres.stop();
        }
    }

    @Test
    void migratesEmptyPostgres16ThroughV42() throws Exception {
        Flyway flyway = flyway();
        flyway.migrate();

        assertThat(flyway.info().current().getVersion().getVersion())
                .isEqualTo("42");
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            assertThat(singleLong(statement, """
                    SELECT count(*)
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND (
                        (table_name = 'users'
                          AND column_name IN ('email', 'phone_number'))
                        OR
                        (table_name = 'system_admins'
                          AND column_name = 'email')
                      )
                    """)).isEqualTo(3);
            assertThat(singleLong(statement, """
                    SELECT count(*)
                    FROM pg_indexes
                    WHERE schemaname = 'public'
                      AND indexname IN (
                        'uq_users_tenant_email_ci',
                        'uq_system_admins_email_ci'
                      )
                    """)).isEqualTo(2);
        }
    }

    @Test
    void backfillsEmailIdentitiesAndPreservesLegacyWithoutCrossTenantCollision()
            throws Exception {
        migrateToV40();
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (id, code, name) VALUES
                      ('42000000-0000-0000-0000-000000000001',
                       'email_a', 'Email A'),
                      ('42000000-0000-0000-0000-000000000002',
                       'email_b', 'Email B')
                    """);
            statement.executeUpdate("""
                    INSERT INTO users (
                        id, tenant_id, username, display_name
                    ) VALUES
                      ('42100000-0000-0000-0000-000000000001',
                       '42000000-0000-0000-0000-000000000001',
                       'Employee@Example.COM', 'Email User A'),
                      ('42100000-0000-0000-0000-000000000002',
                       '42000000-0000-0000-0000-000000000002',
                       'employee@example.com', 'Email User B'),
                      ('42100000-0000-0000-0000-000000000003',
                       '42000000-0000-0000-0000-000000000001',
                       'legacy_operator', 'Legacy User')
                    """);
            statement.executeUpdate("""
                    INSERT INTO system_admins (
                        id, username, display_name, status,
                        created_at, updated_at
                    ) VALUES (
                        '42200000-0000-0000-0000-000000000001',
                        'Platform.Admin@Example.COM',
                        'Platform Admin',
                        'PENDING_ACTIVATION',
                        now(),
                        now()
                    )
                    """);
        }

        flyway().migrate();

        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            assertThat(singleString(statement, """
                    SELECT username || '|' || email
                    FROM users
                    WHERE id =
                      '42100000-0000-0000-0000-000000000001'
                    """)).isEqualTo(
                    "employee@example.com|employee@example.com");
            assertThat(singleString(statement, """
                    SELECT username || '|' || coalesce(email, '<null>')
                    FROM users
                    WHERE id =
                      '42100000-0000-0000-0000-000000000003'
                    """)).isEqualTo("legacy_operator|<null>");
            assertThat(singleString(statement, """
                    SELECT username || '|' || email
                    FROM system_admins
                    WHERE id =
                      '42200000-0000-0000-0000-000000000001'
                    """)).isEqualTo(
                    "platform.admin@example.com|platform.admin@example.com");

            statement.executeUpdate("""
                    INSERT INTO users (
                        id, tenant_id, username, email, display_name
                    ) VALUES (
                        '42100000-0000-0000-0000-000000000004',
                        '42000000-0000-0000-0000-000000000002',
                        'other@example.com',
                        'other@example.com',
                        'Other Tenant Email'
                    )
                    """);
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO users (
                        id, tenant_id, username, email, display_name
                    ) VALUES (
                        '42100000-0000-0000-0000-000000000005',
                        '42000000-0000-0000-0000-000000000001',
                        'employee@example.com',
                        'employee@example.com',
                        'Duplicate Tenant Email'
                    )
                    """)).hasMessageContaining("unique constraint");
        }
    }

    @Test
    void failsClosedOnHistoricalCaseInsensitiveDuplicateWithinTenant()
            throws Exception {
        migrateToV40();
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (id, code, name)
                    VALUES (
                      '42300000-0000-0000-0000-000000000001',
                      'duplicate_email',
                      'Duplicate Email')
                    """);
            statement.executeUpdate("""
                    INSERT INTO users (
                        id, tenant_id, username, display_name
                    ) VALUES
                      ('42400000-0000-0000-0000-000000000001',
                       '42300000-0000-0000-0000-000000000001',
                       'Duplicate@Example.com', 'Duplicate One'),
                      ('42400000-0000-0000-0000-000000000002',
                       '42300000-0000-0000-0000-000000000001',
                       'duplicate@example.COM', 'Duplicate Two')
                    """);
        }

        assertThatThrownBy(() -> flyway().migrate())
                .hasMessageContaining(
                        "duplicate case-insensitive tenant email prevents V42 migration");
    }

    @Test
    void enforcesEmailPhoneAndImmutableIdentityConstraints() throws Exception {
        flyway().migrate();
        try (Connection connection = connection();
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (id, code, name)
                    VALUES (
                      '42500000-0000-0000-0000-000000000001',
                      'constraints',
                      'Constraint Tenant')
                    """);
            statement.executeUpdate("""
                    INSERT INTO users (
                        id, tenant_id, username, email, phone_number,
                        display_name
                    ) VALUES (
                        '42600000-0000-0000-0000-000000000001',
                        '42500000-0000-0000-0000-000000000001',
                        'member@example.com',
                        'member@example.com',
                        '+8613800138000',
                        'Member')
                    """);

            assertThatThrownBy(() -> statement.executeUpdate("""
                    UPDATE users
                    SET email = 'changed@example.com',
                        username = 'changed@example.com'
                    WHERE id =
                      '42600000-0000-0000-0000-000000000001'
                    """)).hasMessageContaining("IAM login identities are immutable");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    UPDATE users
                    SET phone_number = '13800138000'
                    WHERE id =
                      '42600000-0000-0000-0000-000000000001'
                    """)).hasMessageContaining("ck_users_phone_number_e164");
            assertThatThrownBy(() -> statement.executeUpdate("""
                    INSERT INTO users (
                        id, tenant_id, username, email, display_name
                    ) VALUES (
                        '42600000-0000-0000-0000-000000000002',
                        '42500000-0000-0000-0000-000000000001',
                        'mixed@example.com',
                        'Mixed@Example.com',
                        'Mixed Case')
                    """)).hasMessageContaining("ck_users_login_identifier");
        }
    }

    private static void migrateToV40() {
        Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion("40"))
                .load()
                .migrate();
    }

    private static Flyway flyway() {
        return Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion("42"))
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
