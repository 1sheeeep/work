package cn.xzkj.erp.platformadmin.bootstrap;

import static org.assertj.core.api.Assertions.assertThat;

import cn.xzkj.erp.ErpApplication;
import cn.xzkj.erp.platformadmin.application.PlatformAdminCredentialService;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.Map;
import java.util.Set;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.testcontainers.containers.PostgreSQLContainer;

class PlatformAdminBootstrapIntegrationTest {

    private static PostgreSQLContainer<?> postgres;
    private static ConfigurableApplicationContext context;
    private static String jdbcUrl;
    private static String username;
    private static String password;
    private static Path temporaryDirectory;

    @BeforeAll
    static void start() throws Exception {
        configureDatabase();
        Flyway flyway = Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .locations("classpath:db/migration")
                .cleanDisabled(false)
                .load();
        flyway.clean();
        flyway.migrate();
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource(
                "platform-bootstrap-integration-test",
                Map.of(
                        "spring.datasource.url", jdbcUrl,
                        "spring.datasource.username", username,
                        "spring.datasource.password", password,
                        "erp.environment", "integration-test")));
        context = new SpringApplicationBuilder(ErpApplication.class)
                .web(WebApplicationType.NONE)
                .environment(environment)
                .run();
        temporaryDirectory = Files.createTempDirectory(
                "erp-platform-admin-bootstrap-");
    }

    @AfterAll
    static void stop() throws Exception {
        if (context != null) {
            context.close();
        }
        if (temporaryDirectory != null) {
            try (var files = Files.list(temporaryDirectory)) {
                for (Path file : files.toList()) {
                    Files.deleteIfExists(file);
                }
            }
            Files.deleteIfExists(temporaryDirectory);
        }
        if (postgres != null) {
            postgres.stop();
        }
    }

    @Test
    void initialProvisionIsFileRestrictedIdempotentAndRecoverable()
            throws Exception {
        PlatformAdminBootstrapService bootstrap =
                context.getBean(PlatformAdminBootstrapService.class);
        PlatformAdminCredentialService credentials =
                context.getBean(PlatformAdminCredentialService.class);
        Path initialFile = temporaryDirectory.resolve("initial.token");
        PlatformAdminBootstrapCommand initial =
                new PlatformAdminBootstrapCommand(
                        "18002629295",
                        "Bootstrap Admin",
                        initialFile,
                        30,
                        false);

        bootstrap.provision(initial);
        String initialToken = Files.readString(initialFile);
        assertThat(initialToken).hasSize(43);
        if (Files.getFileStore(initialFile)
                .supportsFileAttributeView("posix")) {
            assertThat(Files.getPosixFilePermissions(initialFile))
                    .isEqualTo(Set.of(
                            PosixFilePermission.OWNER_READ,
                            PosixFilePermission.OWNER_WRITE));
        }
        assertThat(singleLong(
                "SELECT count(*) FROM system_admins"))
                .isOne();
        assertThat(singleString("""
                SELECT status FROM system_admins
                WHERE username = '+8618002629295'
                  AND email IS NULL
                  AND phone_number = '+8618002629295'
                """)).isEqualTo("PENDING_ACTIVATION");
        assertThat(singleString("""
                SELECT token_hash
                FROM platform_admin_password_credentials
                WHERE system_admin_id = (
                    SELECT id FROM system_admins
                    WHERE username = '+8618002629295'
                )
                """)).doesNotContain(initialToken);

        bootstrap.provision(initial);
        assertThat(singleLong(
                "SELECT count(*) FROM system_admins"))
                .isOne();
        assertThat(Files.readString(initialFile))
                .isEqualTo(initialToken);

        Files.delete(initialFile);
        Path recoveryFile = temporaryDirectory.resolve("recovery.token");
        bootstrap.provision(new PlatformAdminBootstrapCommand(
                "+8618002629295",
                "Bootstrap Admin",
                recoveryFile,
                30,
                true));
        String recoveryToken = Files.readString(recoveryFile);
        assertThat(recoveryToken).hasSize(43).isNotEqualTo(initialToken);
        credentials.redeem(
                recoveryToken.toCharArray(),
                "recovered-platform-password".toCharArray(),
                "bootstrap-recovery-test",
                "127.0.0.1");
        assertThat(singleString("""
                SELECT status FROM system_admins
                WHERE username = '+8618002629295'
                """)).isEqualTo("ACTIVE");
        assertThat(singleLong("""
                SELECT active_count
                FROM system_admin_state_guard
                """)).isOne();
    }

    private static long singleLong(String sql) throws Exception {
        try (Connection connection =
                        DriverManager.getConnection(jdbcUrl, username, password);
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(sql)) {
            result.next();
            return result.getLong(1);
        }
    }

    private static String singleString(String sql) throws Exception {
        try (Connection connection =
                        DriverManager.getConnection(jdbcUrl, username, password);
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(sql)) {
            result.next();
            return result.getString(1);
        }
    }

    private static void configureDatabase() {
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
}
