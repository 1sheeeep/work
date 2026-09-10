package cn.xzkj.erp.logistics.forecast;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class LogisticsForecastBatchPostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_ID = UUID.fromString(
            "a7870000-0000-4000-8000-000000000001");
    private static final UUID USER_ID = UUID.fromString(
            "a7870000-0000-4000-8000-000000000002");
    private static String containerName;
    private static String jdbcUrl;
    private static LogisticsForecastBatchRepository repository;

    @BeforeAll
    static void migrate() throws Exception {
        startPostgresql16();
        Flyway migration = Flyway.configure()
                .dataSource(jdbcUrl, DB_USER, DB_PASSWORD)
                .locations("classpath:db/migration")
                .load();
        assertThat(migration.migrate().success).isTrue();
        assertThat(migration.info().current().getVersion().getVersion())
                .isEqualTo("123");
        NamedParameterJdbcTemplate jdbc = new NamedParameterJdbcTemplate(
                new DriverManagerDataSource(jdbcUrl, DB_USER, DB_PASSWORD));
        jdbc.getJdbcOperations().update("""
                insert into tenants (id, code, name)
                values ('a7870000-0000-4000-8000-000000000001',
                        'forecast_uat', 'Forecast UAT');
                insert into users (id, tenant_id, username, display_name)
                values ('a7870000-0000-4000-8000-000000000002',
                        'a7870000-0000-4000-8000-000000000001',
                        'forecast.operator', 'Forecast Operator');
                """);
        repository = new LogisticsForecastBatchRepository(jdbc);
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void boundedForecastListQueryIsValidAgainstPostgresql16() {
        var page = repository.list(UUID.randomUUID(),
                new LogisticsForecastBatchService.Filters(
                        "PENDING", "100%_daily\\", "uat", false,
                        "order-001", "forwarder"),
                PageRequest.of(0, 25));
        assertThat(page).isEmpty();
        assertThat(page.getTotalElements()).isZero();
    }

    @Test
    void createsCompletesAndPrintsForecastBatchAgainstPostgresql16() {
        UUID id = UUID.randomUUID();
        var actor = new LogisticsForecastBatchService.Actor(
                TENANT_ID, USER_ID, null, "Forecast Operator",
                "forecast-pg16-uat", "127.0.0.1");
        repository.insert(id, TENANT_ID, "FB-20260810-000000-ABC123",
                new LogisticsForecastBatchService.BatchInput(
                        "UAT Daily", "UAT Forwarder",
                        List.of("UAT-ORDER-001", "UAT-ORDER-002"),
                        new BigDecimal("2.500")), actor);

        LogisticsForecastBatchRecord pending = repository.find(TENANT_ID, id);
        assertThat(pending.status()).isEqualTo("PENDING");
        assertThat(pending.orderReferences())
                .containsExactly("UAT-ORDER-001", "UAT-ORDER-002");

        assertThat(repository.updateStatus(TENANT_ID, id, pending.version(),
                "SUCCEEDED", null, actor)).isTrue();
        LogisticsForecastBatchRecord succeeded = repository.find(TENANT_ID, id);
        assertThat(repository.markPrinted(TENANT_ID, id, succeeded.version(), actor))
                .isTrue();
        assertThat(repository.find(TENANT_ID, id).printed()).isTrue();
    }

    private static void startPostgresql16() throws Exception {
        containerName = "erp-logistics-forecast-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker(
                "run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_logistics_forecast",
                "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        int separator = binding.lastIndexOf(':');
        if (separator < 0) throw new IllegalStateException("Docker did not publish PostgreSQL");
        jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(separator + 1) + "/erp_logistics_forecast";
        long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
        while (System.nanoTime() < deadline) {
            try (Connection connection = DriverManager.getConnection(
                    jdbcUrl, DB_USER, DB_PASSWORD)) {
                connection.isValid(1);
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
