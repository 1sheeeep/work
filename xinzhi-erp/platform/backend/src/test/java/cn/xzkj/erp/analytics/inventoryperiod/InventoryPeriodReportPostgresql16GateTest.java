package cn.xzkj.erp.analytics.inventoryperiod;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Duration;
import java.time.Instant;
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

class InventoryPeriodReportPostgresql16GateTest {
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
    private static InventoryPeriodReportRepository repository;

    @BeforeAll
    static void migrate() throws Exception {
        startPostgresql16();
        Flyway migration = Flyway.configure()
                .dataSource(jdbcUrl, DB_USER, DB_PASSWORD)
                .locations("classpath:db/migration")
                .load();
        assertThat(migration.migrate().success).isTrue();
        repository = new InventoryPeriodReportRepository(
                new NamedParameterJdbcTemplate(new DriverManagerDataSource(
                        jdbcUrl, DB_USER, DB_PASSWORD)));
        seedReportFacts();
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void aggregatesBoundariesAndEnforcesTenantWarehouseAndLiteralSearch() {
        Instant from = Instant.parse("2026-06-30T16:00:00Z");
        Instant to = Instant.parse("2026-07-31T16:00:00Z");
        var all = repository.summarize(
                TENANT_A, Set.of(), true, null, null, from, to,
                PageRequest.of(0, 50));
        var scoped = repository.summarize(
                TENANT_A, Set.of(WAREHOUSE_A), false, null, "sku-one",
                from, to, PageRequest.of(0, 50));
        var otherTenant = repository.summarize(
                TENANT_B, Set.of(), true, null, null, from, to,
                PageRequest.of(0, 50));
        var escapedLiteral = repository.summarize(
                TENANT_A, Set.of(), true, null, "%_\\", from, to,
                PageRequest.of(0, 50));

        assertThat(all.totalElements()).isEqualTo(2);
        assertThat(all.totalOpeningQuantity()).isEqualTo(14);
        assertThat(all.totalIncreasedQuantity()).isEqualTo(5);
        assertThat(all.totalDecreasedQuantity()).isEqualTo(7);
        assertThat(all.totalClosingQuantity()).isEqualTo(12);
        assertThat(scoped.items()).containsExactly(
                new InventoryPeriodReportItem(
                        UUID.fromString(
                                "a1000000-0000-0000-0000-000000000201"),
                        "SKU-ONE", "SKU one",
                        WAREHOUSE_A, "WH-A", "Warehouse A",
                        10, 5, 3, 12));
        assertThat(otherTenant.totalClosingQuantity()).isEqualTo(100);
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
                       'inventory-report-a', 'Inventory report A'),
                      ('b1000000-0000-0000-0000-000000000001',
                       'inventory-report-b', 'Inventory report B')
                    """);
            statement.executeUpdate("""
                    INSERT INTO users (
                        id, tenant_id, username, display_name, status)
                    VALUES
                      ('a1000000-0000-0000-0000-000000000011',
                       'a1000000-0000-0000-0000-000000000001',
                       'report-a', 'Report A', 'ACTIVE'),
                      ('b1000000-0000-0000-0000-000000000011',
                       'b1000000-0000-0000-0000-000000000001',
                       'report-b', 'Report B', 'ACTIVE')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_spus (
                        id, tenant_id, business_code, name)
                    VALUES
                      ('a1000000-0000-0000-0000-000000000111',
                       'a1000000-0000-0000-0000-000000000001',
                       'SPU-ONE', 'SPU one'),
                      ('a1000000-0000-0000-0000-000000000112',
                       'a1000000-0000-0000-0000-000000000001',
                       'SPU-TWO', 'SPU two'),
                      ('b1000000-0000-0000-0000-000000000111',
                       'b1000000-0000-0000-0000-000000000001',
                       'SPU-OTHER', 'SPU other')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_skus (
                        id, tenant_id, spu_id, business_code, name)
                    VALUES
                      ('a1000000-0000-0000-0000-000000000201',
                       'a1000000-0000-0000-0000-000000000001',
                       'a1000000-0000-0000-0000-000000000111',
                       'SKU-ONE', 'SKU one'),
                      ('a1000000-0000-0000-0000-000000000202',
                       'a1000000-0000-0000-0000-000000000001',
                       'a1000000-0000-0000-0000-000000000112',
                       'SKU-TWO', 'SKU two'),
                      ('b1000000-0000-0000-0000-000000000201',
                       'b1000000-0000-0000-0000-000000000001',
                       'b1000000-0000-0000-0000-000000000111',
                       'SKU-OTHER', 'SKU other')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_warehouses (
                        id, tenant_id, business_code, name)
                    VALUES
                      ('a1000000-0000-0000-0000-000000000101',
                       'a1000000-0000-0000-0000-000000000001',
                       'WH-A', 'Warehouse A'),
                      ('a1000000-0000-0000-0000-000000000102',
                       'a1000000-0000-0000-0000-000000000001',
                       'WH-B', 'Warehouse B'),
                      ('b1000000-0000-0000-0000-000000000101',
                       'b1000000-0000-0000-0000-000000000001',
                       'WH-OTHER', 'Warehouse other')
                    """);
            statement.executeUpdate("""
                    INSERT INTO inventory_ledger_events (
                        tenant_id, event_type, sku_id, warehouse_id,
                        signed_delta, balance_after, balance_version_after,
                        reason, actor_user_id, request_id, recorded_at)
                    VALUES
                      ('a1000000-0000-0000-0000-000000000001',
                       'OPENING_BALANCE',
                       'a1000000-0000-0000-0000-000000000201',
                       'a1000000-0000-0000-0000-000000000101',
                       10, 10, 1, 'REPORT_OPENING',
                       'a1000000-0000-0000-0000-000000000011',
                       'report-a-1', '2026-06-30T15:59:59Z'),
                      ('a1000000-0000-0000-0000-000000000001',
                       'CORRECTION',
                       'a1000000-0000-0000-0000-000000000201',
                       'a1000000-0000-0000-0000-000000000101',
                       5, 15, 2, 'REPORT_INCREASE',
                       'a1000000-0000-0000-0000-000000000011',
                       'report-a-2', '2026-06-30T16:00:00Z'),
                      ('a1000000-0000-0000-0000-000000000001',
                       'CORRECTION',
                       'a1000000-0000-0000-0000-000000000201',
                       'a1000000-0000-0000-0000-000000000101',
                       -3, 12, 3, 'REPORT_DECREASE',
                       'a1000000-0000-0000-0000-000000000011',
                       'report-a-3', '2026-07-31T15:59:59Z'),
                      ('a1000000-0000-0000-0000-000000000001',
                       'CORRECTION',
                       'a1000000-0000-0000-0000-000000000201',
                       'a1000000-0000-0000-0000-000000000101',
                       99, 111, 4, 'REPORT_AFTER_PERIOD',
                       'a1000000-0000-0000-0000-000000000011',
                       'report-a-4', '2026-07-31T16:00:00Z'),
                      ('a1000000-0000-0000-0000-000000000001',
                       'OPENING_BALANCE',
                       'a1000000-0000-0000-0000-000000000202',
                       'a1000000-0000-0000-0000-000000000102',
                       4, 4, 1, 'REPORT_OPENING',
                       'a1000000-0000-0000-0000-000000000011',
                       'report-a-5', '2026-06-01T00:00:00Z'),
                      ('a1000000-0000-0000-0000-000000000001',
                       'CORRECTION',
                       'a1000000-0000-0000-0000-000000000202',
                       'a1000000-0000-0000-0000-000000000102',
                       -4, 0, 2, 'REPORT_DECREASE',
                       'a1000000-0000-0000-0000-000000000011',
                       'report-a-6', '2026-07-15T00:00:00Z'),
                      ('b1000000-0000-0000-0000-000000000001',
                       'OPENING_BALANCE',
                       'b1000000-0000-0000-0000-000000000201',
                       'b1000000-0000-0000-0000-000000000101',
                       100, 100, 1, 'REPORT_OPENING',
                       'b1000000-0000-0000-0000-000000000011',
                       'report-b-1', '2026-06-01T00:00:00Z')
                    """);
        }
    }

    private static void startPostgresql16() throws Exception {
        containerName = "erp-inventory-period-report-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker(
                "run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_inventory_period_report",
                "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        int separator = binding.lastIndexOf(':');
        if (separator < 0) {
            throw new IllegalStateException(
                    "Docker did not publish PostgreSQL");
        }
        jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(separator + 1)
                + "/erp_inventory_period_report";
        long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
        while (System.nanoTime() < deadline) {
            try (Connection ignored = DriverManager.getConnection(
                    jdbcUrl, DB_USER, DB_PASSWORD)) {
                return;
            } catch (java.sql.SQLException exception) {
                Thread.sleep(200);
            }
        }
        throw new IllegalStateException(
                "PostgreSQL 16 did not become ready");
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
            throw new IllegalStateException(
                    "Docker CLI is required", exception);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(
                    "Docker command was interrupted", exception);
        }
    }
}
