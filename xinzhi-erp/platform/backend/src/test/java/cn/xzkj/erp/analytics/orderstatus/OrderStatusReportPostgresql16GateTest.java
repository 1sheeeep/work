package cn.xzkj.erp.analytics.orderstatus;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class OrderStatusReportPostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_A = UUID.fromString(
            "a1000000-0000-0000-0000-000000000001");
    private static final UUID TENANT_B = UUID.fromString(
            "b1000000-0000-0000-0000-000000000001");
    private static final UUID WAREHOUSE_A = UUID.fromString(
            "a1000000-0000-0000-0000-000000000101");
    private static final UUID WAREHOUSE_B = UUID.fromString(
            "a1000000-0000-0000-0000-000000000102");
    private static String containerName;
    private static String jdbcUrl;
    private static OrderStatusReportRepository repository;

    @BeforeAll
    static void migrate() throws Exception {
        startPostgresql16();
        Flyway migration = Flyway.configure()
                .dataSource(jdbcUrl, DB_USER, DB_PASSWORD)
                .locations("classpath:db/migration")
                .load();
        assertThat(migration.migrate().success).isTrue();
        repository = new OrderStatusReportRepository(
                new NamedParameterJdbcTemplate(new DriverManagerDataSource(
                        jdbcUrl, DB_USER, DB_PASSWORD)));
        seedReportFacts();
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void aggregatesExactStatusesAndEnforcesTenantAndWarehouseScope() {
        var all = repository.summarize(
                TENANT_A, Set.of(), true, "demo",
                java.time.Instant.parse("2026-08-01T00:00:00Z"),
                java.time.Instant.parse("2026-08-03T00:00:00Z"),
                PageRequest.of(0, 25));
        var scoped = repository.summarize(
                TENANT_A, Set.of(WAREHOUSE_A), false, null,
                null, null, PageRequest.of(0, 25));
        var otherTenant = repository.summarize(
                TENANT_B, Set.of(), true, "demo", null, null,
                PageRequest.of(0, 25));
        var escapedLiteral = repository.summarize(
                TENANT_A, Set.of(), true, "shop%_\\a", null, null,
                PageRequest.of(0, 25));

        assertThat(all.totalOrders()).isEqualTo(3);
        assertThat(all.totalDays()).isEqualTo(2);
        assertThat(all.items()).extracting(OrderStatusReportView::reportDate)
                .containsExactly(
                        java.time.LocalDate.parse("2026-08-02"),
                        java.time.LocalDate.parse("2026-08-01"));
        assertThat(all.items().get(1).statuses())
                .containsExactlyInAnyOrder(
                        new OrderStatusReportView.StatusCount(
                                cn.xzkj.erp.order.domain.OrderStatus
                                        .READY_TO_FULFILL, 1),
                        new OrderStatusReportView.StatusCount(
                                cn.xzkj.erp.order.domain.OrderStatus.SHIPPED,
                                1));
        assertThat(scoped.totalOrders()).isEqualTo(2);
        assertThat(scoped.totalDays()).isEqualTo(2);
        assertThat(otherTenant.totalOrders()).isEqualTo(1);
        assertThat(escapedLiteral.items()).isEmpty();
    }

    private static void seedReportFacts() throws Exception {
        try (Connection connection = DriverManager.getConnection(
                jdbcUrl, DB_USER, DB_PASSWORD);
                var statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (id, code, name)
                    VALUES
                      ('a1000000-0000-0000-0000-000000000001',
                       'report-a', 'Report tenant A'),
                      ('b1000000-0000-0000-0000-000000000001',
                       'report-b', 'Report tenant B')
                    """);
            statement.executeUpdate("""
                    INSERT INTO platform_catalog (id, code, display_name)
                    VALUES ('c1000000-0000-0000-0000-000000000001',
                            'REPORT_DEMO', 'Demo Platform')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_shops (
                        id, tenant_id, platform_id, external_shop_ref,
                        display_name)
                    VALUES
                      ('a1000000-0000-0000-0000-000000000010',
                       'a1000000-0000-0000-0000-000000000001',
                       'c1000000-0000-0000-0000-000000000001',
                       'shop-a', 'North Shop'),
                      ('b1000000-0000-0000-0000-000000000010',
                       'b1000000-0000-0000-0000-000000000001',
                       'c1000000-0000-0000-0000-000000000001',
                       'shop-b', 'South Shop')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_warehouses (
                        id, tenant_id, business_code, name)
                    VALUES
                      ('a1000000-0000-0000-0000-000000000101',
                       'a1000000-0000-0000-0000-000000000001',
                       'REPORT_A', 'Report warehouse A'),
                      ('a1000000-0000-0000-0000-000000000102',
                       'a1000000-0000-0000-0000-000000000001',
                       'REPORT_B', 'Report warehouse B')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_orders (
                        id, tenant_id, shop_id, external_order_ref,
                        idempotency_key, request_fingerprint, currency,
                        status, line_count, placed_at, warehouse_id)
                    VALUES
                      ('a2000000-0000-0000-0000-000000000001',
                       'a1000000-0000-0000-0000-000000000001',
                       'a1000000-0000-0000-0000-000000000010',
                       'ORDER-A-1', 'report-a-1', repeat('a', 64), 'CNY',
                       'READY_TO_FULFILL', 1,
                       '2026-08-01T08:00:00Z',
                       'a1000000-0000-0000-0000-000000000101'),
                      ('a2000000-0000-0000-0000-000000000002',
                       'a1000000-0000-0000-0000-000000000001',
                       'a1000000-0000-0000-0000-000000000010',
                       'ORDER-A-2', 'report-a-2', repeat('b', 64), 'CNY',
                       'SHIPPED', 1, '2026-08-01T23:30:00Z',
                       'a1000000-0000-0000-0000-000000000102'),
                      ('a2000000-0000-0000-0000-000000000003',
                       'a1000000-0000-0000-0000-000000000001',
                       'a1000000-0000-0000-0000-000000000010',
                       'ORDER-A-3', 'report-a-3', repeat('c', 64), 'CNY',
                       'READY_TO_FULFILL', 1,
                       '2026-08-02T00:30:00Z',
                       'a1000000-0000-0000-0000-000000000101'),
                      ('b2000000-0000-0000-0000-000000000001',
                       'b1000000-0000-0000-0000-000000000001',
                       'b1000000-0000-0000-0000-000000000010',
                       'ORDER-B-1', 'report-b-1', repeat('d', 64), 'CNY',
                       'CANCELLED', 1, '2026-08-01T09:00:00Z', NULL)
                    """);
        }
    }

    private static void startPostgresql16() throws Exception {
        containerName = "erp-order-status-report-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker(
                "run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_order_status_report",
                "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        int separator = binding.lastIndexOf(':');
        if (separator < 0) {
            throw new IllegalStateException("Docker did not publish PostgreSQL");
        }
        jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(separator + 1)
                + "/erp_order_status_report";
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
                    .redirectErrorStream(true)
                    .start();
            String output = new String(
                    process.getInputStream().readAllBytes(),
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
