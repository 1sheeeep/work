package cn.xzkj.erp.settings.enterprise;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class EnterpriseProfilePostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_A = UUID.fromString(
            "a8000000-0000-4000-8000-000000000001");
    private static final UUID TENANT_B = UUID.fromString(
            "b8000000-0000-4000-8000-000000000001");
    private static final UUID USER_A = UUID.fromString(
            "a8000000-0000-4000-8000-000000000002");
    private static final UUID USER_B = UUID.fromString(
            "b8000000-0000-4000-8000-000000000002");
    private static String containerName;
    private static String jdbcUrl;
    private static EnterpriseProfileRepository repository;

    @BeforeAll
    static void migrateAndSeed() throws Exception {
        startPostgresql16();
        Flyway migration = Flyway.configure()
                .dataSource(jdbcUrl, DB_USER, DB_PASSWORD)
                .locations("classpath:db/migration").load();
        assertThat(migration.migrate().success).isTrue();
        assertThat(migration.info().current().getVersion().getVersion())
                .isEqualTo("123");
        NamedParameterJdbcTemplate jdbc = new NamedParameterJdbcTemplate(
                new DriverManagerDataSource(jdbcUrl, DB_USER, DB_PASSWORD));
        jdbc.update("""
                insert into tenants (id, code, name) values
                  ('a8000000-0000-4000-8000-000000000001', 'profile_a', 'Tenant A'),
                  ('b8000000-0000-4000-8000-000000000001', 'profile_b', 'Tenant B');
                insert into users (id, tenant_id, username, display_name) values
                  ('a8000000-0000-4000-8000-000000000002',
                   'a8000000-0000-4000-8000-000000000001', 'profile-a', 'User A'),
                  ('b8000000-0000-4000-8000-000000000002',
                   'b8000000-0000-4000-8000-000000000001', 'profile-b', 'User B');
                """, new MapSqlParameterSource());
        repository = new EnterpriseProfileRepository(jdbc);
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void profileIsTenantOwnedVersionedAndDatabaseConstraintsFailClosed() {
        assertThat(repository.find(TENANT_A).configured()).isFalse();
        assertThat(repository.find(TENANT_B).configured()).isFalse();
        repository.insert(TENANT_A, input("Company A"), actor());
        assertThat(repository.find(TENANT_A).companyName()).isEqualTo("Company A");
        assertThat(repository.find(TENANT_B).configured()).isFalse();
        assertThat(repository.update(TENANT_A, 99, input("Stale"), actor()))
                .isFalse();
        assertThat(repository.update(TENANT_A, 0, input("Company A2"), actor()))
                .isTrue();
        assertThat(repository.find(TENANT_A))
                .satisfies(profile -> {
                    assertThat(profile.companyName()).isEqualTo("Company A2");
                    assertThat(profile.version()).isEqualTo(1);
                });
        assertThatThrownBy(() -> repository.insert(
                TENANT_A, input("Duplicate"), actor()))
                .isInstanceOf(DataIntegrityViolationException.class);
        var invalid = new EnterpriseProfileService.ProfileInput(
                "Company B", null, null, null, null, "Contact",
                "bad-email", null, "+86 13800000000", null);
        assertThatThrownBy(() -> repository.insert(TENANT_B, invalid,
                new EnterpriseProfileService.Actor(
                        TENANT_B, USER_B, null,
                        "request-b", "127.0.0.1")))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private static EnterpriseProfileService.ProfileInput input(String companyName) {
        return new EnterpriseProfileService.ProfileInput(
                companyName, "Shanghai", "Shanghai", "Pudong", "Road 1",
                "Contact", "ops@example.com", "12345678",
                "+86 13800000000", "021-12345678");
    }

    private static EnterpriseProfileService.Actor actor() {
        return new EnterpriseProfileService.Actor(
                TENANT_A, USER_A, null, "request-a", "127.0.0.1");
    }

    private static void startPostgresql16() throws Exception {
        containerName = "erp-enterprise-profile-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker(
                "run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_enterprise_profile",
                "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        int separator = binding.lastIndexOf(':');
        if (separator < 0) throw new IllegalStateException(
                "Docker did not publish PostgreSQL");
        jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(separator + 1) + "/erp_enterprise_profile";
        long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
        while (System.nanoTime() < deadline) {
            try (Connection ignored = DriverManager.getConnection(
                    jdbcUrl, DB_USER, DB_PASSWORD)) {
                return;
            } catch (java.sql.SQLException exception) {
                Thread.sleep(200);
            }
        }
        throw new IllegalStateException("PostgreSQL 16 did not become ready");
    }

    private static String runDocker(String... arguments) {
        try {
            List<String> command = new ArrayList<>();
            command.add("docker");
            command.addAll(List.of(arguments));
            Process process = new ProcessBuilder(command)
                    .redirectErrorStream(true).start();
            String output = new String(process.getInputStream().readAllBytes(),
                    java.nio.charset.StandardCharsets.UTF_8);
            if (!process.waitFor(60, TimeUnit.SECONDS) || process.exitValue() != 0) {
                throw new IllegalStateException(
                        "Docker command failed: " + output.strip());
            }
            return output.strip();
        } catch (java.io.IOException exception) {
            throw new IllegalStateException("Docker CLI is required", exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(
                    "Docker command was interrupted", exception);
        }
    }
}
