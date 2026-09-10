package cn.xzkj.erp.procurement.statistics;

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

class PurchaserStatisticsPostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT = UUID.fromString(
            "a7400000-0000-4000-8000-000000000001");
    private static final UUID WAREHOUSE_A = UUID.fromString(
            "a7400000-0000-4000-8000-000000000020");
    private static String containerName;
    private static String jdbcUrl;
    private static PurchaserStatisticsRepository repository;

    @BeforeAll
    static void migrateAndSeed() throws Exception {
        startPostgresql16();
        Flyway migration = Flyway.configure()
                .dataSource(jdbcUrl, DB_USER, DB_PASSWORD)
                .locations("classpath:db/migration")
                .load();
        assertThat(migration.migrate().success).isTrue();
        repository = new PurchaserStatisticsRepository(
                new NamedParameterJdbcTemplate(new DriverManagerDataSource(
                        jdbcUrl, DB_USER, DB_PASSWORD)));
        seedFacts();
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void aggregatesExactOperationalFactsAndEnforcesWarehouseScope() {
        var daily = repository.summarize(
                TENANT, Set.of(), true, PurchaserStatisticsGranularity.DAY,
                null, Instant.parse("2026-08-01T00:00:00Z"),
                Instant.parse("2026-08-03T00:00:00Z"),
                PageRequest.of(0, 25));
        var monthlyBuyer = repository.summarize(
                TENANT, Set.of(), true, PurchaserStatisticsGranularity.MONTH,
                "buyer a", null, null, PageRequest.of(0, 25));
        var scoped = repository.summarize(
                TENANT, Set.of(WAREHOUSE_A), false,
                PurchaserStatisticsGranularity.DAY, null, null, null,
                PageRequest.of(0, 25));
        var escapedLiteral = repository.summarize(
                TENANT, Set.of(), true, PurchaserStatisticsGranularity.DAY,
                "buyer%_\\x", null, null, PageRequest.of(0, 25));

        assertThat(daily.totalOrders()).isEqualTo(4);
        assertThat(daily.totalOrderedQuantity()).isEqualTo(27);
        assertThat(daily.totalReceivedQuantity()).isEqualTo(8);
        assertThat(daily.totalOutstandingQuantity()).isEqualTo(19);
        assertThat(daily.totalGroups()).isEqualTo(2);
        assertThat(daily.items()).extracting(
                PurchaserStatisticsView::periodStart)
                .containsExactly(
                        LocalDate.parse("2026-08-02"),
                        LocalDate.parse("2026-08-01"));
        PurchaserStatisticsView firstDay = daily.items().get(1);
        assertThat(firstDay.purchaserDisplayName()).isEqualTo("Buyer A");
        assertThat(firstDay.orderCount()).isEqualTo(2);
        assertThat(firstDay.orderedQuantity()).isEqualTo(18);
        assertThat(firstDay.receivedQuantity()).isEqualTo(3);
        assertThat(firstDay.newOrderCount()).isEqualTo(1);
        assertThat(firstDay.approvedOrderCount()).isZero();
        assertThat(firstDay.partiallyReceivedOrderCount()).isEqualTo(1);
        PurchaserStatisticsView secondDay = daily.items().getFirst();
        assertThat(secondDay.orderCount()).isEqualTo(2);
        assertThat(secondDay.approvedOrderCount()).isEqualTo(1);
        assertThat(secondDay.receivedOrderCount()).isEqualTo(1);
        assertThat(secondDay.newOrderCount()
                + secondDay.approvedOrderCount()
                + secondDay.partiallyReceivedOrderCount()
                + secondDay.receivedOrderCount())
                .isEqualTo(secondDay.orderCount());

        assertThat(monthlyBuyer.totalGroups()).isEqualTo(1);
        assertThat(monthlyBuyer.totalOrders()).isEqualTo(2);
        assertThat(monthlyBuyer.items().getFirst().periodStart())
                .isEqualTo(LocalDate.parse("2026-08-01"));
        assertThat(scoped.totalOrders()).isEqualTo(3);
        assertThat(scoped.totalOrderedQuantity()).isEqualTo(19);
        assertThat(scoped.totalReceivedQuantity()).isEqualTo(5);
        assertThat(escapedLiteral.items()).isEmpty();
    }

    private static void seedFacts() throws Exception {
        try (Connection connection = DriverManager.getConnection(
                jdbcUrl, DB_USER, DB_PASSWORD);
                var statement = connection.createStatement()) {
            statement.executeUpdate("""
                    INSERT INTO tenants (id, code, name)
                    VALUES ('a7400000-0000-4000-8000-000000000001',
                            'purchaser-stats', 'Purchaser statistics')
                    """);
            statement.executeUpdate("""
                    INSERT INTO users (
                        id, tenant_id, username, display_name)
                    VALUES
                      ('a7400000-0000-4000-8000-000000000003',
                       'a7400000-0000-4000-8000-000000000001',
                       'buyer-a', 'Buyer A'),
                      ('a7400000-0000-4000-8000-000000000004',
                       'a7400000-0000-4000-8000-000000000001',
                       'buyer-b', 'Buyer B')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_spus (
                        id, tenant_id, business_code, name, status)
                    VALUES ('a7400000-0000-4000-8000-000000000010',
                            'a7400000-0000-4000-8000-000000000001',
                            'STATS_SPU', 'Statistics product', 'ACTIVE')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_product_skus (
                        id, tenant_id, spu_id, business_code, name, status)
                    VALUES ('a7400000-0000-4000-8000-000000000011',
                            'a7400000-0000-4000-8000-000000000001',
                            'a7400000-0000-4000-8000-000000000010',
                            'STATS_SKU', 'Statistics SKU', 'ACTIVE')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_warehouses (
                        id, tenant_id, business_code, name, status)
                    VALUES
                      ('a7400000-0000-4000-8000-000000000020',
                       'a7400000-0000-4000-8000-000000000001',
                       'STATS_WH_A', 'Warehouse A', 'ACTIVE'),
                      ('a7400000-0000-4000-8000-000000000022',
                       'a7400000-0000-4000-8000-000000000001',
                       'STATS_WH_B', 'Warehouse B', 'ACTIVE')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_warehouse_locations (
                        id, tenant_id, warehouse_id, business_code, name,
                        status)
                    VALUES
                      ('a7400000-0000-4000-8000-000000000021',
                       'a7400000-0000-4000-8000-000000000001',
                       'a7400000-0000-4000-8000-000000000020',
                       'STATS_LOC_A', 'Location A', 'ACTIVE'),
                      ('a7400000-0000-4000-8000-000000000023',
                       'a7400000-0000-4000-8000-000000000001',
                       'a7400000-0000-4000-8000-000000000022',
                       'STATS_LOC_B', 'Location B', 'ACTIVE')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_suppliers (
                        id, tenant_id, business_code, name, status)
                    VALUES ('a7400000-0000-4000-8000-000000000030',
                            'a7400000-0000-4000-8000-000000000001',
                            'STATS_SUP', 'Statistics supplier', 'ACTIVE')
                    """);
            statement.executeUpdate("""
                    INSERT INTO tenant_supplier_sku_mappings (
                        id, tenant_id, supplier_id, sku_id, status,
                        preferred)
                    VALUES ('a7400000-0000-4000-8000-000000000031',
                            'a7400000-0000-4000-8000-000000000001',
                            'a7400000-0000-4000-8000-000000000030',
                            'a7400000-0000-4000-8000-000000000011',
                            'ACTIVE', true)
                    """);
            statement.executeUpdate("""
                    INSERT INTO procurement_plans (
                        id, tenant_id, plan_no, status, sku_id,
                        sku_code_snapshot, sku_name_snapshot, warehouse_id,
                        warehouse_code_snapshot, warehouse_name_snapshot,
                        location_id, location_code_snapshot,
                        location_name_snapshot, quantity,
                        applicant_display_name, applicant_user_id)
                    VALUES
                      ('a7400000-0000-4000-8000-000000000041',
                       'a7400000-0000-4000-8000-000000000001',
                       'PP-20260801-0000000000000000000000000001', 'ORDERED',
                       'a7400000-0000-4000-8000-000000000011',
                       'STATS_SKU', 'Statistics SKU',
                       'a7400000-0000-4000-8000-000000000020',
                       'STATS_WH_A', 'Warehouse A',
                       'a7400000-0000-4000-8000-000000000021',
                       'STATS_LOC_A', 'Location A', 10, 'Buyer A',
                       'a7400000-0000-4000-8000-000000000003'),
                      ('a7400000-0000-4000-8000-000000000042',
                       'a7400000-0000-4000-8000-000000000001',
                       'PP-20260801-0000000000000000000000000002', 'ORDERED',
                       'a7400000-0000-4000-8000-000000000011',
                       'STATS_SKU', 'Statistics SKU',
                       'a7400000-0000-4000-8000-000000000022',
                       'STATS_WH_B', 'Warehouse B',
                       'a7400000-0000-4000-8000-000000000023',
                       'STATS_LOC_B', 'Location B', 8, 'Buyer A',
                       'a7400000-0000-4000-8000-000000000003'),
                      ('a7400000-0000-4000-8000-000000000043',
                       'a7400000-0000-4000-8000-000000000001',
                       'PP-20260801-0000000000000000000000000003', 'ORDERED',
                       'a7400000-0000-4000-8000-000000000011',
                       'STATS_SKU', 'Statistics SKU',
                       'a7400000-0000-4000-8000-000000000020',
                       'STATS_WH_A', 'Warehouse A',
                       'a7400000-0000-4000-8000-000000000021',
                       'STATS_LOC_A', 'Location A', 5, 'Buyer B',
                       'a7400000-0000-4000-8000-000000000004'),
                      ('a7400000-0000-4000-8000-000000000044',
                       'a7400000-0000-4000-8000-000000000001',
                       'PP-20260801-0000000000000000000000000004', 'ORDERED',
                       'a7400000-0000-4000-8000-000000000011',
                       'STATS_SKU', 'Statistics SKU',
                       'a7400000-0000-4000-8000-000000000020',
                       'STATS_WH_A', 'Warehouse A',
                       'a7400000-0000-4000-8000-000000000021',
                       'STATS_LOC_A', 'Location A', 4, 'Buyer B',
                       'a7400000-0000-4000-8000-000000000004'),
                      ('a7400000-0000-4000-8000-000000000045',
                       'a7400000-0000-4000-8000-000000000001',
                       'PP-20260801-0000000000000000000000000005', 'ORDERED',
                       'a7400000-0000-4000-8000-000000000011',
                       'STATS_SKU', 'Statistics SKU',
                       'a7400000-0000-4000-8000-000000000020',
                       'STATS_WH_A', 'Warehouse A',
                       'a7400000-0000-4000-8000-000000000021',
                       'STATS_LOC_A', 'Location A', 100, 'Buyer B',
                       'a7400000-0000-4000-8000-000000000004')
                    """);
            statement.executeUpdate("""
                    INSERT INTO procurement_purchase_orders (
                        id, tenant_id, purchase_no, status, plan_id,
                        plan_no_snapshot, supplier_id,
                        supplier_code_snapshot, supplier_name_snapshot,
                        sku_id, sku_code_snapshot, sku_name_snapshot,
                        warehouse_id, warehouse_code_snapshot,
                        warehouse_name_snapshot, location_id,
                        location_code_snapshot, location_name_snapshot,
                        quantity, received_quantity, last_received_at,
                        ordered_by_display_name, ordered_by_user_id,
                        review_decision, review_note, reviewed_by_display_name,
                        reviewed_by_user_id, reviewed_at,
                        created_at, updated_at)
                    VALUES
                      ('a7400000-0000-4000-8000-000000000051',
                       'a7400000-0000-4000-8000-000000000001',
                       'PO-20260801-0000000000000000000000000001', 'NEW_ORDER',
                       'a7400000-0000-4000-8000-000000000041',
                       'PP-20260801-0000000000000000000000000001',
                       'a7400000-0000-4000-8000-000000000030',
                       'STATS_SUP', 'Statistics supplier',
                       'a7400000-0000-4000-8000-000000000011',
                       'STATS_SKU', 'Statistics SKU',
                       'a7400000-0000-4000-8000-000000000020',
                       'STATS_WH_A', 'Warehouse A',
                       'a7400000-0000-4000-8000-000000000021',
                       'STATS_LOC_A', 'Location A', 10, 0, NULL,
                       'Buyer A', 'a7400000-0000-4000-8000-000000000003',
                       NULL, NULL, NULL, NULL, NULL,
                       '2026-08-01T08:00:00Z', '2026-08-01T08:00:00Z'),
                      ('a7400000-0000-4000-8000-000000000052',
                       'a7400000-0000-4000-8000-000000000001',
                       'PO-20260801-0000000000000000000000000002',
                       'PARTIALLY_RECEIVED',
                       'a7400000-0000-4000-8000-000000000042',
                       'PP-20260801-0000000000000000000000000002',
                       'a7400000-0000-4000-8000-000000000030',
                       'STATS_SUP', 'Statistics supplier',
                       'a7400000-0000-4000-8000-000000000011',
                       'STATS_SKU', 'Statistics SKU',
                       'a7400000-0000-4000-8000-000000000022',
                       'STATS_WH_B', 'Warehouse B',
                       'a7400000-0000-4000-8000-000000000023',
                       'STATS_LOC_B', 'Location B', 8, 3,
                       '2026-08-02T04:00:00Z', 'Buyer A',
                       'a7400000-0000-4000-8000-000000000003',
                       'APPROVED', NULL, 'Buyer A',
                       'a7400000-0000-4000-8000-000000000003',
                       '2026-08-01T10:00:00Z',
                       '2026-08-01T10:00:00Z', '2026-08-02T04:00:00Z'),
                      ('a7400000-0000-4000-8000-000000000053',
                       'a7400000-0000-4000-8000-000000000001',
                       'PO-20260801-0000000000000000000000000003', 'RECEIVED',
                       'a7400000-0000-4000-8000-000000000043',
                       'PP-20260801-0000000000000000000000000003',
                       'a7400000-0000-4000-8000-000000000030',
                       'STATS_SUP', 'Statistics supplier',
                       'a7400000-0000-4000-8000-000000000011',
                       'STATS_SKU', 'Statistics SKU',
                       'a7400000-0000-4000-8000-000000000020',
                       'STATS_WH_A', 'Warehouse A',
                       'a7400000-0000-4000-8000-000000000021',
                       'STATS_LOC_A', 'Location A', 5, 5,
                       '2026-08-02T08:00:00Z', 'Buyer B',
                       'a7400000-0000-4000-8000-000000000004',
                       'APPROVED', NULL, 'Buyer B',
                       'a7400000-0000-4000-8000-000000000004',
                       '2026-08-02T06:00:00Z',
                       '2026-08-02T06:00:00Z', '2026-08-02T08:00:00Z'),
                      ('a7400000-0000-4000-8000-000000000054',
                       'a7400000-0000-4000-8000-000000000001',
                       'PO-20260801-0000000000000000000000000004', 'APPROVED',
                       'a7400000-0000-4000-8000-000000000044',
                       'PP-20260801-0000000000000000000000000004',
                       'a7400000-0000-4000-8000-000000000030',
                       'STATS_SUP', 'Statistics supplier',
                       'a7400000-0000-4000-8000-000000000011',
                       'STATS_SKU', 'Statistics SKU',
                       'a7400000-0000-4000-8000-000000000020',
                       'STATS_WH_A', 'Warehouse A',
                       'a7400000-0000-4000-8000-000000000021',
                       'STATS_LOC_A', 'Location A', 4, 0, NULL,
                       'Buyer B', 'a7400000-0000-4000-8000-000000000004',
                       'APPROVED', NULL, 'Buyer B',
                       'a7400000-0000-4000-8000-000000000004',
                       '2026-08-02T09:00:00Z',
                       '2026-08-02T08:30:00Z', '2026-08-02T09:00:00Z'),
                      ('a7400000-0000-4000-8000-000000000055',
                       'a7400000-0000-4000-8000-000000000001',
                       'PO-20260801-0000000000000000000000000005', 'REJECTED',
                       'a7400000-0000-4000-8000-000000000045',
                       'PP-20260801-0000000000000000000000000005',
                       'a7400000-0000-4000-8000-000000000030',
                       'STATS_SUP', 'Statistics supplier',
                       'a7400000-0000-4000-8000-000000000011',
                       'STATS_SKU', 'Statistics SKU',
                       'a7400000-0000-4000-8000-000000000020',
                       'STATS_WH_A', 'Warehouse A',
                       'a7400000-0000-4000-8000-000000000021',
                       'STATS_LOC_A', 'Location A', 100, 0, NULL,
                       'Buyer B', 'a7400000-0000-4000-8000-000000000004',
                       'REJECTED', 'Rejected for statistics regression',
                       'Buyer A',
                       'a7400000-0000-4000-8000-000000000003',
                       '2026-08-02T10:00:00Z',
                       '2026-08-02T09:30:00Z', '2026-08-02T10:00:00Z')
                    """);
        }
    }

    private static void startPostgresql16() throws Exception {
        containerName = "erp-purchaser-statistics-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker(
                "run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_purchaser_statistics",
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
                + "/erp_purchaser_statistics";
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
