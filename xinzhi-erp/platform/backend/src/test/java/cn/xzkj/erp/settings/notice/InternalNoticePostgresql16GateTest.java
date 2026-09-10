package cn.xzkj.erp.settings.notice;

import static org.assertj.core.api.Assertions.assertThat;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
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
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class InternalNoticePostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_ID = UUID.fromString(
            "a7910000-0000-4000-8000-000000000001");
    private static final UUID USER_ID = UUID.fromString(
            "a7910000-0000-4000-8000-000000000002");
    private static final UUID OTHER_TENANT_ID = UUID.fromString(
            "a7910000-0000-4000-8000-000000000003");
    private static String containerName;
    private static InternalNoticeService service;
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
                    ('a7910000-0000-4000-8000-000000000001',
                     'notice_uat', 'Notice UAT'),
                    ('a7910000-0000-4000-8000-000000000003',
                     'notice_other', 'Notice Other');
                insert into users (id, tenant_id, username, display_name)
                values ('a7910000-0000-4000-8000-000000000002',
                        'a7910000-0000-4000-8000-000000000001',
                        'notice.operator', 'Notice Operator');
                """);
        audits = new ArrayList<>();
        service = new InternalNoticeService(
                new InternalNoticeRepository(jdbc), audits::add);
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void publishesPinsArchivesRestoresAndIsolatesTenantData() {
        InternalNoticeService.Actor actor = actor(TENANT_ID, USER_ID);
        InternalNoticeRecord pinned = service.create(actor,
                new InternalNoticeService.NoticeInput(
                        "Warehouse shift notice",
                        "Finish the outgoing-order review before handover.", true));
        InternalNoticeRecord normal = service.create(actor,
                new InternalNoticeService.NoticeInput(
                        "Inventory count notice", "Count aisle A before noon.",
                        false));
        assertThat(service.list(actor, new InternalNoticeService.Filters(
                        "shift", "ACTIVE", true), PageRequest.of(0, 25))
                .getContent()).extracting(InternalNoticeRecord::id)
                .containsExactly(pinned.id());

        InternalNoticeRecord unpinned = service.setPinned(actor, pinned.id(),
                pinned.version(), false);
        InternalNoticeRecord repinned = service.setPinned(actor, pinned.id(),
                unpinned.version(), true);
        assertThat(repinned.pinned()).isTrue();

        List<InternalNoticeRecord> archived = service.archiveBatch(actor,
                List.of(new InternalNoticeService.VersionedNotice(
                        normal.id(), normal.version())));
        assertThat(archived.getFirst().status()).isEqualTo("ARCHIVED");
        assertThat(archived.getFirst().archivedAt()).isNotNull();
        assertThat(service.list(actor, new InternalNoticeService.Filters(
                        null, "ACTIVE", null), PageRequest.of(0, 25)))
                .extracting(InternalNoticeRecord::id).doesNotContain(normal.id());
        InternalNoticeRecord restored = service.transition(actor, normal.id(),
                archived.getFirst().version(), "ACTIVE");
        assertThat(restored.archivedAt()).isNull();

        assertThat(service.list(actor(OTHER_TENANT_ID, null),
                new InternalNoticeService.Filters(null, "ACTIVE", null),
                PageRequest.of(0, 25))).isEmpty();
        assertThat(audits).extracting(SecurityAuditEvent::action).contains(
                "settings.notice.created", "settings.notice.pin_changed",
                "settings.notice.status_changed");
        assertThat(audits).allSatisfy(event -> assertThat(event.details())
                .doesNotContainKeys("title", "content"));
    }

    private static InternalNoticeService.Actor actor(UUID tenantId,
            UUID userId) {
        return new InternalNoticeService.Actor(tenantId, userId,
                userId == null ? UUID.randomUUID() : null, "Notice Operator",
                "notice-pg16-uat", "127.0.0.1");
    }

    private static String startPostgresql16() throws Exception {
        containerName = "erp-internal-notice-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker("run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_internal_notice",
                "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        int separator = binding.lastIndexOf(':');
        if (separator < 0) throw new IllegalStateException(
                "Docker did not publish PostgreSQL");
        String jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(separator + 1) + "/erp_internal_notice";
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
            throw new IllegalStateException("Docker command was interrupted",
                    exception);
        }
    }
}
