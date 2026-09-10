package cn.xzkj.erp.analytics.inventoryaging;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
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

class InventoryAgingReportPostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_A = UUID.fromString(
            "a2000000-0000-0000-0000-000000000001");
    private static final UUID TENANT_B = UUID.fromString(
            "b2000000-0000-0000-0000-000000000001");
    private static final UUID WAREHOUSE_A = UUID.fromString(
            "a2000000-0000-0000-0000-000000000101");
    private static final UUID WAREHOUSE_B = UUID.fromString(
            "a2000000-0000-0000-0000-000000000102");
    private static String containerName;
    private static String jdbcUrl;
    private static InventoryAgingReportRepository repository;

    @BeforeAll
    static void migrate() throws Exception {
        startPostgresql16();
        Flyway migration = Flyway.configure()
                .dataSource(jdbcUrl, DB_USER, DB_PASSWORD)
                .locations("classpath:db/migration")
                .load();
        assertThat(migration.migrate().success).isTrue();
        repository = new InventoryAgingReportRepository(
                new NamedParameterJdbcTemplate(new DriverManagerDataSource(
                        jdbcUrl, DB_USER, DB_PASSWORD)));
        seedReportFacts();
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void appliesFifoBucketsAndTenantWarehouseLiteralSearchBoundaries() {
        LocalDate cutoffDate = LocalDate.of(2026, 8, 10);
        Instant cutoffExclusive = Instant.parse("2026-08-10T16:00:00Z");
        var all = repository.summarize(
                TENANT_A, Set.of(), true, null, null,
                cutoffDate, cutoffExclusive, PageRequest.of(0, 50));
        var scoped = repository.summarize(
                TENANT_A, Set.of(WAREHOUSE_A), false, null, "sku-old",
                cutoffDate, cutoffExclusive, PageRequest.of(0, 50));
        var otherTenant = repository.summarize(
                TENANT_B, Set.of(), true, null, null,
                cutoffDate, cutoffExclusive, PageRequest.of(0, 50));
        var escapedLiteral = repository.summarize(
                TENANT_A, Set.of(), true, null, "%_\\",
                cutoffDate, cutoffExclusive, PageRequest.of(0, 50));

        assertThat(all.totalElements()).isEqualTo(2);
        assertThat(all.totalQuantity()).isEqualTo(51);
        assertThat(all.age0To30Quantity()).isEqualTo(7);
        assertThat(all.age31To60Quantity()).isEqualTo(4);
        assertThat(all.age61To90Quantity()).isEqualTo(20);
        assertThat(all.age91To365Quantity()).isEqualTo(20);
        assertThat(all.ageOver365Quantity()).isZero();
        assertThat(scoped.items()).containsExactly(
                new InventoryAgingReportItem(
                        UUID.fromString(
                                "a2000000-0000-0000-0000-000000000201"),
                        "SKU-OLD", "SKU old",
                        WAREHOUSE_A, "WH-A", "Warehouse A",
                        LocalDate.of(2026, 3, 1), 162,
                        40, 0, 0, 20, 20, 0));
        assertThat(otherTenant.totalQuantity()).isEqualTo(99);
        assertThat(escapedLiteral.items()).isEmpty();
        assertThat(all.items()).allSatisfy(item -> assertThat(
                item.age0To30Quantity()
                        + item.age31To60Quantity()
                        + item.age61To90Quantity()
                        + item.age91To365Quantity()
                        + item.ageOver365Quantity())
                .isEqualTo(item.totalQuantity()));
    }

    private static void seedReportFacts() throws Exception {
        try (Connection connection = DriverManager.getConnection(
                jdbcUrl, DB_USER, DB_PASSWORD);
                var statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (id, code, name)
                    VALUES
                      ('a2000000-0000-0000-0000-000000000001',
                       'inventory-aging-a', 'Inventory aging A'),
                      ('b2000000-0000-0000-0000-000000000001',
                       'inventory-aging-b', 'Inventory aging B')
                    """);
            statement.executeUpdate("""
                    INSERT INTO users (
                        id, tenant_id, username, display_name, status)
                    VALUES
                      ('a2000000-0000-0000-0000-000000000011',
                       'a2000000-0000-0000-0000-000000000001',
                       'aging-a', 'Aging A', 'ACTIVE'),
                      ('b2000000-0000-0000-0000-000000000011',
                       'b2000000-0000-0000-0000-000000000001',
                       'aging-b', 'Aging B', 'ACTIVE')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_spus (
                        id, tenant_id, business_code, name)
                    VALUES
                      ('a2000000-0000-0000-0000-000000000111',
                       'a2000000-0000-0000-0000-000000000001',
                       'SPU-OLD', 'SPU old'),
                      ('a2000000-0000-0000-0000-000000000112',
                       'a2000000-0000-0000-0000-000000000001',
                       'SPU-NEW', 'SPU new'),
                      ('b2000000-0000-0000-0000-000000000111',
                       'b2000000-0000-0000-0000-000000000001',
                       'SPU-OTHER', 'SPU other')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_skus (
                        id, tenant_id, spu_id, business_code, name)
                    VALUES
                      ('a2000000-0000-0000-0000-000000000201',
                       'a2000000-0000-0000-0000-000000000001',
                       'a2000000-0000-0000-0000-000000000111',
                       'SKU-OLD', 'SKU old'),
                      ('a2000000-0000-0000-0000-000000000202',
                       'a2000000-0000-0000-0000-000000000001',
                       'a2000000-0000-0000-0000-000000000112',
                       'SKU-NEW', 'SKU new'),
                      ('b2000000-0000-0000-0000-000000000201',
                       'b2000000-0000-0000-0000-000000000001',
                       'b2000000-0000-0000-0000-000000000111',
                       'SKU-OTHER', 'SKU other')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_warehouses (
                        id, tenant_id, business_code, name)
                    VALUES
                      ('a2000000-0000-0000-0000-000000000101',
                       'a2000000-0000-0000-0000-000000000001',
                       'WH-A', 'Warehouse A'),
                      ('a2000000-0000-0000-0000-000000000102',
                       'a2000000-0000-0000-0000-000000000001',
                       'WH-B', 'Warehouse B'),
                      ('b2000000-0000-0000-0000-000000000101',
                       'b2000000-0000-0000-0000-000000000001',
                       'WH-OTHER', 'Warehouse other')
                    """);
            statement.executeUpdate("""
                    INSERT INTO inventory_ledger_events (
                        tenant_id, event_type, sku_id, warehouse_id,
                        signed_delta, balance_after, balance_version_after,
                        reason, actor_user_id, request_id, recorded_at)
                    VALUES
                      ('a2000000-0000-0000-0000-000000000001',
                       'OPENING_BALANCE',
                       'a2000000-0000-0000-0000-000000000201',
                       'a2000000-0000-0000-0000-000000000101',
                       50, 50, 1, 'AGING_OPENING',
                       'a2000000-0000-0000-0000-000000000011',
                       'aging-a-1', '2025-07-01T00:00:00Z'),
                      ('a2000000-0000-0000-0000-000000000001',
                       'CORRECTION',
                       'a2000000-0000-0000-0000-000000000201',
                       'a2000000-0000-0000-0000-000000000101',
                       30, 80, 2, 'AGING_RECEIPT',
                       'a2000000-0000-0000-0000-000000000011',
                       'aging-a-2', '2026-03-01T00:00:00Z'),
                      ('a2000000-0000-0000-0000-000000000001',
                       'CORRECTION',
                       'a2000000-0000-0000-0000-000000000201',
                       'a2000000-0000-0000-0000-000000000101',
                       20, 100, 3, 'AGING_RECEIPT',
                       'a2000000-0000-0000-0000-000000000011',
                       'aging-a-3', '2026-05-30T00:00:00Z'),
                      ('a2000000-0000-0000-0000-000000000001',
                       'CORRECTION',
                       'a2000000-0000-0000-0000-000000000201',
                       'a2000000-0000-0000-0000-000000000101',
                       -60, 40, 4, 'AGING_ISSUE',
                       'a2000000-0000-0000-0000-000000000011',
                       'aging-a-4', '2026-08-01T00:00:00Z'),
                      ('a2000000-0000-0000-0000-000000000001',
                       'OPENING_BALANCE',
                       'a2000000-0000-0000-0000-000000000202',
                       'a2000000-0000-0000-0000-000000000102',
                       4, 4, 1, 'AGING_OPENING',
                       'a2000000-0000-0000-0000-000000000011',
                       'aging-a-5', '2026-07-01T00:00:00Z'),
                      ('a2000000-0000-0000-0000-000000000001',
                       'CORRECTION',
                       'a2000000-0000-0000-0000-000000000202',
                       'a2000000-0000-0000-0000-000000000102',
                       7, 11, 2, 'AGING_RECEIPT',
                       'a2000000-0000-0000-0000-000000000011',
                       'aging-a-6', '2026-08-05T00:00:00Z'),
                      ('b2000000-0000-0000-0000-000000000001',
                       'OPENING_BALANCE',
                       'b2000000-0000-0000-0000-000000000201',
                       'b2000000-0000-0000-0000-000000000101',
                       99, 99, 1, 'AGING_OPENING',
                       'b2000000-0000-0000-0000-000000000011',
                       'aging-b-1', '2024-01-01T00:00:00Z')
                    """);
        }
    }

    private static void startPostgresql16() throws Exception {
        containerName = "erp-inventory-aging-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker(
                "run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_inventory_aging",
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
                + "/erp_inventory_aging";
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
