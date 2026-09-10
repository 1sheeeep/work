package cn.xzkj.erp.settings.branding;

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

class EnterpriseBrandingPostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_A = UUID.fromString("a1000000-0000-4000-8000-000000000001");
    private static final UUID TENANT_B = UUID.fromString("b1000000-0000-4000-8000-000000000001");
    private static final UUID USER_A = UUID.fromString("a1000000-0000-4000-8000-000000000002");
    private static String containerName;
    private static EnterpriseBrandingRepository repository;

    @BeforeAll
    static void migrateAndSeed() throws Exception {
        String jdbcUrl = startPostgresql16();
        Flyway migration = Flyway.configure().dataSource(jdbcUrl, DB_USER, DB_PASSWORD)
                .locations("classpath:db/migration").load();
        assertThat(migration.migrate().success).isTrue();
        assertThat(migration.info().current().getVersion().getVersion()).isEqualTo("123");
        NamedParameterJdbcTemplate jdbc = new NamedParameterJdbcTemplate(
                new DriverManagerDataSource(jdbcUrl, DB_USER, DB_PASSWORD));
        jdbc.update("""
                insert into tenants (id, code, name) values
                  ('a1000000-0000-4000-8000-000000000001', 'branding_a', 'Tenant A'),
                  ('b1000000-0000-4000-8000-000000000001', 'branding_b', 'Tenant B');
                insert into users (id, tenant_id, username, display_name) values
                  ('a1000000-0000-4000-8000-000000000002',
                   'a1000000-0000-4000-8000-000000000001', 'branding-a', 'User A'),
                  ('b1000000-0000-4000-8000-000000000002',
                   'b1000000-0000-4000-8000-000000000001', 'branding-b', 'User B');
                """, new MapSqlParameterSource());
        repository = new EnterpriseBrandingRepository(jdbc);
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void brandingIsTenantOwnedAndVersioned() {
        var settings = new EnterpriseBrandingService.SettingsInput(true,
                true, true, true, false);
        repository.insertSettings(TENANT_A, settings, actorA());
        EnterpriseBrandingRecord created = repository.find(TENANT_A);
        assertThat(created.configured()).isTrue();
        assertThat(created.watermarkEnabled()).isTrue();
        assertThat(repository.find(TENANT_B).configured()).isFalse();

        var disabled = new EnterpriseBrandingService.SettingsInput(false,
                true, true, true, false);
        assertThat(repository.updateSettings(TENANT_A, 9, disabled, actorA())).isFalse();
        assertThat(repository.updateSettings(TENANT_A, 0, disabled, actorA())).isTrue();
        assertThat(repository.find(TENANT_A).version()).isEqualTo(1);

        assertThatThrownBy(() -> repository.insertSettings(TENANT_B,
                settings, actorA()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private static EnterpriseBrandingService.Actor actorA() {
        return new EnterpriseBrandingService.Actor(TENANT_A, USER_A, null,
                "User A", "request-branding-a", "127.0.0.1");
    }

    private static String startPostgresql16() throws Exception {
        containerName = "erp-enterprise-branding-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker("run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_enterprise_branding",
                "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        String jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(binding.lastIndexOf(':') + 1)
                + "/erp_enterprise_branding";
        long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
        while (System.nanoTime() < deadline) {
            try (Connection ignored = DriverManager.getConnection(jdbcUrl,
                    DB_USER, DB_PASSWORD)) {
                return jdbcUrl;
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
            Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
            String output = new String(process.getInputStream().readAllBytes(),
                    java.nio.charset.StandardCharsets.UTF_8);
            if (!process.waitFor(60, TimeUnit.SECONDS) || process.exitValue() != 0) {
                throw new IllegalStateException("Docker command failed: " + output.strip());
            }
            return output.strip();
        } catch (java.io.IOException exception) {
            throw new IllegalStateException("Docker CLI is required", exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Docker command was interrupted", exception);
        }
    }
}
