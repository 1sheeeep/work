package cn.xzkj.erp.settings.message;

import static org.assertj.core.api.Assertions.assertThat;

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

class SettingsMessagePostgresql16GateTest {
    private static final UUID TENANT_A = UUID.fromString(
            "a7920000-0000-4000-8000-000000000001");
    private static final UUID USER_A = UUID.fromString(
            "a7920000-0000-4000-8000-000000000002");
    private static final UUID USER_B = UUID.fromString(
            "a7920000-0000-4000-8000-000000000003");
    private static final UUID TENANT_B = UUID.fromString(
            "a7920000-0000-4000-8000-000000000004");
    private static final UUID NOTICE_A = UUID.fromString(
            "a7920000-0000-4000-8000-000000000091");
    private static final UUID NOTICE_B = UUID.fromString(
            "a7920000-0000-4000-8000-000000000092");
    private static String containerName;
    private static SettingsMessageService service;

    @BeforeAll
    static void migrate() throws Exception {
        String jdbcUrl = startPostgresql16();
        Flyway migration = Flyway.configure()
                .dataSource(jdbcUrl, "erp", "erp")
                .locations("classpath:db/migration").load();
        assertThat(migration.migrate().success).isTrue();
        assertThat(migration.info().current().getVersion().getVersion())
                .isEqualTo("123");
        NamedParameterJdbcTemplate jdbc = new NamedParameterJdbcTemplate(
                new DriverManagerDataSource(jdbcUrl, "erp", "erp"));
        jdbc.getJdbcOperations().update("""
                insert into tenants (id, code, name) values
                    ('a7920000-0000-4000-8000-000000000001',
                     'message_a', 'Message A'),
                    ('a7920000-0000-4000-8000-000000000004',
                     'message_b', 'Message B');
                insert into users (id, tenant_id, username, display_name) values
                    ('a7920000-0000-4000-8000-000000000002',
                     'a7920000-0000-4000-8000-000000000001',
                     'message.a', 'Message A'),
                    ('a7920000-0000-4000-8000-000000000003',
                     'a7920000-0000-4000-8000-000000000001',
                     'message.b', 'Message B'),
                    ('a7920000-0000-4000-8000-000000000005',
                     'a7920000-0000-4000-8000-000000000004',
                     'message.other', 'Message Other');
                insert into tenant_internal_notices (
                    id, tenant_id, title, content, pinned, status,
                    published_at, archived_at, created_by_display_name,
                    created_by_user_id, updated_by_user_id, request_id,
                    created_at, updated_at
                ) values
                    ('a7920000-0000-4000-8000-000000000091',
                     'a7920000-0000-4000-8000-000000000001',
                     'Shift handover', 'Review outgoing orders.', true, 'ACTIVE',
                     '2026-08-10T01:00:00Z', null, 'Message A',
                     'a7920000-0000-4000-8000-000000000002',
                     'a7920000-0000-4000-8000-000000000002', 'message-a',
                     '2026-08-10T01:00:00Z', '2026-08-10T01:00:00Z'),
                    ('a7920000-0000-4000-8000-000000000092',
                     'a7920000-0000-4000-8000-000000000001',
                     'Inventory count', 'Count aisle A.', false, 'ACTIVE',
                     '2026-08-09T01:00:00Z', null, 'Message A',
                     'a7920000-0000-4000-8000-000000000002',
                     'a7920000-0000-4000-8000-000000000002', 'message-b',
                     '2026-08-09T01:00:00Z', '2026-08-09T01:00:00Z'),
                    ('a7920000-0000-4000-8000-000000000093',
                     'a7920000-0000-4000-8000-000000000004',
                     'Other tenant', 'Hidden message.', false, 'ACTIVE',
                     '2026-08-10T01:00:00Z', null, 'Other',
                     'a7920000-0000-4000-8000-000000000005',
                     'a7920000-0000-4000-8000-000000000005', 'message-c',
                     '2026-08-10T01:00:00Z', '2026-08-10T01:00:00Z');
                """);
        service = new SettingsMessageService(new SettingsMessageRepository(jdbc));
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void listsActiveTenantMessagesAndPersistsPerActorReadState() {
        SettingsMessageService.Actor actorA = actor(USER_A);
        assertThat(service.list(actorA, new SettingsMessageService.Filters(
                        null, null, "ALL", "UNREAD"), PageRequest.of(0, 25)))
                .extracting(SettingsMessageRecord::id)
                .containsExactly(NOTICE_A, NOTICE_B);

        assertThat(service.markRead(actorA, List.of(NOTICE_A))).isEqualTo(1);
        assertThat(service.markRead(actorA, List.of(NOTICE_A))).isZero();
        assertThat(service.list(actorA, new SettingsMessageService.Filters(
                        null, null, "INTERNAL_NOTICE", "READ"),
                        PageRequest.of(0, 25)))
                .singleElement().satisfies(message -> {
                    assertThat(message.id()).isEqualTo(NOTICE_A);
                    assertThat(message.read()).isTrue();
                    assertThat(message.readAt()).isNotNull();
                });
        assertThat(service.list(actor(USER_B),
                new SettingsMessageService.Filters(null, null, null, "UNREAD"),
                PageRequest.of(0, 25))).hasSize(2);
        assertThat(service.list(actorA, new SettingsMessageService.Filters(
                        LocalDate.parse("2026-08-10"),
                        LocalDate.parse("2026-08-10"), "ALL", "ALL"),
                        PageRequest.of(0, 25)))
                .extracting(SettingsMessageRecord::id).containsExactly(NOTICE_A);
    }

    private static SettingsMessageService.Actor actor(UUID userId) {
        return new SettingsMessageService.Actor(TENANT_A, userId, null);
    }

    private static String startPostgresql16() throws Exception {
        containerName = "erp-settings-message-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker("run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_settings_message",
                "-e", "POSTGRES_USER=erp", "-e", "POSTGRES_PASSWORD=erp",
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        int separator = binding.lastIndexOf(':');
        String jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(separator + 1) + "/erp_settings_message";
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
            throw new IllegalStateException("Docker command was interrupted",
                    exception);
        }
    }
}
