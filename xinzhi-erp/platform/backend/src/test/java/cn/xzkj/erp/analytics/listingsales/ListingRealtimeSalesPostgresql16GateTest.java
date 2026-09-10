package cn.xzkj.erp.analytics.listingsales;

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

class ListingRealtimeSalesPostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static final UUID TENANT_A = uuid(
            "a8900000-0000-4000-8000-000000000001");
    private static final UUID TENANT_B = uuid(
            "b8900000-0000-4000-8000-000000000001");
    private static final UUID WAREHOUSE_A = uuid(
            "a8900000-0000-4000-8000-000000000101");
    private static String containerName;
    private static String jdbcUrl;
    private static ListingRealtimeSalesRepository repository;

    @BeforeAll
    static void migrateAndSeed() throws Exception {
        startPostgresql16();
        Flyway migration = Flyway.configure()
                .dataSource(jdbcUrl, DB_USER, DB_PASSWORD)
                .locations("classpath:db/migration")
                .load();
        assertThat(migration.migrate().success).isTrue();
        var jdbc = new NamedParameterJdbcTemplate(new DriverManagerDataSource(
                jdbcUrl, DB_USER, DB_PASSWORD));
        repository = new ListingRealtimeSalesRepository(jdbc);
        seed(jdbc);
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void attributesOnlyUniqueShopSkuMappingsWithTenantWarehouseAndTimeScope() {
        Instant asOf = Instant.parse("2026-08-10T12:00:00Z");
        var all = repository.summarize(
                TENANT_A, Set.of(), true, null,
                Instant.parse("2026-08-10T00:00:00Z"), asOf,
                PageRequest.of(0, 25));
        var warehouseA = repository.summarize(
                TENANT_A, Set.of(WAREHOUSE_A), false, null,
                Instant.parse("2026-08-10T00:00:00Z"), asOf,
                PageRequest.of(0, 25));
        var tenantB = repository.summarize(
                TENANT_B, Set.of(), true, null, null, asOf,
                PageRequest.of(0, 25));
        var escaped = repository.summarize(
                TENANT_A, Set.of(), true, "item%_", null, asOf,
                PageRequest.of(0, 25));

        assertThat(all.totalListingCount()).isEqualTo(2);
        assertThat(all.totalRangeSalesQuantity()).isEqualTo(6);
        assertThat(all.items())
                .extracting(ListingRealtimeSalesItem::externalListingRef)
                .containsExactly("ITEM-SHOP-2", "ITEM-UNIQUE");
        assertThat(all.items().get(1)).satisfies(item -> {
            assertThat(item.rangeSalesQuantity()).isEqualTo(2);
            assertThat(item.last7DaysSalesQuantity()).isEqualTo(5);
            assertThat(item.rangeOrderCount()).isEqualTo(1);
        });
        assertThat(warehouseA.totalRangeSalesQuantity()).isEqualTo(6);
        assertThat(warehouseA.items())
                .filteredOn(item -> "ITEM-UNIQUE".equals(
                        item.externalListingRef()))
                .singleElement()
                .extracting(ListingRealtimeSalesItem::last7DaysSalesQuantity)
                .isEqualTo(2L);
        assertThat(tenantB.totalRangeSalesQuantity()).isEqualTo(7);
        assertThat(escaped.items()).isEmpty();
    }

    private static void seed(NamedParameterJdbcTemplate jdbc) {
        jdbc.getJdbcTemplate().execute("""
                INSERT INTO tenants (id, code, name) VALUES
                  ('a8900000-0000-4000-8000-000000000001', 'listing-sales-a', 'Listing Sales A'),
                  ('b8900000-0000-4000-8000-000000000001', 'listing-sales-b', 'Listing Sales B');
                INSERT INTO platform_catalog (id, code, display_name) VALUES
                  ('c8900000-0000-4000-8000-000000000001', 'LISTING_SALES', 'Listing Sales');
                INSERT INTO tenant_shops (id, tenant_id, platform_id, external_shop_ref, display_name) VALUES
                  ('a8900000-0000-4000-8000-000000000010', 'a8900000-0000-4000-8000-000000000001', 'c8900000-0000-4000-8000-000000000001', 'shop-a-1', 'Shop A1'),
                  ('a8900000-0000-4000-8000-000000000011', 'a8900000-0000-4000-8000-000000000001', 'c8900000-0000-4000-8000-000000000001', 'shop-a-2', 'Shop A2'),
                  ('b8900000-0000-4000-8000-000000000010', 'b8900000-0000-4000-8000-000000000001', 'c8900000-0000-4000-8000-000000000001', 'shop-b', 'Shop B');
                INSERT INTO tenant_warehouses (id, tenant_id, business_code, name) VALUES
                  ('a8900000-0000-4000-8000-000000000101', 'a8900000-0000-4000-8000-000000000001', 'WH_A', 'Warehouse A'),
                  ('a8900000-0000-4000-8000-000000000102', 'a8900000-0000-4000-8000-000000000001', 'WH_B', 'Warehouse B');
                INSERT INTO tenant_product_spus (id, tenant_id, business_code, name) VALUES
                  ('a8900000-0000-4000-8000-000000000190', 'a8900000-0000-4000-8000-000000000001', 'SPU_A', 'Product A'),
                  ('b8900000-0000-4000-8000-000000000190', 'b8900000-0000-4000-8000-000000000001', 'SPU_B', 'Product B');
                INSERT INTO tenant_product_skus (id, tenant_id, spu_id, business_code, name, variant_summary) VALUES
                  ('a8900000-0000-4000-8000-000000000201', 'a8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000190', 'SKU_UNIQUE', 'Unique Product', 'Black'),
                  ('a8900000-0000-4000-8000-000000000202', 'a8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000190', 'SKU_AMBIG', 'Ambiguous Product', NULL),
                  ('b8900000-0000-4000-8000-000000000201', 'b8900000-0000-4000-8000-000000000001', 'b8900000-0000-4000-8000-000000000190', 'SKU_B', 'Product B', NULL);
                INSERT INTO tenant_product_listings (id, tenant_id, shop_id, platform_id, sku_id, external_listing_ref, external_variant_ref) VALUES
                  ('a8900000-0000-4000-8000-000000000301', 'a8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000010', 'c8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000201', 'ITEM-UNIQUE', 'VARIANT-1'),
                  ('a8900000-0000-4000-8000-000000000302', 'a8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000010', 'c8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000202', 'ITEM-AMBIG-1', NULL),
                  ('a8900000-0000-4000-8000-000000000303', 'a8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000010', 'c8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000202', 'ITEM-AMBIG-2', NULL),
                  ('a8900000-0000-4000-8000-000000000304', 'a8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000011', 'c8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000201', 'ITEM-SHOP-2', NULL),
                  ('b8900000-0000-4000-8000-000000000301', 'b8900000-0000-4000-8000-000000000001', 'b8900000-0000-4000-8000-000000000010', 'c8900000-0000-4000-8000-000000000001', 'b8900000-0000-4000-8000-000000000201', 'ITEM-B', NULL);
                INSERT INTO tenant_orders (id, tenant_id, shop_id, external_order_ref, idempotency_key, request_fingerprint, currency, status, line_count, placed_at, warehouse_id) VALUES
                  ('a8900000-0000-4000-8000-000000000401', 'a8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000010', 'A-1', 'listing-a-1', repeat('1', 64), 'CNY', 'SHIPPED', 2, '2026-08-10T10:00:00Z', 'a8900000-0000-4000-8000-000000000101'),
                  ('a8900000-0000-4000-8000-000000000402', 'a8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000010', 'A-2', 'listing-a-2', repeat('2', 64), 'CNY', 'SHIPPED', 1, '2026-08-09T10:00:00Z', 'a8900000-0000-4000-8000-000000000102'),
                  ('a8900000-0000-4000-8000-000000000403', 'a8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000011', 'A-3', 'listing-a-3', repeat('3', 64), 'CNY', 'SHIPPED', 1, '2026-08-10T09:00:00Z', 'a8900000-0000-4000-8000-000000000101'),
                  ('a8900000-0000-4000-8000-000000000404', 'a8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000010', 'A-4', 'listing-a-4', repeat('4', 64), 'CNY', 'CANCELLED', 1, '2026-08-10T08:00:00Z', 'a8900000-0000-4000-8000-000000000101'),
                  ('b8900000-0000-4000-8000-000000000401', 'b8900000-0000-4000-8000-000000000001', 'b8900000-0000-4000-8000-000000000010', 'B-1', 'listing-b-1', repeat('5', 64), 'CNY', 'SHIPPED', 1, '2026-08-10T07:00:00Z', NULL);
                INSERT INTO tenant_order_lines (id, tenant_id, order_id, sku_id, external_line_ref, title_snapshot, quantity, unit_price_minor, currency, sku_match_source) VALUES
                  ('a8900000-0000-4000-8000-000000000501', 'a8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000401', 'a8900000-0000-4000-8000-000000000201', 'A-1-1', 'Unique Product', 2, 100, 'CNY', 'PROVIDED'),
                  ('a8900000-0000-4000-8000-000000000502', 'a8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000401', 'a8900000-0000-4000-8000-000000000202', 'A-1-2', 'Ambiguous Product', 9, 100, 'CNY', 'PROVIDED'),
                  ('a8900000-0000-4000-8000-000000000503', 'a8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000402', 'a8900000-0000-4000-8000-000000000201', 'A-2-1', 'Unique Product', 3, 100, 'CNY', 'PROVIDED'),
                  ('a8900000-0000-4000-8000-000000000504', 'a8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000403', 'a8900000-0000-4000-8000-000000000201', 'A-3-1', 'Unique Product', 4, 100, 'CNY', 'PROVIDED'),
                  ('a8900000-0000-4000-8000-000000000505', 'a8900000-0000-4000-8000-000000000001', 'a8900000-0000-4000-8000-000000000404', 'a8900000-0000-4000-8000-000000000201', 'A-4-1', 'Unique Product', 10, 100, 'CNY', 'PROVIDED'),
                  ('b8900000-0000-4000-8000-000000000501', 'b8900000-0000-4000-8000-000000000001', 'b8900000-0000-4000-8000-000000000401', 'b8900000-0000-4000-8000-000000000201', 'B-1-1', 'Product B', 7, 100, 'CNY', 'PROVIDED');
                """);
    }

    private static void startPostgresql16() throws Exception {
        containerName = "erp-listing-sales-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker(
                "run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_listing_sales",
                "-e", "POSTGRES_USER=" + DB_USER,
                "-e", "POSTGRES_PASSWORD=" + DB_PASSWORD,
                "-p", "127.0.0.1::5432", "postgres:16-alpine");
        assertThat(id).isNotBlank();
        String binding = runDocker("port", containerName, "5432/tcp").strip();
        int separator = binding.lastIndexOf(':');
        jdbcUrl = "jdbc:postgresql://127.0.0.1:"
                + binding.substring(separator + 1) + "/erp_listing_sales";
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
                    .redirectErrorStream(true).start();
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

    private static UUID uuid(String value) {
        return UUID.fromString(value);
    }
}
