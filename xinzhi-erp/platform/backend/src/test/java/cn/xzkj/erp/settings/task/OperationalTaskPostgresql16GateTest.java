package cn.xzkj.erp.settings.task;

import static org.assertj.core.api.Assertions.assertThat;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
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

class OperationalTaskPostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_ID = UUID.fromString(
            "a7900000-0000-4000-8000-000000000001");
    private static final UUID USER_ID = UUID.fromString(
            "a7900000-0000-4000-8000-000000000002");
    private static final UUID OTHER_TENANT_ID = UUID.fromString(
            "a7900000-0000-4000-8000-000000000003");
    private static String containerName;
    private static OperationalTaskService service;
    private static List<SecurityAuditEvent> audits;

    @BeforeAll
    static void migrate() throws Exception {
        String jdbcUrl = startPostgresql16();
        Flyway migration = Flyway.configure()
                .dataSource(jdbcUrl, DB_USER, DB_PASSWORD)
                .locations("classpath:db/migration").load();
        assertThat(migration.migrate().success).isTrue();
        assertThat(migration.info().current().getVersion().getVersion())
                .isEqualTo("123");
        NamedParameterJdbcTemplate jdbc = new NamedParameterJdbcTemplate(
                new DriverManagerDataSource(jdbcUrl, DB_USER, DB_PASSWORD));
        jdbc.getJdbcOperations().update("""
                insert into tenants (id, code, name) values
                    ('a7900000-0000-4000-8000-000000000001',
                     'task_uat', 'Task UAT'),
                    ('a7900000-0000-4000-8000-000000000003',
                     'task_other', 'Task Other');
                insert into users (id, tenant_id, username, display_name)
                values ('a7900000-0000-4000-8000-000000000002',
                        'a7900000-0000-4000-8000-000000000001',
                        'task.operator', 'Task Operator');
                """);
        audits = new ArrayList<>();
        service = new OperationalTaskService(
                new OperationalTaskRepository(jdbc), audits::add);
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void completesTaskLifecycleFilteringExportAndTenantIsolation() {
        OperationalTaskService.Actor actor = actor(TENANT_ID, USER_ID);
        OperationalTaskRecord urgent = service.create(actor,
                new OperationalTaskService.TaskInput(
                        "Verify UAT order", "Operations", "ORDER-100",
                        "URGENT", "Warehouse Team", "Browser acceptance"));
        OperationalTaskRecord normal = service.create(actor,
                new OperationalTaskService.TaskInput(
                        "Check inventory", "Inventory", "SKU-100",
                        "NORMAL", "Inventory Team", null));
        assertThat(urgent.taskNo()).matches("TASK-[0-9]{8}-[A-Z0-9]{6}");
        assertThat(service.list(actor, new OperationalTaskService.Filters(
                        "TASK_NO", urgent.taskNo().substring(5, 13),
                        LocalDate.now(), LocalDate.now(), null, "URGENT"),
                PageRequest.of(0, 25)).getContent())
                .extracting(OperationalTaskRecord::id).containsExactly(urgent.id());

        OperationalTaskRecord started = service.transition(actor, urgent.id(),
                urgent.version(), "IN_PROGRESS");
        OperationalTaskRecord failed = service.transition(actor, urgent.id(),
                started.version(), "FAILED");
        OperationalTaskRecord restarted = service.transition(actor, urgent.id(),
                failed.version(), "IN_PROGRESS");
        OperationalTaskRecord completed = service.transition(actor, urgent.id(),
                restarted.version(), "COMPLETED");
        assertThat(completed.completedAt()).isNotNull();

        List<OperationalTaskRecord> batch = service.completeBatch(actor,
                List.of(new OperationalTaskService.VersionedTask(
                        normal.id(), normal.version())));
        assertThat(batch).extracting(OperationalTaskRecord::status)
                .containsExactly("COMPLETED");
        OperationalTaskRecord deleted = service.transition(actor, normal.id(),
                batch.getFirst().version(), "DELETED");
        assertThat(service.list(actor, new OperationalTaskService.Filters(
                        "TITLE", null, null, null, null, null),
                PageRequest.of(0, 25)).getContent())
                .extracting(OperationalTaskRecord::id).doesNotContain(deleted.id());
        OperationalTaskRecord restored = service.transition(actor, normal.id(),
                deleted.version(), "PENDING");
        assertThat(restored.completedAt()).isNull();

        OperationalTaskService.TaskExport exported = service.exportCsv(actor,
                new OperationalTaskService.Filters(
                        "ASSIGNEE", "team", null, null, null, null));
        assertThat(exported.rowCount()).isEqualTo(2);
        assertThat(exported.content()).startsWith("\uFEFF\"任务编号\"");
        assertThat(service.list(actor(OTHER_TENANT_ID, null),
                new OperationalTaskService.Filters(
                        "TITLE", null, null, null, null, null),
                PageRequest.of(0, 25))).isEmpty();
        assertThat(audits).extracting(SecurityAuditEvent::action)
                .contains("settings.task.created", "settings.task.status_changed");
        assertThat(audits).allSatisfy(event -> assertThat(event.details())
                .doesNotContainKeys("title", "taskObject", "assigneeName"));
    }

    private static OperationalTaskService.Actor actor(UUID tenantId, UUID userId) {
        return new OperationalTaskService.Actor(tenantId, userId,
                userId == null ? UUID.randomUUID() : null, "Task Operator",
                "task-pg16-uat", "127.0.0.1");
    }

    private static String startPostgresql16() throws Exception {
        containerName = "erp-operational-task-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker("run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_operational_task",
                "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        int separator = binding.lastIndexOf(':');
        if (separator < 0) throw new IllegalStateException(
                "Docker did not publish PostgreSQL");
        String jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(separator + 1) + "/erp_operational_task";
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
            command.add("docker"); command.addAll(List.of(arguments));
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
            throw new IllegalStateException("Docker command was interrupted", exception);
        }
    }
}
