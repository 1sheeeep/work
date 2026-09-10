package cn.xzkj.erp.settings.deadline;

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

class ShippingDeadlineSettingPostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_A = UUID.fromString(
            "a9400000-0000-4000-8000-000000000001");
    private static final UUID TENANT_B = UUID.fromString(
            "b9400000-0000-4000-8000-000000000001");
    private static final UUID USER_A = UUID.fromString(
            "a9400000-0000-4000-8000-000000000002");
    private static String containerName;
    private static ShippingDeadlineSettingRepository repository;

    @BeforeAll
    static void migrateAndSeed() throws Exception {
        String jdbcUrl = startPostgresql16();
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
                  ('a9400000-0000-4000-8000-000000000001', 'deadline_a', 'Tenant A'),
                  ('b9400000-0000-4000-8000-000000000001', 'deadline_b', 'Tenant B');
                insert into users (id, tenant_id, username, display_name) values
                  ('a9400000-0000-4000-8000-000000000002',
                   'a9400000-0000-4000-8000-000000000001', 'deadline-a', 'User A');
                """, new MapSqlParameterSource());
        repository = new ShippingDeadlineSettingRepository(jdbc);
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void settingIsTenantOwnedVersionedAndConstrained() {
        assertThat(repository.find(TENANT_A))
                .satisfies(value -> {
                    assertThat(value.configured()).isFalse();
                    assertThat(value.deadlineDays()).isEqualTo(3);
                });
        assertThat(repository.deadlineDays(TENANT_B)).isEqualTo(3);
        repository.insert(TENANT_A, 5, actor());
        assertThat(repository.deadlineDays(TENANT_A)).isEqualTo(5);
        assertThat(repository.deadlineDays(TENANT_B)).isEqualTo(3);
        assertThat(repository.update(TENANT_A, 9, 6, actor())).isFalse();
        assertThat(repository.update(TENANT_A, 0, 6, actor())).isTrue();
        assertThat(repository.find(TENANT_A).version()).isEqualTo(1);
        assertThatThrownBy(() -> repository.insert(TENANT_B, 0,
                new ShippingDeadlineSettingService.Actor(
                        TENANT_B, null, UUID.randomUUID(), "Admin",
                        "request-b", "127.0.0.1")))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private static ShippingDeadlineSettingService.Actor actor() {
        return new ShippingDeadlineSettingService.Actor(
                TENANT_A, USER_A, null, "User A", "request-a", "127.0.0.1");
    }

    private static String startPostgresql16() throws Exception {
        containerName = "erp-shipping-deadline-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker(
                "run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_shipping_deadline",
                "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        String jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(binding.lastIndexOf(':') + 1)
                + "/erp_shipping_deadline";
        long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
        while (System.nanoTime() < deadline) {
            try (Connection ignored = DriverManager.getConnection(
                    jdbcUrl, DB_USER, DB_PASSWORD)) {
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
            Process process = new ProcessBuilder(command)
                    .redirectErrorStream(true).start();
            String output = new String(process.getInputStream().readAllBytes(),
                    java.nio.charset.StandardCharsets.UTF_8);
            if (!process.waitFor(60, TimeUnit.SECONDS)
                    || process.exitValue() != 0) {
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
