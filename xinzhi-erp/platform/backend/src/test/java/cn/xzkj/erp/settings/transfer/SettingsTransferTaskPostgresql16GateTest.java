package cn.xzkj.erp.settings.transfer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import cn.xzkj.erp.order.repository.OrderTransferRepository;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class SettingsTransferTaskPostgresql16GateTest {
    private static final UUID TENANT_A = UUID.fromString(
            "a7930000-0000-4000-8000-000000000001");
    private static final UUID USER_A = UUID.fromString(
            "a7930000-0000-4000-8000-000000000002");
    private static final UUID TENANT_B = UUID.fromString(
            "a7930000-0000-4000-8000-000000000003");
    private static final UUID USER_B = UUID.fromString(
            "a7930000-0000-4000-8000-000000000004");
    private static String containerName;
    private static SettingsTransferTaskService service;
    private static UUID exportTaskId;
    private static UUID importTaskId;

    @BeforeAll
    static void migrate() throws Exception {
        String jdbcUrl = startPostgresql16();
        Flyway migration = Flyway.configure()
                .dataSource(jdbcUrl, "erp", "erp")
                .locations("classpath:db/migration").load();
        assertThat(migration.migrate().success).isTrue();
        assertThat(migration.info().current().getVersion().getVersion())
                .isEqualTo("123");
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                jdbcUrl, "erp", "erp");
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("""
                insert into tenants (id, code, name) values
                    ('a7930000-0000-4000-8000-000000000001',
                     'transfer_a', 'Transfer A'),
                    ('a7930000-0000-4000-8000-000000000003',
                     'transfer_b', 'Transfer B');
                insert into users (id, tenant_id, username, display_name) values
                    ('a7930000-0000-4000-8000-000000000002',
                     'a7930000-0000-4000-8000-000000000001',
                     'transfer.a', 'Transfer Operator A'),
                    ('a7930000-0000-4000-8000-000000000004',
                     'a7930000-0000-4000-8000-000000000003',
                     'transfer.b', 'Transfer Operator B');
                """);
        OrderTransferRepository transfers = new OrderTransferRepository(jdbc);
        exportTaskId = transfers.recordCompleted(
                TENANT_A, USER_A, null, "EXPORT", 2, 2, 0,
                "inline:orders-uat.csv", "orders-uat.csv", "text/csv",
                "order-number\nUAT-1\n".getBytes(StandardCharsets.UTF_8));
        importTaskId = transfers.recordCompleted(
                TENANT_A, USER_A, null, "IMPORT", 1, 1, 0,
                "upload:orders-import.csv", null, null, null);
        transfers.recordCompleted(
                TENANT_B, USER_B, null, "EXPORT", 1, 1, 0,
                "inline:hidden.csv", "hidden.csv", "text/csv",
                "hidden".getBytes(StandardCharsets.UTF_8));
        service = new SettingsTransferTaskService(
                new SettingsTransferTaskRepository(
                        new NamedParameterJdbcTemplate(dataSource)));
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void listsTenantTransferTasksWithOperatorAndDownloadsPersistedExport() {
        var exports = service.list(TENANT_A,
                new SettingsTransferTaskService.Filters(
                        "EXPORT", "SUCCEEDED", "ORDERS-UAT", true,
                        LocalDate.now(ZoneOffset.UTC).minusDays(1),
                        LocalDate.now(ZoneOffset.UTC).plusDays(1)),
                PageRequest.of(0, 25));
        assertThat(exports).singleElement().satisfies(task -> {
            assertThat(task.id()).isEqualTo(exportTaskId);
            assertThat(task.filename()).isEqualTo("orders-uat.csv");
            assertThat(task.createdByDisplayName())
                    .isEqualTo("Transfer Operator A");
            assertThat(task.resultAvailable()).isTrue();
            assertThat(task.resultSizeBytes()).isPositive();
        });
        SettingsTransferTaskService.Artifact artifact = service.result(
                TENANT_A, exportTaskId);
        assertThat(artifact.filename()).isEqualTo("orders-uat.csv");
        assertThat(new String(artifact.content(), StandardCharsets.UTF_8))
                .contains("UAT-1");
    }

    @Test
    void separatesImportTasksAndFailsClosedForMissingOrCrossTenantResults() {
        assertThat(service.list(TENANT_A,
                new SettingsTransferTaskService.Filters(
                        "IMPORT", "ALL", "orders-import", false,
                        null, null), PageRequest.of(0, 25)))
                .singleElement().satisfies(task -> {
                    assertThat(task.id()).isEqualTo(importTaskId);
                    assertThat(task.resultAvailable()).isFalse();
                    assertThat(task.filename()).isEqualTo("orders-import.csv");
                });
        assertThatThrownBy(() -> service.result(TENANT_A, importTaskId))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.result(TENANT_B, exportTaskId))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    private static String startPostgresql16() throws Exception {
        containerName = "erp-settings-transfer-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker("run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_settings_transfer",
                "-e", "POSTGRES_USER=erp", "-e", "POSTGRES_PASSWORD=erp",
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        int separator = binding.lastIndexOf(':');
        String jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(separator + 1) + "/erp_settings_transfer";
        long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
        while (System.nanoTime() < deadline) {
            try (Connection ignored = DriverManager.getConnection(
                    jdbcUrl, "erp", "erp")) {
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
            command.add("docker"); command.addAll(List.of(arguments));
            Process process = new ProcessBuilder(command)
                    .redirectErrorStream(true).start();
            String output = new String(process.getInputStream().readAllBytes(),
                    StandardCharsets.UTF_8);
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
