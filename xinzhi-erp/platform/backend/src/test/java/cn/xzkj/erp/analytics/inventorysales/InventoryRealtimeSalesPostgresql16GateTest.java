package cn.xzkj.erp.analytics.inventorysales;

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

class InventoryRealtimeSalesPostgresql16GateTest {
    private static final UUID TENANT_A = uuid(
            "a7700000-0000-4000-8000-000000000001");
    private static final UUID TENANT_B = uuid(
            "b7700000-0000-4000-8000-000000000001");
    private static final UUID WAREHOUSE_A = uuid(
            "a7700000-0000-4000-8000-000000000101");
    private static final UUID SKU_A_1 = uuid(
            "a7700000-0000-4000-8000-000000000201");
    private static PostgreSQLContainer<?> postgres;
    private static InventoryRealtimeSalesRepository repository;

    @BeforeAll
    static void migrateAndSeed() {
        postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                .withDatabaseName("erp_inventory_realtime_sales")
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
        repository = new InventoryRealtimeSalesRepository(jdbc);
        seed(jdbc);
    }

    @AfterAll
    static void stop() {
        if (postgres != null) postgres.stop();
    }

    @Test
    void joinsCurrentBalancesToExplicitWarehouseSalesWithStableWindows() {
        Instant rangeFrom = Instant.parse("2026-08-01T00:00:00Z");
        Instant asOf = Instant.parse("2026-08-10T12:00:00Z");
        var all = repository.summarize(
                TENANT_A, Set.of(), true, null, rangeFrom, asOf,
                PageRequest.of(0, 25));
        var warehouseA = repository.summarize(
                TENANT_A, Set.of(WAREHOUSE_A), false, null,
                rangeFrom, asOf, PageRequest.of(0, 25));
        var tenantB = repository.summarize(
                TENANT_B, Set.of(), true, null, rangeFrom, asOf,
                PageRequest.of(0, 25));
        var escaped = repository.summarize(
                TENANT_A, Set.of(), true, "sku%_", rangeFrom, asOf,
                PageRequest.of(0, 25));

        assertThat(all.totalBalanceCount()).isEqualTo(2);
        assertThat(all.totalOnHand()).isEqualTo(28);
        assertThat(all.totalAvailable()).isEqualTo(28);
        assertThat(all.totalRangeSalesQuantity()).isEqualTo(10);
        assertThat(all.items()).extracting(InventoryRealtimeSalesItem::skuId)
                .containsExactly(SKU_A_1,
                        uuid("a7700000-0000-4000-8000-000000000202"));
        assertThat(all.items().getFirst()).satisfies(item -> {
            assertThat(item.rangeSalesQuantity()).isEqualTo(9);
            assertThat(item.rangeOrderCount()).isEqualTo(3);
            assertThat(item.todaySalesQuantity()).isEqualTo(3);
            assertThat(item.yesterdaySalesQuantity()).isEqualTo(2);
            assertThat(item.last7DaysSalesQuantity()).isEqualTo(9);
            assertThat(item.last28DaysSalesQuantity()).isEqualTo(14);
            assertThat(item.last42DaysSalesQuantity()).isEqualTo(20);
        });
        assertThat(warehouseA.totalBalanceCount()).isEqualTo(1);
        assertThat(tenantB.totalOnHand()).isEqualTo(99);
        assertThat(escaped.items()).isEmpty();
    }

