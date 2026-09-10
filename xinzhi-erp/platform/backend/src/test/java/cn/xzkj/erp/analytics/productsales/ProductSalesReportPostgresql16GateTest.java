package cn.xzkj.erp.analytics.productsales;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

class ProductSalesReportPostgresql16GateTest {
    private static final UUID TENANT_A = uuid("a7600000-0000-4000-8000-000000000001");
    private static final UUID TENANT_B = uuid("b7600000-0000-4000-8000-000000000001");
    private static final UUID WAREHOUSE_A = uuid("a7600000-0000-4000-8000-000000000101");
    private static final UUID WAREHOUSE_B = uuid("a7600000-0000-4000-8000-000000000102");
    private static final UUID SKU_A_1 = uuid("a7600000-0000-4000-8000-000000000201");
    private static final UUID SKU_A_2 = uuid("a7600000-0000-4000-8000-000000000202");
    private static PostgreSQLContainer<?> postgres;
    private static ProductSalesReportRepository repository;

    @BeforeAll
    static void migrateAndSeed() {
        postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                .withDatabaseName("erp_product_sales_report")
                .withUsername("erp")
                .withPassword("erp");
        postgres.start();
        Flyway flyway = Flyway.configure()
                .dataSource(postgres.getJdbcUrl(), "erp", "erp")
                .locations("classpath:db/migration")
                .load();
        assertThat(flyway.migrate().success).isTrue();
        var jdbc = new NamedParameterJdbcTemplate(new DriverManagerDataSource(
                postgres.getJdbcUrl(), "erp", "erp"));
        repository = new ProductSalesReportRepository(jdbc);
        seed(jdbc);
    }

    @AfterAll
    static void stop() {
        if (postgres != null) postgres.stop();
    }

    @Test
    void aggregatesMatchedNonCancelledLinesWithTenantWarehouseAndDateScope() {
        var all = repository.summarize(
                TENANT_A, Set.of(), true, null, null, null,
                PageRequest.of(0, 25));
        var warehouseA = repository.summarize(
                TENANT_A, Set.of(WAREHOUSE_A), false, null, null, null,
                PageRequest.of(0, 25));
        var secondDay = repository.summarize(
                TENANT_A, Set.of(), true, "sku_a_1",
                Instant.parse("2026-08-02T00:00:00Z"),
                Instant.parse("2026-08-03T00:00:00Z"),
                PageRequest.of(0, 25));
        var tenantB = repository.summarize(
                TENANT_B, Set.of(), true, null, null, null,
                PageRequest.of(0, 25));
        var escaped = repository.summarize(
                TENANT_A, Set.of(), true, "sku%_", null, null,
                PageRequest.of(0, 25));

        assertThat(all.totalSkuCount()).isEqualTo(2);
        assertThat(all.totalSalesQuantity()).isEqualTo(6);
        assertThat(all.items()).extracting(ProductSalesReportItem::skuId)
                .containsExactly(SKU_A_1, SKU_A_2);
        assertThat(all.items().getFirst().orderCount()).isEqualTo(2);
        assertThat(all.items().getFirst().salesQuantity()).isEqualTo(5);
        assertThat(warehouseA.totalSalesQuantity()).isEqualTo(3);
        assertThat(secondDay.items()).singleElement().satisfies(item -> {
            assertThat(item.skuId()).isEqualTo(SKU_A_1);
            assertThat(item.salesQuantity()).isEqualTo(3);
        });
        assertThat(tenantB.totalSalesQuantity()).isEqualTo(4);
        assertThat(escaped.items()).isEmpty();
    }

