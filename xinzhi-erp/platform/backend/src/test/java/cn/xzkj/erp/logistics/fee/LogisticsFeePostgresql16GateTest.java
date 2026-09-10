package cn.xzkj.erp.logistics.fee;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Duration;
import java.time.LocalDate;
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

class LogisticsFeePostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_ID = UUID.fromString(
            "a7880000-0000-4000-8000-000000000001");
    private static final UUID USER_ID = UUID.fromString(
            "a7880000-0000-4000-8000-000000000002");
    private static String containerName;
    private static String jdbcUrl;
    private static LogisticsFeeRepository repository;
    private static LogisticsFeeService.Actor actor;

    @BeforeAll
    static void migrate() throws Exception {
        startPostgresql16();
        Flyway migration = Flyway.configure()
                .dataSource(jdbcUrl, DB_USER, DB_PASSWORD)
                .locations("classpath:db/migration").load();
        assertThat(migration.migrate().success).isTrue();
        assertThat(migration.info().current().getVersion().getVersion())
                .isEqualTo("123");
        NamedParameterJdbcTemplate jdbc = new NamedParameterJdbcTemplate(
                new DriverManagerDataSource(jdbcUrl, DB_USER, DB_PASSWORD));
        jdbc.getJdbcOperations().update("""
                insert into tenants (id, code, name)
                values ('a7880000-0000-4000-8000-000000000001',
                        'fee_uat', 'Fee UAT');
                insert into users (id, tenant_id, username, display_name)
                values ('a7880000-0000-4000-8000-000000000002',
                        'a7880000-0000-4000-8000-000000000001',
                        'fee.operator', 'Fee Operator');
                """);
        repository = new LogisticsFeeRepository(jdbc);
        actor = new LogisticsFeeService.Actor(TENANT_ID, USER_ID, null,
                "Fee Operator", "fee-pg16-uat", "127.0.0.1");
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void boundedFeeListQueryIsValidAgainstPostgresql16() {
        var page = repository.list(UUID.randomUUID(),
                new LogisticsFeeService.Filters("UNCONFIRMED", "TRACKING_NO",
                        "100%_platform\\", "shop", "channel", "tracking",
                        true, LocalDate.of(2026, 8, 1), LocalDate.of(2026, 8, 31)),
                PageRequest.of(0, 25));
        assertThat(page).isEmpty();
    }

    @Test
    void createsEditsConfirmsAndArchivesFeeRecordsAgainstPostgresql16() {
        UUID confirmedId = UUID.randomUUID();
        repository.insert(confirmedId, TENANT_ID, input(
                "UAT-TRACK-CONFIRM", new BigDecimal("24.0000"),
                new BigDecimal("25.4000")), actor);
        LogisticsFeeRecord created = repository.find(TENANT_ID, confirmedId);
        assertThat(created.feeVariance()).isEqualByComparingTo("1.4000");
        assertThat(repository.update(TENANT_ID, confirmedId, created.version(),
                input("UAT-TRACK-CONFIRM", new BigDecimal("24.5000"),
                        new BigDecimal("25.8000")), actor)).isTrue();
        LogisticsFeeRecord edited = repository.find(TENANT_ID, confirmedId);
        assertThat(repository.confirm(TENANT_ID, confirmedId, edited.version(), actor))
                .isTrue();
        assertThat(repository.find(TENANT_ID, confirmedId).confirmationStatus())
                .isEqualTo("CONFIRMED");

        UUID archivedId = UUID.randomUUID();
        repository.insert(archivedId, TENANT_ID,
                input("UAT-TRACK-ARCHIVE", new BigDecimal("10.0000"), null), actor);
        assertThat(repository.archive(TENANT_ID, archivedId, 0, actor)).isTrue();
        assertThat(repository.find(TENANT_ID, archivedId).lifecycleStatus())
                .isEqualTo("ARCHIVED");
    }

    private static LogisticsFeeService.FeeInput input(String tracking,
            BigDecimal estimated, BigDecimal actual) {
        return new LogisticsFeeService.FeeInput(
                "Shopify", "UAT Shop", "UAT Standard", "UAT-ORDER-001",
                tracking, "UAT-TX-001", estimated, actual, "USD",
                new BigDecimal("2.600"), new BigDecimal("2.500"),
                LocalDate.of(2026, 8, 10), "UAT");
    }

    private static void startPostgresql16() throws Exception {
        containerName = "erp-logistics-fee-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker("run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_logistics_fee",
                "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        int separator = binding.lastIndexOf(':');
        if (separator < 0) throw new IllegalStateException("Docker did not publish PostgreSQL");
        jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(separator + 1) + "/erp_logistics_fee";
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
