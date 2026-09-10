package cn.xzkj.erp.analytics.productboard;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

class ProductSalesBoardPostgresql16GateTest {
    private static final UUID TENANT_A = uuid("a7700000-0000-4000-8000-000000000001");
    private static final UUID TENANT_B = uuid("b7700000-0000-4000-8000-000000000001");
    private static final UUID WAREHOUSE_A = uuid("a7700000-0000-4000-8000-000000000101");
    private static final UUID SKU_HOT = uuid("a7700000-0000-4000-8000-000000000201");
    private static final UUID SKU_LOW = uuid("a7700000-0000-4000-8000-000000000202");
    private static final UUID SKU_ZERO = uuid("a7700000-0000-4000-8000-000000000203");
    private static final Instant RANGE_FROM =
            Instant.parse("2026-08-01T00:00:00Z");
    private static final Instant OBSERVED_AT =
            Instant.parse("2026-08-08T00:00:00Z");
    private static PostgreSQLContainer<?> postgres;
    private static ProductSalesBoardRepository repository;

    @BeforeAll
    static void migrateAndSeed() {
        postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                .withDatabaseName("erp_product_sales_board")
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
        repository = new ProductSalesBoardRepository(jdbc);
        seed(jdbc);
    }

    @AfterAll
    static void stop() {
        if (postgres != null) postgres.stop();
    }

    @Test
    void ranksSoldAndZeroSalesSkusWithTenantAndWarehouseScope() {
        var all = repository.summarize(
                TENANT_A, Set.of(), true, RANGE_FROM, OBSERVED_AT, 5);
        var warehouseA = repository.summarize(
                TENANT_A, Set.of(WAREHOUSE_A), false,
                RANGE_FROM, OBSERVED_AT, 5);
        var tenantB = repository.summarize(
                TENANT_B, Set.of(), true, RANGE_FROM, OBSERVED_AT, 5);

        assertThat(all.activeSkuCount()).isEqualTo(3);
        assertThat(all.soldSkuCount()).isEqualTo(2);
        assertThat(all.salesQuantity()).isEqualTo(6);
        assertThat(all.hotItems()).extracting(ProductSalesBoardItem::skuId)
                .containsExactly(SKU_HOT, SKU_LOW);
        assertThat(all.lowItems()).extracting(ProductSalesBoardItem::skuId)
                .containsExactly(SKU_ZERO, SKU_LOW, SKU_HOT);
        assertThat(all.lowItems().getFirst().lastPlacedAt()).isNull();

        assertThat(warehouseA.activeSkuCount()).isEqualTo(2);
        assertThat(warehouseA.soldSkuCount()).isEqualTo(1);
        assertThat(warehouseA.salesQuantity()).isEqualTo(5);
        assertThat(warehouseA.hotItems()).extracting(ProductSalesBoardItem::skuId)
                .containsExactly(SKU_HOT);
        assertThat(warehouseA.lowItems()).extracting(ProductSalesBoardItem::skuId)
                .containsExactly(SKU_ZERO, SKU_HOT);

        assertThat(tenantB.activeSkuCount()).isEqualTo(1);
        assertThat(tenantB.salesQuantity()).isEqualTo(4);
        assertThat(tenantB.hotItems()).noneMatch(item ->
                item.skuId().equals(SKU_HOT));
    }

