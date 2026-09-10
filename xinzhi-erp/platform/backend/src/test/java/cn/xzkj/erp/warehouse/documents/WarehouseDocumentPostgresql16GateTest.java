package cn.xzkj.erp.warehouse.documents;

import static org.assertj.core.api.Assertions.assertThat;

import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.ApprovalStatus;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.Direction;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.SearchField;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.Source;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.Status;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class WarehouseDocumentPostgresql16GateTest {
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";
    private static String containerName;
    private static String jdbcUrl;
    private static WarehouseDocumentRepository repository;
    private static final UUID TENANT_ID = UUID.fromString(
            "a4800000-0000-4000-8000-000000000001");
    private static final UUID WAREHOUSE_A = UUID.fromString(
            "a4800000-0000-4000-8000-000000000003");
    private static final UUID ORDER_ID = UUID.fromString(
            "a4800000-0000-4000-8000-000000000011");
    private static final UUID POSTED_EVENT_ID = UUID.fromString(
            "a4800000-0000-4000-8000-000000000021");
    private static final UUID REVERSED_EVENT_ID = UUID.fromString(
            "a4800000-0000-4000-8000-000000000022");
    private static final UUID COUNT_A_ID = UUID.fromString(
            "a4800000-0000-4000-8000-000000000050");
    private static final UUID COUNT_B_ID = UUID.fromString(
            "a4800000-0000-4000-8000-000000000051");

    @BeforeAll
    static void migrate() throws Exception {
        startPostgresql16();
        Flyway migration = Flyway.configure()
                .dataSource(jdbcUrl, DB_USER, DB_PASSWORD)
                .locations("classpath:db/migration")
                .load();
        assertThat(migration.migrate().success).isTrue();
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                jdbcUrl, DB_USER, DB_PASSWORD);
        repository = new WarehouseDocumentRepository(
                new NamedParameterJdbcTemplate(dataSource));
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        seedOrderFulfillmentDocuments(jdbc);
        seedInventoryCountDocuments(jdbc);
    }

    @AfterAll
    static void stop() {
        if (containerName != null) runDocker("rm", "-f", containerName);
    }

    @Test
    void unifiedQueryIsValidAgainstTheCompletePostgresql16Schema() {
        var page = repository.list(
                UUID.randomUUID(), Set.of(), true, null,
                Direction.INBOUND, null, null, null,
                SearchField.DOCUMENT_NO, null, null, null,
                PageRequest.of(0, 25));

        assertThat(page).isEmpty();
        assertThat(page.getTotalElements()).isZero();
    }

    @Test
    void listsOnlyRealFulfillmentInventoryDeductionsAndMarksCorrections() {
        var page = repository.list(
                TENANT_ID, Set.of(), true, null,
                Direction.OUTBOUND, Source.ORDER_FULFILLMENT, null, null,
                SearchField.DOCUMENT_NO, null, null, null,
                PageRequest.of(0, 25));

        assertThat(page.getTotalElements()).isEqualTo(2);
        assertThat(page.getContent()).extracting(WarehouseDocumentView::id)
                .containsExactly(REVERSED_EVENT_ID, POSTED_EVENT_ID);
        assertThat(page.getContent()).allSatisfy(document -> {
            assertThat(document.relatedDocumentId()).isEqualTo(ORDER_ID);
            assertThat(document.source()).isEqualTo(Source.ORDER_FULFILLMENT);
            assertThat(document.direction()).isEqualTo(Direction.OUTBOUND);
            assertThat(document.documentNo()).isEqualTo("ORDER-100");
            assertThat(document.documentType()).isEqualTo("订单履约出库");
            assertThat(document.operatorDisplayName()).isEqualTo("仓库操作员");
        });
        assertThat(page.getContent()).anySatisfy(document -> {
            assertThat(document.id()).isEqualTo(POSTED_EVENT_ID);
            assertThat(document.status()).isEqualTo(Status.POSTED);
            assertThat(document.totalQuantity()).isEqualTo(3);
        });
        assertThat(page.getContent()).anySatisfy(document -> {
            assertThat(document.id()).isEqualTo(REVERSED_EVENT_ID);
            assertThat(document.status()).isEqualTo(Status.REVERSED);
            assertThat(document.totalQuantity()).isEqualTo(4);
        });
    }

    @Test
    void appliesWarehouseScopeAndFulfillmentSearchDimensions() {
        var scoped = repository.list(
                TENANT_ID, Set.of(WAREHOUSE_A), false, null,
                Direction.OUTBOUND, Source.ORDER_FULFILLMENT, null, null,
                SearchField.SKU, "sku-a", null, null,
                PageRequest.of(0, 25));
        var tracking = repository.list(
                TENANT_ID, Set.of(), true, null,
                Direction.OUTBOUND, Source.ORDER_FULFILLMENT, null, null,
                SearchField.NOTE, "track-b", null, null,
                PageRequest.of(0, 25));

        assertThat(scoped.getContent()).extracting(WarehouseDocumentView::id)
                .containsExactly(POSTED_EVENT_ID);
        assertThat(tracking.getContent()).extracting(WarehouseDocumentView::id)
                .containsExactly(REVERSED_EVENT_ID);
    }

    @Test
    void splitsCompletedCountsByDirectionAndPreservesPartialReversals() {
        var inbound = repository.list(
                TENANT_ID, Set.of(), true, null,
                Direction.INBOUND, Source.INVENTORY_COUNT, null, null,
                SearchField.DOCUMENT_NO, null, null, null,
                PageRequest.of(0, 25));
        var outbound = repository.list(
                TENANT_ID, Set.of(), true, null,
                Direction.OUTBOUND, Source.INVENTORY_COUNT, null, null,
                SearchField.DOCUMENT_NO, null, null, null,
                PageRequest.of(0, 25));

        assertThat(inbound.getContent()).singleElement().satisfies(document -> {
            assertThat(document.id()).isEqualTo(COUNT_A_ID);
            assertThat(document.relatedDocumentId()).isEqualTo(COUNT_A_ID);
            assertThat(document.documentNo()).isEqualTo("IC-20260802-A");
            assertThat(document.documentType()).isEqualTo("库存盘盈入库");
            assertThat(document.status()).isEqualTo(Status.PARTIALLY_REVERSED);
            assertThat(document.approvalStatus()).isEqualTo(ApprovalStatus.APPROVED);
            assertThat(document.lineCount()).isEqualTo(2);
            assertThat(document.totalQuantity()).isEqualTo(8);
            assertThat(document.operatorDisplayName()).isEqualTo("盘点审核人");
        });
        assertThat(outbound.getContent()).extracting(WarehouseDocumentView::id)
                .containsExactly(COUNT_B_ID, COUNT_A_ID);
        assertThat(outbound.getContent()).anySatisfy(document -> {
            assertThat(document.id()).isEqualTo(COUNT_A_ID);
            assertThat(document.documentType()).isEqualTo("库存盘亏出库");
            assertThat(document.status()).isEqualTo(Status.POSTED);
            assertThat(document.totalQuantity()).isEqualTo(2);
        });
        assertThat(outbound.getContent()).anySatisfy(document -> {
            assertThat(document.id()).isEqualTo(COUNT_B_ID);
            assertThat(document.status()).isEqualTo(Status.REVERSED);
            assertThat(document.totalQuantity()).isEqualTo(4);
        });
    }

    @Test
    void appliesWarehouseScopeAndSkuSearchToCountDocuments() {
        var scoped = repository.list(
                TENANT_ID, Set.of(WAREHOUSE_A), false, null,
                Direction.OUTBOUND, Source.INVENTORY_COUNT, null, null,
                SearchField.DOCUMENT_NO, null, null, null,
                PageRequest.of(0, 25));
        var sku = repository.list(
                TENANT_ID, Set.of(), true, null,
                Direction.INBOUND, Source.INVENTORY_COUNT, null, null,
                SearchField.SKU, "sku-b", null, null,
                PageRequest.of(0, 25));

        assertThat(scoped.getContent()).extracting(WarehouseDocumentView::id)
                .containsExactly(COUNT_A_ID);
        assertThat(sku.getContent()).extracting(WarehouseDocumentView::id)
                .containsExactly(COUNT_A_ID);
    }

    private static void seedOrderFulfillmentDocuments(JdbcTemplate jdbc) {
        jdbc.execute("""
                INSERT INTO tenants (id, code, name)
                VALUES ('a4800000-0000-4000-8000-000000000001', 'docs', '单据测试租户');
                INSERT INTO users (id, tenant_id, username, display_name)
                VALUES ('a4800000-0000-4000-8000-000000000002',
                        'a4800000-0000-4000-8000-000000000001',
                        'warehouse-operator', '仓库操作员');
                INSERT INTO platform_catalog (id, code, display_name)
                VALUES ('a4800000-0000-4000-8000-000000000005', 'TEST', '测试平台');
                INSERT INTO tenant_shops
                    (id, tenant_id, platform_id, external_shop_ref, display_name)
                VALUES ('a4800000-0000-4000-8000-000000000006',
                        'a4800000-0000-4000-8000-000000000001',
                        'a4800000-0000-4000-8000-000000000005', 'SHOP-1', '测试店铺');
                INSERT INTO tenant_warehouses (id, tenant_id, business_code, name)
                VALUES
                    ('a4800000-0000-4000-8000-000000000003',
                     'a4800000-0000-4000-8000-000000000001', 'WH-A', '杭州仓'),
                    ('a4800000-0000-4000-8000-000000000004',
                     'a4800000-0000-4000-8000-000000000001', 'WH-B', '宁波仓');
                INSERT INTO tenant_warehouse_locations
                    (id, tenant_id, warehouse_id, business_code, name)
                VALUES
                    ('a4800000-0000-4000-8000-000000000007',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000003', 'A-01', '杭州拣货位'),
                    ('a4800000-0000-4000-8000-000000000008',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000004', 'B-01', '宁波拣货位');
                INSERT INTO tenant_product_spus (id, tenant_id, business_code, name)
                VALUES ('a4800000-0000-4000-8000-000000000009',
                        'a4800000-0000-4000-8000-000000000001', 'SPU-A', '测试商品');
                INSERT INTO tenant_product_skus
                    (id, tenant_id, spu_id, business_code, name)
                VALUES ('a4800000-0000-4000-8000-000000000010',
                        'a4800000-0000-4000-8000-000000000001',
                        'a4800000-0000-4000-8000-000000000009', 'SKU-A', '测试 SKU');
                INSERT INTO tenant_orders
                    (id, tenant_id, shop_id, external_order_ref, idempotency_key,
                     request_fingerprint, currency, status, line_count, placed_at)
                VALUES ('a4800000-0000-4000-8000-000000000011',
                        'a4800000-0000-4000-8000-000000000001',
                        'a4800000-0000-4000-8000-000000000006', 'ORDER-100', 'order-100',
                        repeat('a', 64), 'CNY', 'SHIPPED', 2, '2026-08-02T01:00:00Z');
                INSERT INTO tenant_order_lines
                    (id, tenant_id, order_id, sku_id, external_line_ref, title_snapshot,
                     quantity, unit_price_minor, currency, sku_match_source,
                     warehouse_id, location_id)
                VALUES
                    ('a4800000-0000-4000-8000-000000000012',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000011',
                     'a4800000-0000-4000-8000-000000000010', 'LINE-A', '商品 A',
                     3, 100, 'CNY', 'PROVIDED',
                     'a4800000-0000-4000-8000-000000000003',
                     'a4800000-0000-4000-8000-000000000007'),
                    ('a4800000-0000-4000-8000-000000000013',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000011',
                     'a4800000-0000-4000-8000-000000000010', 'LINE-B', '商品 B',
                     4, 100, 'CNY', 'PROVIDED',
                     'a4800000-0000-4000-8000-000000000004',
                     'a4800000-0000-4000-8000-000000000008');
                INSERT INTO tenant_fulfillment_plans
                    (id, tenant_id, order_id, shop_id, source_order_version,
                     external_order_ref_snapshot, status, planned_quantity,
                     picked_quantity, packed_quantity, shipped_quantity,
                     creation_idempotency_key, request_fingerprint)
                VALUES ('a4800000-0000-4000-8000-000000000014',
                        'a4800000-0000-4000-8000-000000000001',
                        'a4800000-0000-4000-8000-000000000011',
                        'a4800000-0000-4000-8000-000000000006', 0, 'ORDER-100',
                        'SHIPPED', 7, 7, 7, 7, 'plan-order-100', repeat('b', 64));
                INSERT INTO tenant_fulfillment_lines
                    (id, tenant_id, plan_id, order_line_id, split_sequence, sku_id,
                     warehouse_id, location_id, planned_quantity, picked_quantity,
                     packed_quantity, shipped_quantity, external_line_ref_snapshot,
                     sku_business_code_snapshot, sku_name_snapshot)
                VALUES
                    ('a4800000-0000-4000-8000-000000000015',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000014',
                     'a4800000-0000-4000-8000-000000000012', 0,
                     'a4800000-0000-4000-8000-000000000010',
                     'a4800000-0000-4000-8000-000000000003',
                     'a4800000-0000-4000-8000-000000000007', 3, 3, 3, 3,
                     'LINE-A', 'SKU-A', '测试 SKU'),
                    ('a4800000-0000-4000-8000-000000000016',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000014',
                     'a4800000-0000-4000-8000-000000000013', 0,
                     'a4800000-0000-4000-8000-000000000010',
                     'a4800000-0000-4000-8000-000000000004',
                     'a4800000-0000-4000-8000-000000000008', 4, 4, 4, 4,
                     'LINE-B', 'SKU-A', '测试 SKU');
                INSERT INTO tenant_fulfillment_packages
                    (id, tenant_id, plan_id, warehouse_id, package_number,
                     status, weight_grams, handed_over_at)
                VALUES
                    ('a4800000-0000-4000-8000-000000000017',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000014',
                     'a4800000-0000-4000-8000-000000000003', 'PKG-A',
                     'HANDED_OVER', 100, '2026-08-02T02:00:00Z'),
                    ('a4800000-0000-4000-8000-000000000018',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000014',
                     'a4800000-0000-4000-8000-000000000004', 'PKG-B',
                     'HANDOVER_CORRECTED', 120, '2026-08-02T03:00:00Z'),
                    ('a4800000-0000-4000-8000-000000000019',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000014',
                     'a4800000-0000-4000-8000-000000000003', 'PKG-NO-STOCK',
                     'HANDED_OVER', 80, '2026-08-02T04:00:00Z');
                INSERT INTO tenant_shipment_events
                    (id, tenant_id, plan_id, package_id, event_type, occurred_at,
                     source_system, external_event_ref, actor_user_id, request_id,
                     carrier_code, service_code, tracking_reference)
                VALUES
                    ('a4800000-0000-4000-8000-000000000021',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000014',
                     'a4800000-0000-4000-8000-000000000017', 'HANDOVER_CONFIRMED',
                     '2026-08-02T02:00:00Z', 'ERP_LOCAL', 'handover-a',
                     'a4800000-0000-4000-8000-000000000002', 'request-a',
                     'SF', 'STANDARD', 'TRACK-A'),
                    ('a4800000-0000-4000-8000-000000000022',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000014',
                     'a4800000-0000-4000-8000-000000000018', 'HANDOVER_CONFIRMED',
                     '2026-08-02T03:00:00Z', 'ERP_LOCAL', 'handover-b',
                     'a4800000-0000-4000-8000-000000000002', 'request-b',
                     'YTO', 'STANDARD', 'TRACK-B'),
                    ('a4800000-0000-4000-8000-000000000023',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000014',
                     'a4800000-0000-4000-8000-000000000019', 'HANDOVER_CONFIRMED',
                     '2026-08-02T04:00:00Z', 'ERP_LOCAL', 'handover-no-stock',
                     'a4800000-0000-4000-8000-000000000002', 'request-c',
                     'SF', 'STANDARD', 'TRACK-NO-STOCK');
                INSERT INTO tenant_shipment_events
                    (id, tenant_id, plan_id, package_id, event_type, occurred_at,
                     source_system, external_event_ref, actor_user_id, request_id,
                     reverses_event_id, correction_reason_code)
                VALUES ('a4800000-0000-4000-8000-000000000024',
                        'a4800000-0000-4000-8000-000000000001',
                        'a4800000-0000-4000-8000-000000000014',
                        'a4800000-0000-4000-8000-000000000018',
                        'HANDOVER_CORRECTION_RECORDED', '2026-08-02T03:30:00Z',
                        'ERP_LOCAL', 'correction-b',
                        'a4800000-0000-4000-8000-000000000002', 'request-d',
                        'a4800000-0000-4000-8000-000000000022', 'LABEL_ERROR');
                INSERT INTO inventory_ledger_events
                    (id, tenant_id, event_type, sku_id, warehouse_id, signed_delta,
                     balance_after, balance_version_after, reason, actor_user_id, request_id)
                VALUES
                    ('a4800000-0000-4000-8000-000000000025',
                     'a4800000-0000-4000-8000-000000000001', 'FULFILLMENT_SHIPMENT',
                     'a4800000-0000-4000-8000-000000000010',
                     'a4800000-0000-4000-8000-000000000003', -3, 7, 1,
                     'FULFILLMENT_SHIPMENT',
                     'a4800000-0000-4000-8000-000000000002', 'request-a'),
                    ('a4800000-0000-4000-8000-000000000026',
                     'a4800000-0000-4000-8000-000000000001', 'FULFILLMENT_SHIPMENT',
                     'a4800000-0000-4000-8000-000000000010',
                     'a4800000-0000-4000-8000-000000000004', -4, 6, 1,
                     'FULFILLMENT_SHIPMENT',
                     'a4800000-0000-4000-8000-000000000002', 'request-b');
                INSERT INTO tenant_shipment_inventory_events
                    (tenant_id, shipment_event_id, fulfillment_line_id,
                     inventory_event_id, quantity)
                VALUES
                    ('a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000021',
                     'a4800000-0000-4000-8000-000000000015',
                     'a4800000-0000-4000-8000-000000000025', 3),
                    ('a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000022',
                     'a4800000-0000-4000-8000-000000000016',
                     'a4800000-0000-4000-8000-000000000026', 4);
                """);
    }

    private static void seedInventoryCountDocuments(JdbcTemplate jdbc) {
        jdbc.execute("""
                INSERT INTO tenant_product_skus
                    (id, tenant_id, spu_id, business_code, name)
                VALUES
                    ('a4800000-0000-4000-8000-000000000030',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000009', 'SKU-B', '测试 SKU B'),
                    ('a4800000-0000-4000-8000-000000000031',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000009', 'SKU-C', '测试 SKU C');
                INSERT INTO inventory_balances
                    (id, tenant_id, sku_id, warehouse_id)
                VALUES
                    ('a4800000-0000-4000-8000-000000000070',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000010',
                     'a4800000-0000-4000-8000-000000000003'),
                    ('a4800000-0000-4000-8000-000000000071',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000030',
                     'a4800000-0000-4000-8000-000000000003'),
                    ('a4800000-0000-4000-8000-000000000072',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000031',
                     'a4800000-0000-4000-8000-000000000003'),
                    ('a4800000-0000-4000-8000-000000000073',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000010',
                     'a4800000-0000-4000-8000-000000000004');
                INSERT INTO inventory_ledger_events
                    (id, tenant_id, event_type, sku_id, warehouse_id, signed_delta,
                     balance_after, balance_version_after, reason, actor_user_id,
                     request_id, recorded_at)
                VALUES
                    ('a4800000-0000-4000-8000-000000000040',
                     'a4800000-0000-4000-8000-000000000001', 'CORRECTION',
                     'a4800000-0000-4000-8000-000000000010',
                     'a4800000-0000-4000-8000-000000000003', 5, 15, 1,
                     'INVENTORY_COUNT',
                     'a4800000-0000-4000-8000-000000000002', 'count-a-1',
                     '2026-08-02T05:00:00Z'),
                    ('a4800000-0000-4000-8000-000000000041',
                     'a4800000-0000-4000-8000-000000000001', 'CORRECTION',
                     'a4800000-0000-4000-8000-000000000030',
                     'a4800000-0000-4000-8000-000000000003', 3, 23, 1,
                     'INVENTORY_COUNT',
                     'a4800000-0000-4000-8000-000000000002', 'count-a-2',
                     '2026-08-02T05:00:00Z'),
                    ('a4800000-0000-4000-8000-000000000042',
                     'a4800000-0000-4000-8000-000000000001', 'CORRECTION',
                     'a4800000-0000-4000-8000-000000000031',
                     'a4800000-0000-4000-8000-000000000003', -2, 8, 1,
                     'INVENTORY_COUNT',
                     'a4800000-0000-4000-8000-000000000002', 'count-a-3',
                     '2026-08-02T05:00:00Z'),
                    ('a4800000-0000-4000-8000-000000000043',
                     'a4800000-0000-4000-8000-000000000001', 'CORRECTION',
                     'a4800000-0000-4000-8000-000000000010',
                     'a4800000-0000-4000-8000-000000000004', -4, 6, 1,
                     'INVENTORY_COUNT',
                     'a4800000-0000-4000-8000-000000000002', 'count-b-1',
                     '2026-08-02T06:00:00Z');
                INSERT INTO inventory_ledger_events
                    (id, tenant_id, event_type, sku_id, warehouse_id, signed_delta,
                     balance_after, balance_version_after, reason,
                     reversal_of_event_id, actor_user_id, request_id, recorded_at)
                VALUES
                    ('a4800000-0000-4000-8000-000000000044',
                     'a4800000-0000-4000-8000-000000000001', 'REVERSAL',
                     'a4800000-0000-4000-8000-000000000030',
                     'a4800000-0000-4000-8000-000000000003', -3, 20, 2,
                     'INVENTORY_COUNT_REVERSAL',
                     'a4800000-0000-4000-8000-000000000041',
                     'a4800000-0000-4000-8000-000000000002', 'count-a-reversal',
                     '2026-08-02T05:30:00Z'),
                    ('a4800000-0000-4000-8000-000000000045',
                     'a4800000-0000-4000-8000-000000000001', 'REVERSAL',
                     'a4800000-0000-4000-8000-000000000010',
                     'a4800000-0000-4000-8000-000000000004', 4, 10, 2,
                     'INVENTORY_COUNT_REVERSAL',
                     'a4800000-0000-4000-8000-000000000043',
                     'a4800000-0000-4000-8000-000000000002', 'count-b-reversal',
                     '2026-08-02T06:30:00Z');
                INSERT INTO inventory_count_batches
                    (id, tenant_id, count_no, warehouse_id, status, count_date,
                     note, operator_display_name, approver_display_name,
                     created_by_user_id, reviewed_by_user_id, reviewed_at)
                VALUES
                    ('a4800000-0000-4000-8000-000000000050',
                     'a4800000-0000-4000-8000-000000000001', 'IC-20260802-A',
                     'a4800000-0000-4000-8000-000000000003', 'COMPLETED',
                     '2026-08-02', '月度盘点', '盘点操作人', '盘点审核人',
                     'a4800000-0000-4000-8000-000000000002',
                     'a4800000-0000-4000-8000-000000000002',
                     '2026-08-02T05:00:00Z'),
                    ('a4800000-0000-4000-8000-000000000051',
                     'a4800000-0000-4000-8000-000000000001', 'IC-20260802-B',
                     'a4800000-0000-4000-8000-000000000004', 'COMPLETED',
                     '2026-08-02', '复核盘点', '盘点操作人', '盘点审核人',
                     'a4800000-0000-4000-8000-000000000002',
                     'a4800000-0000-4000-8000-000000000002',
                     '2026-08-02T06:00:00Z'),
                    ('a4800000-0000-4000-8000-000000000052',
                     'a4800000-0000-4000-8000-000000000001', 'IC-NO-STOCK',
                     'a4800000-0000-4000-8000-000000000003', 'COMPLETED',
                     '2026-08-02', NULL, '盘点操作人', '盘点审核人',
                     'a4800000-0000-4000-8000-000000000002',
                     'a4800000-0000-4000-8000-000000000002',
                     '2026-08-02T07:00:00Z');
                INSERT INTO inventory_count_lines
                    (id, tenant_id, count_id, balance_id, sku_id, warehouse_id,
                     expected_balance_version, snapshot_on_hand, snapshot_reserved,
                     counted_on_hand, difference, result_event_id)
                VALUES
                    ('a4800000-0000-4000-8000-000000000060',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000050',
                     'a4800000-0000-4000-8000-000000000070',
                     'a4800000-0000-4000-8000-000000000010',
                     'a4800000-0000-4000-8000-000000000003', 0, 10, 0, 15, 5,
                     'a4800000-0000-4000-8000-000000000040'),
                    ('a4800000-0000-4000-8000-000000000061',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000050',
                     'a4800000-0000-4000-8000-000000000071',
                     'a4800000-0000-4000-8000-000000000030',
                     'a4800000-0000-4000-8000-000000000003', 0, 20, 0, 23, 3,
                     'a4800000-0000-4000-8000-000000000041'),
                    ('a4800000-0000-4000-8000-000000000062',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000050',
                     'a4800000-0000-4000-8000-000000000072',
                     'a4800000-0000-4000-8000-000000000031',
                     'a4800000-0000-4000-8000-000000000003', 0, 10, 0, 8, -2,
                     'a4800000-0000-4000-8000-000000000042'),
                    ('a4800000-0000-4000-8000-000000000063',
                     'a4800000-0000-4000-8000-000000000001',
                     'a4800000-0000-4000-8000-000000000051',
                     'a4800000-0000-4000-8000-000000000073',
                     'a4800000-0000-4000-8000-000000000010',
                     'a4800000-0000-4000-8000-000000000004', 0, 10, 0, 6, -4,
                     'a4800000-0000-4000-8000-000000000043');
                """);
    }

    private static void startPostgresql16() throws Exception {
        containerName = "erp-warehouse-documents-"
                + UUID.randomUUID().toString().replace("-", "");
        String id = runDocker(
                "run", "--rm", "-d", "--name", containerName,
                "-e", "POSTGRES_DB=erp_documents",
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
                + binding.substring(separator + 1) + "/erp_documents";
        long deadline = System.nanoTime() + Duration.ofSeconds(30).toNanos();
        while (System.nanoTime() < deadline) {
            try (Connection connection = DriverManager.getConnection(
                    jdbcUrl, DB_USER, DB_PASSWORD)) {
                connection.isValid(1);
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
            throw new IllegalStateException("Docker command was interrupted", exception);
        }
    }
}
