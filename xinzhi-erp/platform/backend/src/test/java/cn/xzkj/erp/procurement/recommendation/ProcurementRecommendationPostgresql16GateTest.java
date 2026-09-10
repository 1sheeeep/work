package cn.xzkj.erp.procurement.recommendation;

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

class ProcurementRecommendationPostgresql16GateTest {
    private static final UUID TENANT_ID = uuid(
            "a1040000-0000-4000-8000-000000000001");
    private static final UUID SKU_ID = uuid(
            "a1040000-0000-4000-8000-000000000201");
    private static final UUID WAREHOUSE_ID = uuid(
            "a1040000-0000-4000-8000-000000000101");
    private static final UUID OTHER_WAREHOUSE_ID = uuid(
            "a1040000-0000-4000-8000-000000000102");
    private static PostgreSQLContainer<?> postgres;
    private static ProcurementRecommendationRepository repository;

    @BeforeAll
    static void migrateAndSeed() {
        postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                .withDatabaseName("erp_procurement_recommendation")
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
        repository = new ProcurementRecommendationRepository(jdbc);
        seed(jdbc);
    }

    @AfterAll
    static void stop() {
        if (postgres != null) postgres.stop();
    }

    @Test
    void calculatesLeadTimeDemandMinusAvailableAndOpenPurchases() {
        Instant asOf = Instant.parse("2026-08-11T12:00:00Z");
        ProcurementRecommendationResult result = repository.summarize(
                TENANT_ID, Set.of(), true, null, null,
                false, false, asOf, PageRequest.of(0, 25));

        assertThat(result.totalElements()).isEqualTo(1);
        assertThat(result.actionableCount()).isEqualTo(1);
        assertThat(result.totalRecommendedQuantity()).isEqualTo(10);
        assertThat(result.locations()).singleElement().satisfies(location -> {
            assertThat(location.warehouseId()).isEqualTo(WAREHOUSE_ID);
            assertThat(location.businessCode()).isEqualTo("RECEIVE");
        });
        assertThat(result.items()).singleElement().satisfies(item -> {
            assertThat(item.skuId()).isEqualTo(SKU_ID);
            assertThat(item.last28DaysSalesQuantity()).isEqualTo(28);
            assertThat(item.onHand()).isEqualTo(5);
            assertThat(item.available()).isEqualTo(5);
            assertThat(item.openPurchaseQuantity()).isEqualTo(6);
            assertThat(item.supplierLeadTimeDays()).isEqualTo(14);
            assertThat(item.targetCoverageDays()).isEqualTo(21);
            assertThat(item.targetStockQuantity()).isEqualTo(21);
            assertThat(item.recommendedQuantity()).isEqualTo(10);
        });
    }

    @Test
    void appliesSupplierKeywordWarehouseScopeAndExactIdentity() {
        Instant asOf = Instant.parse("2026-08-11T12:00:00Z");
        repository.lockSkus(TENANT_ID, Set.of(SKU_ID));
        assertThat(repository.summarize(
                TENANT_ID, Set.of(WAREHOUSE_ID), false,
                "supplier a", "sku_a", true, true,
                asOf, PageRequest.of(0, 25)).items()).hasSize(1);
        assertThat(repository.summarize(
                TENANT_ID, Set.of(OTHER_WAREHOUSE_ID), false,
                null, null, false, false,
                asOf, PageRequest.of(0, 25)).items()).isEmpty();
        assertThat(repository.find(
                TENANT_ID, Set.of(), true, SKU_ID, WAREHOUSE_ID, asOf))
                .get().extracting(ProcurementRecommendationItem::recommendedQuantity)
                .isEqualTo(10L);
    }