    private static void seed(NamedParameterJdbcTemplate jdbc) {
        jdbc.getJdbcTemplate().execute("""
                INSERT INTO tenants (id, code, name) VALUES
                  ('a7700000-0000-4000-8000-000000000001', 'board-a', 'Board A'),
                  ('b7700000-0000-4000-8000-000000000001', 'board-b', 'Board B');
                INSERT INTO platform_catalog (id, code, display_name) VALUES
                  ('c7700000-0000-4000-8000-000000000001', 'BOARD_DEMO', 'Board Demo');
                INSERT INTO tenant_shops (id, tenant_id, platform_id, external_shop_ref, display_name) VALUES
                  ('a7700000-0000-4000-8000-000000000010', 'a7700000-0000-4000-8000-000000000001', 'c7700000-0000-4000-8000-000000000001', 'board-a', 'Shop A'),
                  ('b7700000-0000-4000-8000-000000000010', 'b7700000-0000-4000-8000-000000000001', 'c7700000-0000-4000-8000-000000000001', 'board-b', 'Shop B');
                INSERT INTO tenant_warehouses (id, tenant_id, business_code, name) VALUES
                  ('a7700000-0000-4000-8000-000000000101', 'a7700000-0000-4000-8000-000000000001', 'BOARD_A', 'Warehouse A'),
                  ('a7700000-0000-4000-8000-000000000102', 'a7700000-0000-4000-8000-000000000001', 'BOARD_B', 'Warehouse B');
                INSERT INTO tenant_product_spus (id, tenant_id, business_code, name) VALUES
                  ('a7700000-0000-4000-8000-000000000190', 'a7700000-0000-4000-8000-000000000001', 'BOARD_SPU_A', 'Product A'),
                  ('b7700000-0000-4000-8000-000000000190', 'b7700000-0000-4000-8000-000000000001', 'BOARD_SPU_B', 'Product B');
                INSERT INTO tenant_product_skus (id, tenant_id, spu_id, business_code, name, variant_summary, status) VALUES
                  ('a7700000-0000-4000-8000-000000000201', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000190', 'BOARD_HOT', 'Hot product', 'Black', 'ACTIVE'),
                  ('a7700000-0000-4000-8000-000000000202', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000190', 'BOARD_LOW', 'Low product', NULL, 'ACTIVE'),
                  ('a7700000-0000-4000-8000-000000000203', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000190', 'BOARD_ZERO', 'Zero product', NULL, 'ACTIVE'),
                  ('a7700000-0000-4000-8000-000000000204', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000190', 'BOARD_OFF', 'Inactive product', NULL, 'INACTIVE'),
                  ('b7700000-0000-4000-8000-000000000201', 'b7700000-0000-4000-8000-000000000001', 'b7700000-0000-4000-8000-000000000190', 'BOARD_OTHER', 'Other tenant', NULL, 'ACTIVE');
                INSERT INTO inventory_balances (tenant_id, sku_id, warehouse_id) VALUES
                  ('a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000203', 'a7700000-0000-4000-8000-000000000101');
                INSERT INTO tenant_orders (id, tenant_id, shop_id, external_order_ref, idempotency_key, request_fingerprint, currency, status, line_count, placed_at, warehouse_id) VALUES
                  ('a7700000-0000-4000-8000-000000000301', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000010', 'HOT', 'board-hot', repeat('a', 64), 'CNY', 'SHIPPED', 1, '2026-08-07T01:00:00Z', 'a7700000-0000-4000-8000-000000000101'),
                  ('a7700000-0000-4000-8000-000000000302', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000010', 'LOW', 'board-low', repeat('b', 64), 'CNY', 'SHIPPED', 1, '2026-08-06T01:00:00Z', 'a7700000-0000-4000-8000-000000000102'),
                  ('a7700000-0000-4000-8000-000000000303', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000010', 'CANCELLED', 'board-cancelled', repeat('c', 64), 'CNY', 'CANCELLED', 1, '2026-08-07T02:00:00Z', 'a7700000-0000-4000-8000-000000000101'),
                  ('a7700000-0000-4000-8000-000000000304', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000010', 'OLD', 'board-old', repeat('d', 64), 'CNY', 'SHIPPED', 1, '2026-07-31T23:59:59Z', 'a7700000-0000-4000-8000-000000000101'),
                  ('b7700000-0000-4000-8000-000000000301', 'b7700000-0000-4000-8000-000000000001', 'b7700000-0000-4000-8000-000000000010', 'OTHER', 'board-other', repeat('e', 64), 'CNY', 'RECEIVED', 1, '2026-08-07T01:00:00Z', NULL);
                INSERT INTO tenant_order_lines (id, tenant_id, order_id, sku_id, external_line_ref, title_snapshot, quantity, unit_price_minor, currency, sku_match_source) VALUES
                  ('a7700000-0000-4000-8000-000000000401', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000301', 'a7700000-0000-4000-8000-000000000201', 'HOT-1', 'Hot product', 5, 100, 'CNY', 'PROVIDED'),
                  ('a7700000-0000-4000-8000-000000000402', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000302', 'a7700000-0000-4000-8000-000000000202', 'LOW-1', 'Low product', 1, 100, 'CNY', 'PROVIDED'),
                  ('a7700000-0000-4000-8000-000000000403', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000303', 'a7700000-0000-4000-8000-000000000201', 'CANCELLED-1', 'Hot product', 10, 100, 'CNY', 'PROVIDED'),
                  ('a7700000-0000-4000-8000-000000000404', 'a7700000-0000-4000-8000-000000000001', 'a7700000-0000-4000-8000-000000000304', 'a7700000-0000-4000-8000-000000000201', 'OLD-1', 'Hot product', 20, 100, 'CNY', 'PROVIDED'),
                  ('b7700000-0000-4000-8000-000000000401', 'b7700000-0000-4000-8000-000000000001', 'b7700000-0000-4000-8000-000000000301', 'b7700000-0000-4000-8000-000000000201', 'OTHER-1', 'Other tenant', 4, 100, 'CNY', 'PROVIDED');
                """);
    }

    private static UUID uuid(String value) {
        return UUID.fromString(value);
    }
}
