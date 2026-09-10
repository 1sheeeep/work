package cn.xzkj.erp.platformadmin.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;

class PlatformAdminMigrationIntegrationTest {

    private static PostgreSQLContainer<?> postgres;
    private static String jdbcUrl;
    private static String username;
    private static String password;

    @BeforeAll
    static void configure() {
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
        try {
            postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("erp_test")
                    .withUsername("erp_test")
                    .withPassword("erp_test");
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

    @AfterAll
    static void stop() {
        if (postgres != null) {
            postgres.stop();
        }
    }

    @Test
    void migratesEmptyPostgres16FromV1ThroughV42() throws Exception {
        clean();
        Flyway flyway = flyway();
        flyway.migrate();
        assertThat(flyway.info().current().getVersion().getVersion())
                .isEqualTo("42");
        try (Connection connection =
                        DriverManager.getConnection(jdbcUrl, username, password);
                Statement statement = connection.createStatement()) {
            assertThat(count(statement, "system_admins")).isZero();
            assertThat(count(statement, "system_admin_state_guard")).isOne();
            assertThat(singleInt(
                    statement,
                    "SELECT active_count FROM system_admin_state_guard"))
                    .isZero();
        }
    }

    @Test
    void upgradesPopulatedV36WithoutChangingHistoricalRows() throws Exception {
        clean();
        Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion("36"))
                .load()
                .migrate();
        try (Connection connection =
                        DriverManager.getConnection(jdbcUrl, username, password);
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (
                        id, code, name, status, created_at, updated_at
                    ) VALUES (
                        '97000000-0000-0000-0000-000000000001',
                        'history_tenant',
                        'Historical Tenant',
                        'ACTIVE',
                        '2026-01-01T00:00:00Z',
                        '2026-01-02T00:00:00Z'
                    )
                    """);
            statement.executeUpdate("""
                    INSERT INTO users (
                        id, tenant_id, username, display_name, password_hash,
                        status, created_at, updated_at, version
                    ) VALUES (
                        '97000000-0000-0000-0000-000000000002',
                        '97000000-0000-0000-0000-000000000001',
                        'historical_admin',
                        'Historical Admin',
                        '{bcrypt}$2a$12$KIXxP17x3JOmeEjfZu.mL.OvXz0fdJJo8Y6hJfP8qc5Q5x6gX1zPW',
                        'ACTIVE',
                        '2026-01-01T00:00:00Z',
                        '2026-01-02T00:00:00Z',
                        4
                    )
                    """);
        }

        Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .load()
                .migrate();

        try (Connection connection =
                        DriverManager.getConnection(jdbcUrl, username, password);
                Statement statement = connection.createStatement()) {
            assertThat(singleString(
                    statement,
                    "SELECT name FROM tenants WHERE code = 'history_tenant'"))
                    .isEqualTo("Historical Tenant");
            assertThat(singleInt(
                    statement,
                    "SELECT version FROM tenants WHERE code = 'history_tenant'"))
                    .isZero();
            assertThat(singleInt(
                    statement,
                    "SELECT version FROM users WHERE username = 'historical_admin'"))
                    .isEqualTo(4);
            assertThat(count(statement, "system_admins")).isZero();
        }
    }

    @Test
    void databaseGuardSerializesConcurrentLastActiveRemoval() throws Exception {
        clean();
        flyway().migrate();
        try (Connection connection =
                        DriverManager.getConnection(jdbcUrl, username, password);
                Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO system_admins (
                        id, username, display_name, password_hash,
                        status, created_at, updated_at
                    ) VALUES
                        ('97000000-0000-0000-0000-000000000010',
                         'guard_a', 'Guard A', '{bcrypt}hash', 'ACTIVE',
                         now(), now()),
                        ('97000000-0000-0000-0000-000000000011',
                         'guard_b', 'Guard B', '{bcrypt}hash', 'ACTIVE',
                         now(), now())
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenants (
                        id, code, name, status, created_at, updated_at
                    ) VALUES (
                        '97000000-0000-0000-0000-000000000020',
                        'guard_tenant', 'Guard Tenant', 'ACTIVE',
                        now(), now()
                    )
                    """);
            statement.executeUpdate("""
                    INSERT INTO platform_admin_sessions (
                        id, system_admin_id, token_hash,
                        expires_at, created_at
                    ) VALUES (
                        '97000000-0000-0000-0000-000000000021',
                        '97000000-0000-0000-0000-000000000010',
                        repeat('a', 64), now() + interval '1 hour', now()
                    )
                    """);
            org.assertj.core.api.Assertions.assertThatThrownBy(() ->
                            statement.executeUpdate("""
                                    INSERT INTO platform_admin_tenant_sessions (
                                        id, platform_session_id,
                                        system_admin_id, tenant_id, token_hash,
                                        expires_at, created_at
                                    ) VALUES (
                                        '97000000-0000-0000-0000-000000000022',
                                        '97000000-0000-0000-0000-000000000021',
                                        '97000000-0000-0000-0000-000000000011',
                                        '97000000-0000-0000-0000-000000000020',
                                        repeat('b', 64),
                                        now() + interval '1 hour', now()
                                    )
                                    """))
                    .hasMessageContaining(
                            "fk_platform_admin_tenant_session_base_actor");
            statement.executeUpdate("""
                    UPDATE system_admins
                    SET status = 'DISABLED', updated_at = now()
                    WHERE username = 'guard_a'
                    """);
            org.assertj.core.api.Assertions.assertThatThrownBy(() ->
                            statement.executeUpdate("""
                                    UPDATE system_admins
                                    SET status = 'DISABLED', updated_at = now()
                                    WHERE username = 'guard_b'
                                    """))
                    .hasMessageContaining(
                            "at least one active system administrator");
            assertThat(singleInt(
                    statement,
                    "SELECT active_count FROM system_admin_state_guard"))
                    .isOne();
            org.assertj.core.api.Assertions.assertThatThrownBy(() ->
                            statement.executeUpdate("""
                                    DELETE FROM system_admins
                                    WHERE username = 'guard_b'
                                    """))
                    .hasMessageContaining(
                            "system administrators must be soft deleted");
        }
    }

    private static Flyway flyway() {
        return Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion("42"))
                .cleanDisabled(false)
                .load();
    }

    private static void clean() {
        flyway().clean();
    }

    private static long count(Statement statement, String table)
            throws Exception {
        try (ResultSet result =
                statement.executeQuery("SELECT count(*) FROM " + table)) {
            result.next();
            return result.getLong(1);
        }
    }

    private static int singleInt(Statement statement, String sql)
            throws Exception {
        try (ResultSet result = statement.executeQuery(sql)) {
            result.next();
            return result.getInt(1);
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
