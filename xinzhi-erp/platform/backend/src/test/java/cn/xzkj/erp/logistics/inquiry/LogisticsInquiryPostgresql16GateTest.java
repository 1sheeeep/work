package cn.xzkj.erp.logistics.inquiry;

import static org.assertj.core.api.Assertions.assertThat;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import java.math.BigDecimal;
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

class LogisticsInquiryPostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_ID = UUID.fromString(
            "a7890000-0000-4000-8000-000000000001");
    private static final UUID USER_ID = UUID.fromString(
            "a7890000-0000-4000-8000-000000000002");
    private static final UUID OTHER_TENANT_ID = UUID.fromString(
            "a7890000-0000-4000-8000-000000000003");
    private static String containerName;
    private static LogisticsInquiryService service;
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
                    ('a7890000-0000-4000-8000-000000000001',
                     'inquiry_uat', 'Inquiry UAT'),
                    ('a7890000-0000-4000-8000-000000000003',
                     'inquiry_other', 'Inquiry Other');
                insert into users (id, tenant_id, username, display_name)
                values ('a7890000-0000-4000-8000-000000000002',
                        'a7890000-0000-4000-8000-000000000001',
                        'inquiry.operator', 'Inquiry Operator');
                """);
        audits = new ArrayList<>();
        service = new LogisticsInquiryService(
                new LogisticsInquiryRepository(jdbc), audits::add);
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void completesContactInquiryQuoteAndLifecycleAgainstPostgresql16() {
        LogisticsInquiryService.Actor actor = new LogisticsInquiryService.Actor(
                TENANT_ID, USER_ID, null, "Inquiry Operator",
                "inquiry-pg16-uat", "127.0.0.1");

        LogisticsInquiryContactRecord contact = service.saveContact(actor,
                new LogisticsInquiryService.ContactInput(
                        "UAT Contact", "+86 138 0000 0000"), null);
        assertThat(contact.contactName()).isEqualTo("UAT Contact");
        assertThat(contact.version()).isZero();
        assertThat(service.saveContact(actor,
                new LogisticsInquiryService.ContactInput(
                        "UAT Contact 2", "+86 138 0000 0001"),
                contact.version()).version()).isEqualTo(1);

        LogisticsInquiryRecord created = service.create(actor,
                new LogisticsInquiryService.InquiryInput(
                        "China Shenzhen", "United States", 120,
                        new BigDecimal("360.500"), "Apparel",
                        "UAT Contact 2", "+86 138 0000 0001",
                        "UAT inquiry workflow"));
        assertThat(created.status()).isEqualTo("BIDDING");
        assertThat(service.list(actor,
                new LogisticsInquiryService.Filters(
                        false, "BIDDING", "states", null, null),
                PageRequest.of(0, 25)).getContent())
                .extracting(LogisticsInquiryRecord::id)
                .containsExactly(created.id());

        LogisticsInquiryRecord updated = service.update(actor, created.id(),
                created.version(), new LogisticsInquiryService.InquiryInput(
                        created.origin(), created.destination(), 120,
                        new BigDecimal("365.500"), created.category(),
                        created.contactName(), created.contactPhone(), created.note()));
        LogisticsInquiryDetail quoted = service.addQuote(actor, updated.id(),
                new LogisticsInquiryService.QuoteInput(
                        "UAT Carrier", "UAT Standard", new BigDecimal("4.8000"),
                        "USD", 8, "UAT quote"));
        assertThat(quoted.quotes()).hasSize(1);

        LogisticsInquiryRecord paused = service.transition(actor, updated.id(),
                quoted.inquiry().version(), "PAUSED");
        LogisticsInquiryQuoteRecord quote = service.detail(actor, updated.id())
                .quotes().getFirst();
        LogisticsInquiryDetail withdrawn = service.withdrawQuote(actor,
                updated.id(), quote.id(), quote.version());
        assertThat(withdrawn.quotes().getFirst().status()).isEqualTo("WITHDRAWN");

        LogisticsInquiryRecord resumed = service.transition(actor, updated.id(),
                paused.version(), "BIDDING");
        assertThat(resumed.status()).isEqualTo("BIDDING");
        LogisticsInquiryDetail replacement = service.addQuote(actor, updated.id(),
                new LogisticsInquiryService.QuoteInput(
                        "UAT Carrier B", "UAT Air", new BigDecimal("5.2000"),
                        "USD", 6, null));
        LogisticsInquiryRecord completed = service.transition(actor, updated.id(),
                replacement.inquiry().version(), "COMPLETED");
        assertThat(completed.status()).isEqualTo("COMPLETED");
        assertThat(service.list(new LogisticsInquiryService.Actor(
                        OTHER_TENANT_ID, null, UUID.randomUUID(), "Other Admin",
                        "inquiry-pg16-other", "127.0.0.1"),
                new LogisticsInquiryService.Filters(false, null, null, null, null),
                PageRequest.of(0, 25))).isEmpty();
        assertThat(audits).extracting(SecurityAuditEvent::action)
                .contains("logistics.inquiry_contact.saved",
                        "logistics.inquiry.created",
                        "logistics.inquiry.updated",
                        "logistics.inquiry_quote.created",
                        "logistics.inquiry.status_changed",
                        "logistics.inquiry_quote.withdrawn");
    }

    private static String startPostgresql16() throws Exception {
        containerName = "erp-logistics-inquiry-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker("run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_logistics_inquiry",
                "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        int separator = binding.lastIndexOf(':');
        if (separator < 0) {
            throw new IllegalStateException("Docker did not publish PostgreSQL");
        }
        String jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(separator + 1) + "/erp_logistics_inquiry";
        long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
        while (System.nanoTime() < deadline) {
            try (Connection connection = DriverManager.getConnection(
                    jdbcUrl, DB_USER, DB_PASSWORD)) {
                connection.isValid(1);
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