    private static void seed(NamedParameterJdbcTemplate jdbc) {
        jdbc.getJdbcTemplate().execute("""
                INSERT INTO tenants (id, code, name) VALUES
                  ('a7700000-0000-4000-8000-000000000001', 'inv-sales-a', 'Inventory Sales A'),
                  ('b7700000-0000-4000-8000-000000000001', 'inv-sales-b', 'Inventory Sales B');
                INSERT INTO platform_catalog (id, code, display_name) VALUES
                  ('c7700000-0000-4000-8000-000000000001', 'INV_SALES', 'Inventory Sales');
                INSERT INTO tenant_shops (id, tenant_id, platform_id, external_shop_ref, display_name) VALUES
                  ('a7700000-0000-4000-8000-000000000010', 'a7700000-0000-4000-8000-000000000001', 'c7700000-0000-4000-8000-000000000001', 'shop-a', 'Shop A'),
                  ('b7700000-0000-4000-8000-000000000010', 'b7700000-0000-4000-8000-000000000001', 'c7700000-0000-4000-8000-000000000001', 'shop-b', 'Shop B');
                INSERT INTO tenant_warehouses (id, tenant_id, business_code, name) VALUES
                  ('a7700000-0000-4000-8000-000000000101', 'a7700000-0000-4000-8000-000000000001', 'WH_A', 'Warehouse A'),
                  ('a7700000-0000-4000-8000-000000000102', 'a7700000-0000-4000-8000-000000000001', 'WH_B', 'Warehouse B'),
                  ('b7700000-0000-4000-8000-000000000101', 'b7700000-0000-4000-8000-000000000001', 'WH_B_TENANT', 'Warehouse Tenant B');
                INSERT INTO tenant_product_spus (id, tenant_id, business_code, name) VALUES
                  ('a7700000-0000-4000-8000-000000000190', 'a7700000-0000-4000-8000-000000000001', 'SPU_A', 'Product A'),
                  ('b7700000-0000-4000-8000-000000000190', 'b7700000-0000-4000-8000-000000000001', 'SPU_B', 'Product B');
                INSERT INTO tenant_product_skus (id, tenant_id, spu_id, business_code, name, variant_summary) VALUES
                  ('a7700000-0000-4000-8000-000000000201', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000190', 'SKU_A_1', 'Product A1', 'Black'),
                  ('a7700000-0000-4000-8000-000000000202', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000190', 'SKU_A_2', 'Product A2', NULL),
                  ('b7700000-0000-4000-8000-000000000201', 'b7700000-0000-4000-8000-000000000001', 'b7700000-0000-4000-8000-000000000190', 'SKU_B_1', 'Product B1', NULL);
                INSERT INTO inventory_balances (id, tenant_id, sku_id, warehouse_id, on_hand, updated_at) VALUES
                  ('a7700000-0000-4000-8000-000000000501', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000201', 'a7700000-0000-4000-8000-000000000101', 20, '2026-08-10T11:00:00Z'),
                  ('a7700000-0000-4000-8000-000000000502', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000202', 'a7700000-0000-4000-8000-000000000102', 8, '2026-08-10T11:00:00Z'),
                  ('b7700000-0000-4000-8000-000000000501', 'b7700000-0000-4000-8000-000000000001', 'b7700000-0000-4000-8000-000000000201', 'b7700000-0000-4000-8000-000000000101', 99, '2026-08-10T11:00:00Z');
                INSERT INTO tenant_orders (id, tenant_id, shop_id, external_order_ref, idempotency_key, request_fingerprint, currency, status, line_count, placed_at, warehouse_id) VALUES
                  ('a7700000-0000-4000-8000-000000000301', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000010', 'A-1', 'inv-a-1', repeat('1', 64), 'CNY', 'READY_TO_FULFILL', 1, '2026-08-10T10:00:00Z', 'a7700000-0000-4000-8000-000000000101'),
                  ('a7700000-0000-4000-8000-000000000302', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000010', 'A-2', 'inv-a-2', repeat('2', 64), 'CNY', 'SHIPPED', 1, '2026-08-09T10:00:00Z', 'a7700000-0000-4000-8000-000000000101'),
                  ('a7700000-0000-4000-8000-000000000303', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000010', 'A-3', 'inv-a-3', repeat('3', 64), 'CNY', 'SHIPPED', 1, '2026-08-05T10:00:00Z', 'a7700000-0000-4000-8000-000000000101'),
                  ('a7700000-0000-4000-8000-000000000304', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000010', 'A-4', 'inv-a-4', repeat('4', 64), 'CNY', 'SHIPPED', 1, '2026-07-20T10:00:00Z', 'a7700000-0000-4000-8000-000000000101'),
                  ('a7700000-0000-4000-8000-000000000305', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000010', 'A-5', 'inv-a-5', repeat('5', 64), 'CNY', 'SHIPPED', 1, '2026-07-05T10:00:00Z', 'a7700000-0000-4000-8000-000000000101'),
                  ('a7700000-0000-4000-8000-000000000306', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000010', 'A-6', 'inv-a-6', repeat('6', 64), 'CNY', 'SHIPPED', 1, '2026-06-01T10:00:00Z', 'a7700000-0000-4000-8000-000000000101'),
                  ('a7700000-0000-4000-8000-000000000307', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000010', 'A-7', 'inv-a-7', repeat('7', 64), 'CNY', 'CANCELLED', 1, '2026-08-10T10:30:00Z', 'a7700000-0000-4000-8000-000000000101'),
                  ('a7700000-0000-4000-8000-000000000308', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000010', 'A-8', 'inv-a-8', repeat('8', 64), 'CNY', 'SHIPPED', 1, '2026-08-10T09:00:00Z', 'a7700000-0000-4000-8000-000000000102'),
                  ('b7700000-0000-4000-8000-000000000301', 'b7700000-0000-4000-8000-000000000001', 'b7700000-0000-4000-8000-000000000010', 'B-1', 'inv-b-1', repeat('9', 64), 'CNY', 'SHIPPED', 1, '2026-08-10T09:00:00Z', 'b7700000-0000-4000-8000-000000000101');
                INSERT INTO tenant_order_lines (id, tenant_id, order_id, sku_id, external_line_ref, title_snapshot, quantity, unit_price_minor, currency, sku_match_source, warehouse_id) VALUES
                  ('a7700000-0000-4000-8000-000000000401', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000301', 'a7700000-0000-4000-8000-000000000201', 'A-1-1', 'Product A1', 3, 100, 'CNY', 'PROVIDED', 'a7700000-0000-4000-8000-000000000101'),
                  ('a7700000-0000-4000-8000-000000000402', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000302', 'a7700000-0000-4000-8000-000000000201', 'A-2-1', 'Product A1', 2, 100, 'CNY', 'PROVIDED', 'a7700000-0000-4000-8000-000000000101'),
                  ('a7700000-0000-4000-8000-000000000403', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000303', 'a7700000-0000-4000-8000-000000000201', 'A-3-1', 'Product A1', 4, 100, 'CNY', 'PROVIDED', 'a7700000-0000-4000-8000-000000000101'),
                  ('a7700000-0000-4000-8000-000000000404', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000304', 'a7700000-0000-4000-8000-000000000201', 'A-4-1', 'Product A1', 5, 100, 'CNY', 'PROVIDED', 'a7700000-0000-4000-8000-000000000101'),
                  ('a7700000-0000-4000-8000-000000000405', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000305', 'a7700000-0000-4000-8000-000000000201', 'A-5-1', 'Product A1', 6, 100, 'CNY', 'PROVIDED', 'a7700000-0000-4000-8000-000000000101'),
                  ('a7700000-0000-4000-8000-000000000406', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000306', 'a7700000-0000-4000-8000-000000000201', 'A-6-1', 'Product A1', 7, 100, 'CNY', 'PROVIDED', 'a7700000-0000-4000-8000-000000000101'),
                  ('a7700000-0000-4000-8000-000000000407', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000307', 'a7700000-0000-4000-8000-000000000201', 'A-7-1', 'Product A1', 10, 100, 'CNY', 'PROVIDED', 'a7700000-0000-4000-8000-000000000101'),
                  ('a7700000-0000-4000-8000-000000000408', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000308', 'a7700000-0000-4000-8000-000000000202', 'A-8-1', 'Product A2', 1, 100, 'CNY', 'PROVIDED', 'a7700000-0000-4000-8000-000000000102'),
                  ('b7700000-0000-4000-8000-000000000401', 'b7700000-0000-4000-8000-000000000001', 'b7700000-0000-4000-8000-000000000301', 'b7700000-0000-4000-8000-000000000201', 'B-1-1', 'Product B1', 99, 100, 'CNY', 'PROVIDED', 'b7700000-0000-4000-8000-000000000101');
                """);
    }

    private static UUID uuid(String value) {
        return UUID.fromString(value);
    }
}