    private static void seed(NamedParameterJdbcTemplate jdbc) {
        jdbc.getJdbcTemplate().execute("""
                INSERT INTO tenants (id, code, name) VALUES
                  ('a1040000-0000-4000-8000-000000000001', 'smart-procurement', 'Smart Procurement');
                INSERT INTO users (id, tenant_id, username, display_name) VALUES
                  ('a1040000-0000-4000-8000-000000000002', 'a1040000-0000-4000-8000-000000000001', 'buyer', 'Buyer');
                INSERT INTO platform_catalog (id, code, display_name) VALUES
                  ('a1040000-0000-4000-8000-000000000010', 'SMART_PROC', 'Smart Procurement');
                INSERT INTO tenant_shops (id, tenant_id, platform_id, external_shop_ref, display_name) VALUES
                  ('a1040000-0000-4000-8000-000000000011', 'a1040000-0000-4000-8000-000000000001', 'a1040000-0000-4000-8000-000000000010', 'smart-shop', 'Smart Shop');
                INSERT INTO tenant_product_spus (id, tenant_id, business_code, name) VALUES
                  ('a1040000-0000-4000-8000-000000000200', 'a1040000-0000-4000-8000-000000000001', 'SPU_A', 'Product A');
                INSERT INTO tenant_product_skus (id, tenant_id, spu_id, business_code, name, variant_summary) VALUES
                  ('a1040000-0000-4000-8000-000000000201', 'a1040000-0000-4000-8000-000000000001', 'a1040000-0000-4000-8000-000000000200', 'SKU_A', 'Product A', 'Black');
                INSERT INTO tenant_warehouses (id, tenant_id, business_code, name) VALUES
                  ('a1040000-0000-4000-8000-000000000101', 'a1040000-0000-4000-8000-000000000001', 'WH_A', 'Warehouse A'),
                  ('a1040000-0000-4000-8000-000000000102', 'a1040000-0000-4000-8000-000000000001', 'WH_B', 'Warehouse B');
                INSERT INTO tenant_warehouse_locations (id, tenant_id, warehouse_id, business_code, name) VALUES
                  ('a1040000-0000-4000-8000-000000000103', 'a1040000-0000-4000-8000-000000000001', 'a1040000-0000-4000-8000-000000000101', 'RECEIVE', 'Receiving');
                INSERT INTO tenant_suppliers (id, tenant_id, business_code, name) VALUES
                  ('a1040000-0000-4000-8000-000000000301', 'a1040000-0000-4000-8000-000000000001', 'SUP_A', 'Supplier A');
                INSERT INTO tenant_supplier_sku_mappings
                  (id, tenant_id, supplier_id, sku_id, supplier_sku_code, preferred, lead_time_days)
                VALUES
                  ('a1040000-0000-4000-8000-000000000302', 'a1040000-0000-4000-8000-000000000001', 'a1040000-0000-4000-8000-000000000301', 'a1040000-0000-4000-8000-000000000201', 'SUP-SKU-A', true, 14);
                INSERT INTO inventory_balances (id, tenant_id, sku_id, warehouse_id, on_hand) VALUES
                  ('a1040000-0000-4000-8000-000000000401', 'a1040000-0000-4000-8000-000000000001', 'a1040000-0000-4000-8000-000000000201', 'a1040000-0000-4000-8000-000000000101', 5);
                INSERT INTO tenant_orders
                  (id, tenant_id, shop_id, external_order_ref, idempotency_key, request_fingerprint, currency, status, line_count, placed_at, warehouse_id)
                VALUES
                  ('a1040000-0000-4000-8000-000000000501', 'a1040000-0000-4000-8000-000000000001', 'a1040000-0000-4000-8000-000000000011', 'ORDER-A', 'smart-order-a', repeat('a', 64), 'CNY', 'SHIPPED', 1, '2026-08-05T10:00:00Z', 'a1040000-0000-4000-8000-000000000101');
                INSERT INTO tenant_order_lines
                  (id, tenant_id, order_id, sku_id, external_line_ref, title_snapshot, quantity, unit_price_minor, currency, sku_match_source, warehouse_id)
                VALUES
                  ('a1040000-0000-4000-8000-000000000502', 'a1040000-0000-4000-8000-000000000001', 'a1040000-0000-4000-8000-000000000501', 'a1040000-0000-4000-8000-000000000201', 'ORDER-A-1', 'Product A', 28, 100, 'CNY', 'PROVIDED', 'a1040000-0000-4000-8000-000000000101');
                """);

        UUID planId = uuid("a1040000-0000-4000-8000-000000000701");
        UUID orderId = uuid("a1040000-0000-4000-8000-000000000702");
        jdbc.update("""
                INSERT INTO procurement_plans (
                    id, tenant_id, plan_no, status, source,
                    sku_id, sku_code_snapshot, sku_name_snapshot,
                    warehouse_id, warehouse_code_snapshot,
                    warehouse_name_snapshot, location_id,
                    location_code_snapshot, location_name_snapshot,
                    quantity, applicant_display_name, applicant_user_id,
                    version
                ) VALUES (
                    :planId, :tenantId, :planNo, 'ORDERED', 'SMART',
                    :skuId, 'SKU_A', 'Product A', :warehouseId,
                    'WH_A', 'Warehouse A', :locationId,
                    'RECEIVE', 'Receiving', 6, 'Buyer', :userId, 1
                );
                INSERT INTO procurement_purchase_orders (
                    id, tenant_id, purchase_no, status, plan_id,
                    plan_no_snapshot, supplier_id, supplier_code_snapshot,
                    supplier_name_snapshot, supplier_sku_code_snapshot,
                    sku_id, sku_code_snapshot, sku_name_snapshot,
                    warehouse_id, warehouse_code_snapshot,
                    warehouse_name_snapshot, location_id,
                    location_code_snapshot, location_name_snapshot,
                    quantity, ordered_by_display_name, ordered_by_user_id
                ) VALUES (
                    :orderId, :tenantId, :purchaseNo, 'NEW_ORDER', :planId,
                    :planNo, :supplierId, 'SUP_A', 'Supplier A', 'SUP-SKU-A',
                    :skuId, 'SKU_A', 'Product A', :warehouseId,
                    'WH_A', 'Warehouse A', :locationId,
                    'RECEIVE', 'Receiving', 6, 'Buyer', :userId
                )
                """, new org.springframework.jdbc.core.namedparam.MapSqlParameterSource()
                .addValue("planId", planId)
                .addValue("orderId", orderId)
                .addValue("tenantId", TENANT_ID)
                .addValue("planNo", planNo(planId))
                .addValue("purchaseNo", purchaseNo(orderId))
                .addValue("skuId", SKU_ID)
                .addValue("warehouseId", WAREHOUSE_ID)
                .addValue("locationId", uuid("a1040000-0000-4000-8000-000000000103"))
                .addValue("supplierId", uuid("a1040000-0000-4000-8000-000000000301"))
                .addValue("userId", uuid("a1040000-0000-4000-8000-000000000002")));
    }

    private static String planNo(UUID id) {
        return "PP-20260811-" + id.toString().replace("-", "")
                .substring(0, 28).toUpperCase();
    }

    private static String purchaseNo(UUID id) {
        return "PO-20260811-" + id.toString().replace("-", "")
                .substring(0, 28).toUpperCase();
    }

    private static UUID uuid(String value) {
        return UUID.fromString(value);
    }
}