    private static void seed(NamedParameterJdbcTemplate jdbc) {
        jdbc.getJdbcTemplate().execute("""
                INSERT INTO tenants (id, code, name) VALUES
                  ('a7600000-0000-4000-8000-000000000001', 'sales-a', 'Sales A'),
                  ('b7600000-0000-4000-8000-000000000001', 'sales-b', 'Sales B');
                INSERT INTO platform_catalog (id, code, display_name) VALUES
                  ('c7600000-0000-4000-8000-000000000001', 'SALES_DEMO', 'Sales Demo');
                INSERT INTO tenant_shops (id, tenant_id, platform_id, external_shop_ref, display_name) VALUES
                  ('a7600000-0000-4000-8000-000000000010', 'a7600000-0000-4000-8000-000000000001', 'c7600000-0000-4000-8000-000000000001', 'shop-a', 'Shop A'),
                  ('b7600000-0000-4000-8000-000000000010', 'b7600000-0000-4000-8000-000000000001', 'c7600000-0000-4000-8000-000000000001', 'shop-b', 'Shop B');
                INSERT INTO tenant_warehouses (id, tenant_id, business_code, name) VALUES
                  ('a7600000-0000-4000-8000-000000000101', 'a7600000-0000-4000-8000-000000000001', 'SALES_A', 'Warehouse A'),
                  ('a7600000-0000-4000-8000-000000000102', 'a7600000-0000-4000-8000-000000000001', 'SALES_B', 'Warehouse B');
                INSERT INTO tenant_product_spus (id, tenant_id, business_code, name) VALUES
                  ('a7600000-0000-4000-8000-000000000190', 'a7600000-0000-4000-8000-000000000001', 'SPU_A', 'Product A'),
                  ('b7600000-0000-4000-8000-000000000190', 'b7600000-0000-4000-8000-000000000001', 'SPU_B', 'Product B');
                INSERT INTO tenant_product_skus (id, tenant_id, spu_id, business_code, name, variant_summary) VALUES
                  ('a7600000-0000-4000-8000-000000000201', 'a7600000-0000-4000-8000-000000000001', 'a7600000-0000-4000-8000-000000000190', 'SKU_A_1', 'Product A1', 'Black'),
                  ('a7600000-0000-4000-8000-000000000202', 'a7600000-0000-4000-8000-000000000001', 'a7600000-0000-4000-8000-000000000190', 'SKU_A_2', 'Product A2', NULL),
                  ('b7600000-0000-4000-8000-000000000201', 'b7600000-0000-4000-8000-000000000001', 'b7600000-0000-4000-8000-000000000190', 'SKU_B_1', 'Product B1', NULL);
                INSERT INTO tenant_orders (id, tenant_id, shop_id, external_order_ref, idempotency_key, request_fingerprint, currency, status, line_count, placed_at, warehouse_id) VALUES
                  ('a7600000-0000-4000-8000-000000000301', 'a7600000-0000-4000-8000-000000000001', 'a7600000-0000-4000-8000-000000000010', 'A-1', 'sales-a-1', repeat('a', 64), 'CNY', 'READY_TO_FULFILL', 2, '2026-08-01T01:00:00Z', 'a7600000-0000-4000-8000-000000000101'),
                  ('a7600000-0000-4000-8000-000000000302', 'a7600000-0000-4000-8000-000000000001', 'a7600000-0000-4000-8000-000000000010', 'A-2', 'sales-a-2', repeat('b', 64), 'CNY', 'SHIPPED', 1, '2026-08-02T01:00:00Z', 'a7600000-0000-4000-8000-000000000102'),
                  ('a7600000-0000-4000-8000-000000000303', 'a7600000-0000-4000-8000-000000000001', 'a7600000-0000-4000-8000-000000000010', 'A-3', 'sales-a-3', repeat('c', 64), 'CNY', 'CANCELLED', 1, '2026-08-02T02:00:00Z', 'a7600000-0000-4000-8000-000000000101'),
                  ('b7600000-0000-4000-8000-000000000301', 'b7600000-0000-4000-8000-000000000001', 'b7600000-0000-4000-8000-000000000010', 'B-1', 'sales-b-1', repeat('d', 64), 'CNY', 'RECEIVED', 1, '2026-08-01T01:00:00Z', NULL);
                INSERT INTO tenant_order_lines (id, tenant_id, order_id, sku_id, external_line_ref, title_snapshot, quantity, unit_price_minor, currency, sku_match_source) VALUES
                  ('a7600000-0000-4000-8000-000000000401', 'a7600000-0000-4000-8000-000000000001', 'a7600000-0000-4000-8000-000000000301', 'a7600000-0000-4000-8000-000000000201', 'A-1-1', 'Product A1', 2, 100, 'CNY', 'PROVIDED'),
                  ('a7600000-0000-4000-8000-000000000402', 'a7600000-0000-4000-8000-000000000001', 'a7600000-0000-4000-8000-000000000301', 'a7600000-0000-4000-8000-000000000202', 'A-1-2', 'Product A2', 1, 100, 'CNY', 'PROVIDED'),
                  ('a7600000-0000-4000-8000-000000000403', 'a7600000-0000-4000-8000-000000000001', 'a7600000-0000-4000-8000-000000000302', 'a7600000-0000-4000-8000-000000000201', 'A-2-1', 'Product A1', 3, 100, 'CNY', 'PROVIDED'),
                  ('a7600000-0000-4000-8000-000000000404', 'a7600000-0000-4000-8000-000000000001', 'a7600000-0000-4000-8000-000000000303', 'a7600000-0000-4000-8000-000000000201', 'A-3-1', 'Product A1', 10, 100, 'CNY', 'PROVIDED'),
                  ('b7600000-0000-4000-8000-000000000401', 'b7600000-0000-4000-8000-000000000001', 'b7600000-0000-4000-8000-000000000301', 'b7600000-0000-4000-8000-000000000201', 'B-1-1', 'Product B1', 4, 100, 'CNY', 'PROVIDED');
                """);
    }

    private static UUID uuid(String value) {
        return UUID.fromString(value);
    }
}
