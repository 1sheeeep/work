package cn.xzkj.erp.procurement.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import cn.xzkj.erp.procurement.domain.ProcurementPlanSearchField;
import cn.xzkj.erp.procurement.domain.ProcurementPlanStatus;
import cn.xzkj.erp.procurement.domain.ProcurementReceiptSort;
import cn.xzkj.erp.procurement.service.ProcurementPurchaseOrderView;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;

class ProcurementPlanPostgresql16GateTest {
    private static final UUID TENANT_A = uuid("a6900000-0000-4000-8000-000000000001");
    private static final UUID TENANT_B = uuid("a6900000-0000-4000-8000-000000000002");
    private static final UUID USER_A = uuid("a6900000-0000-4000-8000-000000000003");
    private static final UUID SPU_A = uuid("a6900000-0000-4000-8000-000000000010");
    private static final UUID SKU_A = uuid("a6900000-0000-4000-8000-000000000011");
    private static final UUID WAREHOUSE_A = uuid("a6900000-0000-4000-8000-000000000020");
    private static final UUID LOCATION_A = uuid("a6900000-0000-4000-8000-000000000021");
    private static final UUID WAREHOUSE_B = uuid("a6900000-0000-4000-8000-000000000022");
    private static final UUID LOCATION_B = uuid("a6900000-0000-4000-8000-000000000023");
    private static final UUID SUPPLIER_A = uuid("a6900000-0000-4000-8000-000000000030");

    private static PostgreSQLContainer<?> postgres;
    private static NamedParameterJdbcTemplate jdbc;
    private static TransactionTemplate transaction;
    private static ProcurementPlanRepository repository;
    private static ProcurementPurchaseOrderRepository purchaseOrderRepository;

    @BeforeAll
    static void migrateV1ThroughV68ThenV69AndLatest() {
        postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                .withDatabaseName("erp_procurement_gate")
                .withUsername("erp")
                .withPassword("erp");
        postgres.start();
        Flyway before = Flyway.configure()
                .dataSource(postgres.getJdbcUrl(), "erp", "erp")
                .locations("classpath:db/migration")
                .target("68")
                .load();
        assertThat(before.migrate().success).isTrue();
        assertThat(before.info().current().getVersion().getVersion()).isEqualTo("68");

        Flyway current = Flyway.configure()
                .dataSource(postgres.getJdbcUrl(), "erp", "erp")
                .locations("classpath:db/migration")
                .target("69")
                .load();
        assertThat(current.migrate().success).isTrue();
        assertThat(current.info().current().getVersion().getVersion()).isEqualTo("69");

        Flyway latest = Flyway.configure()
                .dataSource(postgres.getJdbcUrl(), "erp", "erp")
                .locations("classpath:db/migration")
                .load();
        assertThat(latest.migrate().success).isTrue();
        assertThat(latest.info().current().getVersion().getVersion()).isEqualTo("123");
        assertThat(latest.info().pending()).isEmpty();

        var dataSource = new DriverManagerDataSource(
                postgres.getJdbcUrl(), "erp", "erp");
        jdbc = new NamedParameterJdbcTemplate(dataSource);
        transaction = new TransactionTemplate(
                new DataSourceTransactionManager(dataSource));
        repository = new ProcurementPlanRepository(jdbc);
        purchaseOrderRepository = new ProcurementPurchaseOrderRepository(jdbc);
        seedFacts();
    }

    @AfterAll
    static void stopPostgresql() {
        if (postgres != null) postgres.stop();
    }

    @Test
    void migrationCreatesTenantSafeManualPlanAndPermissionContract() {
        assertThat(integer("""
                SELECT count(*) FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name IN ('procurement_plans', 'procurement_plan_commands')
                """)).isEqualTo(2);
        assertThat(integer("""
                SELECT count(*) FROM pg_indexes
                WHERE schemaname = 'public'
                  AND tablename = 'procurement_plans'
                  AND indexname IN (
                    'idx_procurement_plans_status_created',
                    'idx_procurement_plans_warehouse_created',
                    'idx_procurement_plans_location_created',
                    'idx_procurement_plans_sku_created')
                """)).isEqualTo(4);
        assertThat(string("""
                SELECT description FROM permissions
                WHERE code = 'procurement.read'
                """)).contains("采购计划", "采购单");
        assertThat(integer("""
                SELECT count(*) FROM permissions
                WHERE code = 'procurement.write'
                """)).isEqualTo(1);
    }

    @Test
    void repositoryLocksActiveSameTenantFactsAndPersistsSnapshots() {
        var facts = transaction.execute(status -> repository.findCreateFacts(
                TENANT_A, SKU_A, WAREHOUSE_A, LOCATION_A).orElseThrow());
        assertThat(facts).isNotNull();
        assertThat(facts.skuVariant()).isEqualTo("Black");
        var wrongLocationFacts = transaction.execute(status -> repository.findCreateFacts(
                TENANT_A, SKU_A, WAREHOUSE_A, LOCATION_B));
        assertThat(wrongLocationFacts).isNotNull();
        assertThat(wrongLocationFacts).isEmpty();

        UUID planId = UUID.randomUUID();
        transaction.executeWithoutResult(status -> repository.insert(
                planId, TENANT_A, planNo(planId), facts, 12, "restock",
                "Operator", USER_A, null));
        var plan = repository.find(TENANT_A, planId).orElseThrow();
        assertThat(plan.status()).isEqualTo(ProcurementPlanStatus.UNPURCHASED);
        assertThat(plan.locationId()).isEqualTo(LOCATION_A);
        assertThat(plan.version()).isZero();

        assertThatThrownBy(() -> jdbc.update(
                "UPDATE procurement_plans SET tenant_id = :tenantB"
                        + " WHERE tenant_id = :tenantA AND id = :planId",
                Map.of("tenantB", TENANT_B, "tenantA", TENANT_A, "planId", planId)))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(error -> assertThat(sqlState(error)).isEqualTo("23503"));
        assertThatThrownBy(() -> jdbc.update(
                "UPDATE procurement_plans SET quantity = 0"
                        + " WHERE tenant_id = :tenantId AND id = :planId",
                Map.of("tenantId", TENANT_A, "planId", planId)))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(error -> assertThat(sqlState(error)).isEqualTo("23514"));
        assertThatThrownBy(() -> jdbc.update(
                "UPDATE procurement_plans SET applicant_user_id = NULL"
                        + " WHERE tenant_id = :tenantId AND id = :planId",
                Map.of("tenantId", TENANT_A, "planId", planId)))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(error -> assertThat(sqlState(error)).isEqualTo("23514"));
        assertThatThrownBy(() -> jdbc.update(
                "UPDATE procurement_plans SET status = 'VOIDED'"
                        + " WHERE tenant_id = :tenantId AND id = :planId",
                Map.of("tenantId", TENANT_A, "planId", planId)))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(error -> assertThat(sqlState(error)).isEqualTo("23514"));

        UUID duplicateId = UUID.randomUUID();
        assertThatThrownBy(() -> transaction.executeWithoutResult(status ->
                repository.insert(
                        duplicateId, TENANT_A, plan.planNo(), facts, 2, null,
                        "Operator", USER_A, null)))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(error -> assertThat(sqlState(error)).isEqualTo("23505"));
    }

    @Test
    void latestMigrationCreatesOneOrderPerPlanWithSupplierAndWarehouseSnapshots() {
        assertThat(integer("""
                SELECT count(*) FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name IN (
                    'procurement_purchase_orders',
                    'procurement_purchase_order_commands')
                """)).isEqualTo(2);
        UUID planId = insertPlan();
        UUID purchaseOrderId = UUID.randomUUID();
        UUID commandId = UUID.randomUUID();
        transaction.executeWithoutResult(status -> {
            var plan = repository.lock(TENANT_A, planId).orElseThrow();
            var facts = purchaseOrderRepository.findCreateFacts(
                    TENANT_A, planId, SUPPLIER_A).orElseThrow();
            purchaseOrderRepository.insert(
                    purchaseOrderId, TENANT_A, purchaseNo(purchaseOrderId), planId,
                    facts, "urgent", "Operator", USER_A, null);
            assertThat(repository.markOrdered(
                    TENANT_A, planId, plan.version())).isEqualTo(1);
            purchaseOrderRepository.insertCommand(
                    TENANT_A, commandId, purchaseOrderId, "c".repeat(64));
        });

        var order = purchaseOrderRepository.find(TENANT_A, purchaseOrderId).orElseThrow();
        assertThat(order.planId()).isEqualTo(planId);
        assertThat(order.supplierId()).isEqualTo(SUPPLIER_A);
        assertThat(order.supplierName()).isEqualTo("Supplier A");
        assertThat(order.supplierSkuCode()).isEqualTo("SUP-PROC-SKU");
        assertThat(order.warehouseId()).isEqualTo(WAREHOUSE_A);
        assertThat(order.status()).isEqualTo(
                cn.xzkj.erp.procurement.domain.ProcurementPurchaseOrderStatus.NEW_ORDER);
        assertThat(order.reviewDecision()).isNull();
        assertThat(repository.find(TENANT_A, planId).orElseThrow().status())
                .isEqualTo(ProcurementPlanStatus.ORDERED);
        assertThat(purchaseOrderRepository.findCommand(TENANT_A, commandId))
                .get().extracting("purchaseOrderId").isEqualTo(purchaseOrderId);
        assertThat(purchaseOrderRepository.list(
                TENANT_A, java.util.Set.of(), true, null, null, null, true,
                cn.xzkj.erp.procurement.domain.ProcurementPurchaseOrderSearchField.PURCHASE_NO,
                purchaseNo(purchaseOrderId).toLowerCase(), null, null,
                PageRequest.of(0, 25))).isEmpty();
        assertThat(purchaseOrderRepository.review(
                TENANT_A, purchaseOrderId, 0, true, "approved",
                "Reviewer", USER_A, null)).isEqualTo(1);
        var approved = purchaseOrderRepository.find(
                TENANT_A, purchaseOrderId).orElseThrow();
        assertThat(approved.status()).isEqualTo(
                cn.xzkj.erp.procurement.domain.ProcurementPurchaseOrderStatus.APPROVED);
        assertThat(approved.reviewDecision()).isEqualTo("APPROVED");
        assertThat(approved.reviewedByDisplayName()).isEqualTo("Reviewer");
        assertThat(approved.reviewedAt()).isNotNull();
        assertThat(purchaseOrderRepository.list(
                TENANT_A, java.util.Set.of(), true, null, null, null, true,
                cn.xzkj.erp.procurement.domain.ProcurementPurchaseOrderSearchField.PURCHASE_NO,
                purchaseNo(purchaseOrderId).toLowerCase(), null, null,
                PageRequest.of(0, 25)).getContent())
                .extracting(ProcurementPurchaseOrderView::id)
                .containsExactly(purchaseOrderId);
        jdbc.update(
                "UPDATE procurement_purchase_orders"
                        + " SET status = 'RECEIVED', received_quantity = quantity,"
                        + " last_received_at = CURRENT_TIMESTAMP"
                        + " WHERE tenant_id = :tenantId AND id = :id",
                Map.of("tenantId", TENANT_A, "id", purchaseOrderId));
        assertThat(purchaseOrderRepository.list(
                TENANT_A, java.util.Set.of(), true, null, null, null, true,
                cn.xzkj.erp.procurement.domain.ProcurementPurchaseOrderSearchField.PURCHASE_NO,
                purchaseNo(purchaseOrderId).toLowerCase(), null, null,
                PageRequest.of(0, 25))).isEmpty();
    }

    @Test
    void latestMigrationCreatesDirectOrderWithoutAPlan() {
        long planCount = integer("SELECT count(*) FROM procurement_plans");
        UUID purchaseOrderId = UUID.randomUUID();
        transaction.executeWithoutResult(status -> {
            var facts = purchaseOrderRepository.findDirectCreateFacts(
                    TENANT_A, SKU_A, WAREHOUSE_A, LOCATION_A, SUPPLIER_A, 9)
                    .orElseThrow();
            purchaseOrderRepository.insert(
                    purchaseOrderId, TENANT_A, purchaseNo(purchaseOrderId), null,
                    facts, "direct restock", "Operator", USER_A, null);
        });

        var order = purchaseOrderRepository.find(TENANT_A, purchaseOrderId)
                .orElseThrow();
        assertThat(order.planId()).isNull();
        assertThat(order.planNo()).isNull();
        assertThat(order.quantity()).isEqualTo(9);
        assertThat(order.supplierId()).isEqualTo(SUPPLIER_A);
        assertThat(integer("SELECT count(*) FROM procurement_plans"))
                .isEqualTo(planCount);
        assertThat(purchaseOrderRepository.listSupplierOptionsForSku(
                TENANT_A, SKU_A, "supplier", PageRequest.of(0, 25))
                .getContent()).extracting("supplierId")
                .containsExactly(SUPPLIER_A);
    }

    @Test
    void receiptLedgerJoinsInventoryFactsAndEnforcesWarehouseScope() {
        UUID planId = insertPlan();
        UUID purchaseOrderId = UUID.randomUUID();
        UUID inventoryEventId = UUID.randomUUID();
        UUID receiptId = UUID.randomUUID();
        transaction.executeWithoutResult(status -> {
            var plan = repository.lock(TENANT_A, planId).orElseThrow();
            var facts = purchaseOrderRepository.findCreateFacts(
                    TENANT_A, planId, SUPPLIER_A).orElseThrow();
            purchaseOrderRepository.insert(
                    purchaseOrderId, TENANT_A, purchaseNo(purchaseOrderId), planId,
                    facts, null, "Operator", USER_A, null);
            assertThat(repository.markOrdered(
                    TENANT_A, planId, plan.version())).isEqualTo(1);
            jdbc.update("""
                    INSERT INTO inventory_ledger_events (
                        id, tenant_id, event_type, sku_id, warehouse_id,
                        signed_delta, balance_after, balance_version_after,
                        reason, actor_user_id, request_id)
                    VALUES (
                        :id, :tenantId, 'PURCHASE_ORDER_RECEIPT', :skuId,
                        :warehouseId, 4, 14, 2, 'PURCHASE_ORDER_RECEIPT',
                        :userId, 'receipt-query-test')
                    """, Map.of(
                            "id", inventoryEventId, "tenantId", TENANT_A,
                            "skuId", SKU_A, "warehouseId", WAREHOUSE_A,
                            "userId", USER_A));
            purchaseOrderRepository.insertReceipt(
                    receiptId, TENANT_A, purchaseOrderId, 4, inventoryEventId,
                    "Operator", USER_A, null, "receipt-query-test");
        });

        var visible = purchaseOrderRepository.listReceipts(
                TENANT_A, java.util.Set.of(), true, purchaseOrderId, "supplier a",
                purchaseNo(purchaseOrderId).toLowerCase(), null, null,
                ProcurementReceiptSort.RECEIVED_AT,
                PageRequest.of(0, 25));
        assertThat(visible.getTotalElements()).isEqualTo(1);
        assertThat(visible.getContent()).singleElement().satisfies(receipt -> {
            assertThat(receipt.id()).isEqualTo(receiptId);
            assertThat(receipt.purchaseNo()).isEqualTo(purchaseNo(purchaseOrderId));
            assertThat(receipt.inventoryEventId()).isEqualTo(inventoryEventId);
            assertThat(receipt.inventoryBalanceAfter()).isEqualTo(14);
        });
        assertThat(purchaseOrderRepository.listReceipts(
                TENANT_A, java.util.Set.of(WAREHOUSE_B), false, null, null,
                null, null, null, ProcurementReceiptSort.RECEIVED_AT,
                PageRequest.of(0, 25))).isEmpty();
        assertThat(purchaseOrderRepository.listReceipts(
                TENANT_B, java.util.Set.of(), true, null, null,
                null, null, null, ProcurementReceiptSort.RECEIVED_AT,
                PageRequest.of(0, 25))).isEmpty();
    }

    @Test
    void listHasStableTenantScopedPagingSearchAndWarehouseScope() {
        String marker = "stable-" + UUID.randomUUID();
        UUID olderId = UUID.randomUUID();
        UUID newerId = UUID.randomUUID();
        var facts = transaction.execute(status -> repository.findCreateFacts(
                TENANT_A, SKU_A, WAREHOUSE_A, LOCATION_A).orElseThrow());
        transaction.executeWithoutResult(status -> {
            repository.insert(
                    olderId, TENANT_A, planNo(olderId), facts, 4, marker,
                    "Operator", USER_A, null);
            repository.insert(
                    newerId, TENANT_A, planNo(newerId), facts, 5, marker,
                    "Operator", USER_A, null);
            jdbc.update(
                    "UPDATE procurement_plans SET created_at = :createdAt"
                            + " WHERE tenant_id = :tenantId AND id = :planId",
                    Map.of(
                            "createdAt", OffsetDateTime.parse("2026-08-01T10:00:00Z"),
                            "tenantId", TENANT_A, "planId", olderId));
            jdbc.update(
                    "UPDATE procurement_plans SET created_at = :createdAt"
                            + " WHERE tenant_id = :tenantId AND id = :planId",
                    Map.of(
                            "createdAt", OffsetDateTime.parse("2026-08-01T11:00:00Z"),
                            "tenantId", TENANT_A, "planId", newerId));
        });

        var first = repository.list(
                TENANT_A, java.util.Set.of(), true, WAREHOUSE_A, LOCATION_A,
                ProcurementPlanStatus.UNPURCHASED, ProcurementPlanSearchField.NOTE,
                marker, null, null, PageRequest.of(0, 1));
        var second = repository.list(
                TENANT_A, java.util.Set.of(), true, WAREHOUSE_A, LOCATION_A,
                ProcurementPlanStatus.UNPURCHASED, ProcurementPlanSearchField.NOTE,
                marker, null, null, PageRequest.of(1, 1));
        assertThat(first.getTotalElements()).isEqualTo(2);
        assertThat(first.getContent()).extracting(value -> value.id())
                .containsExactly(newerId);
        assertThat(second.getContent()).extracting(value -> value.id())
                .containsExactly(olderId);
        assertThat(repository.find(TENANT_B, newerId)).isEmpty();
        assertThat(repository.list(
                TENANT_A, java.util.Set.of(WAREHOUSE_B), false, null, null,
                null, ProcurementPlanSearchField.NOTE, marker, null, null,
                PageRequest.of(0, 25))).isEmpty();
    }

    @Test
    void unpurchasedSummaryCountIsTenantAndWarehouseScoped() {
        long tenantBefore = repository.countByStatus(
                TENANT_A, java.util.Set.of(), true,
                ProcurementPlanStatus.UNPURCHASED);
        long warehouseBefore = repository.countByStatus(
                TENANT_A, java.util.Set.of(WAREHOUSE_A), false,
                ProcurementPlanStatus.UNPURCHASED);
        long otherWarehouseBefore = repository.countByStatus(
                TENANT_A, java.util.Set.of(WAREHOUSE_B), false,
                ProcurementPlanStatus.UNPURCHASED);

        insertPlan();

        assertThat(repository.countByStatus(
                TENANT_A, java.util.Set.of(), true,
                ProcurementPlanStatus.UNPURCHASED))
                .isEqualTo(tenantBefore + 1);
        assertThat(repository.countByStatus(
                TENANT_A, java.util.Set.of(WAREHOUSE_A), false,
                ProcurementPlanStatus.UNPURCHASED))
                .isEqualTo(warehouseBefore + 1);
        assertThat(repository.countByStatus(
                TENANT_A, java.util.Set.of(WAREHOUSE_B), false,
                ProcurementPlanStatus.UNPURCHASED))
                .isEqualTo(otherWarehouseBefore);
        assertThat(repository.countByStatus(
                TENANT_B, java.util.Set.of(), true,
                ProcurementPlanStatus.UNPURCHASED))
                .isZero();
    }

    @Test
    void commandIdentityAndAtomicVoidUpdateAreDeterministicUnderConcurrency()
            throws Exception {
        UUID planId = insertPlan();
        UUID commandId = UUID.randomUUID();
        repository.insertCommand(
                TENANT_A, commandId, planId, "CREATE", "a".repeat(64),
                ProcurementPlanStatus.UNPURCHASED, 0);
        assertThatThrownBy(() -> repository.insertCommand(
                TENANT_A, commandId, planId, "CREATE", "a".repeat(64),
                ProcurementPlanStatus.UNPURCHASED, 0))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(error -> assertThat(sqlState(error)).isEqualTo("23505"));

        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> {
                start.await();
                return repository.voidPlan(
                        TENANT_A, planId, 0, "obsolete", "Operator", USER_A, null);
            });
            var second = executor.submit(() -> {
                start.await();
                return repository.voidPlan(
                        TENANT_A, planId, 0, "obsolete", "Operator", USER_A, null);
            });
            start.countDown();
            assertThat(first.get(20, TimeUnit.SECONDS)
                    + second.get(20, TimeUnit.SECONDS)).isEqualTo(1);
        }
        var voided = repository.find(TENANT_A, planId).orElseThrow();
        assertThat(voided.status()).isEqualTo(ProcurementPlanStatus.VOIDED);
        assertThat(voided.version()).isEqualTo(1);
    }

    @Test
    void failedTransactionalWriteLeavesNoPlanOrCommandResult() {
        UUID planId = UUID.randomUUID();
        UUID commandId = UUID.randomUUID();
        var facts = transaction.execute(status -> repository.findCreateFacts(
                TENANT_A, SKU_A, WAREHOUSE_A, LOCATION_A).orElseThrow());

        assertThatThrownBy(() -> transaction.executeWithoutResult(status -> {
            repository.insert(
                    planId, TENANT_A, planNo(planId), facts, 3, null,
                    "Operator", USER_A, null);
            repository.insertCommand(
                    TENANT_A, commandId, planId, "CREATE", "b".repeat(64),
                    ProcurementPlanStatus.UNPURCHASED, 0);
            throw new IllegalStateException("synthetic audit failure");
        })).isInstanceOf(IllegalStateException.class);

        assertThat(repository.find(TENANT_A, planId)).isEmpty();
        assertThat(repository.findCommand(TENANT_A, commandId)).isEmpty();
    }

    private static UUID insertPlan() {
        UUID planId = UUID.randomUUID();
        var facts = transaction.execute(status -> repository.findCreateFacts(
                TENANT_A, SKU_A, WAREHOUSE_A, LOCATION_A).orElseThrow());
        transaction.executeWithoutResult(status -> repository.insert(
                planId, TENANT_A, planNo(planId), facts, 5, null,
                "Operator", USER_A, null));
        return planId;
    }

    private static void seedFacts() {
        jdbc.getJdbcTemplate().update("""
                INSERT INTO tenants (id, code, name) VALUES
                  ('a6900000-0000-4000-8000-000000000001', 'proc-a', 'Procurement A'),
                  ('a6900000-0000-4000-8000-000000000002', 'proc-b', 'Procurement B');
                INSERT INTO users (id, tenant_id, username, display_name) VALUES
                  ('a6900000-0000-4000-8000-000000000003',
                   'a6900000-0000-4000-8000-000000000001', 'operator', 'Operator');
                INSERT INTO tenant_product_spus
                  (id, tenant_id, business_code, name, status) VALUES
                  ('a6900000-0000-4000-8000-000000000010',
                   'a6900000-0000-4000-8000-000000000001', 'PROC_SPU', 'Product', 'ACTIVE');
                INSERT INTO tenant_product_skus
                  (id, tenant_id, spu_id, business_code, name, variant_summary, status) VALUES
                  ('a6900000-0000-4000-8000-000000000011',
                   'a6900000-0000-4000-8000-000000000001',
                   'a6900000-0000-4000-8000-000000000010', 'PROC_SKU', 'Product', 'Black', 'ACTIVE');
                INSERT INTO tenant_warehouses
                  (id, tenant_id, business_code, name, status) VALUES
                  ('a6900000-0000-4000-8000-000000000020',
                   'a6900000-0000-4000-8000-000000000001', 'PROC_WH_A', 'Warehouse A', 'ACTIVE'),
                  ('a6900000-0000-4000-8000-000000000022',
                   'a6900000-0000-4000-8000-000000000001', 'PROC_WH_B', 'Warehouse B', 'ACTIVE');
                INSERT INTO tenant_warehouse_locations
                  (id, tenant_id, warehouse_id, business_code, name, status) VALUES
                  ('a6900000-0000-4000-8000-000000000021',
                   'a6900000-0000-4000-8000-000000000001',
                   'a6900000-0000-4000-8000-000000000020', 'PROC_LOC_A', 'Location A', 'ACTIVE'),
                  ('a6900000-0000-4000-8000-000000000023',
                   'a6900000-0000-4000-8000-000000000001',
                   'a6900000-0000-4000-8000-000000000022', 'PROC_LOC_B', 'Location B', 'ACTIVE');
                INSERT INTO tenant_suppliers
                  (id, tenant_id, business_code, name, status) VALUES
                  ('a6900000-0000-4000-8000-000000000030',
                   'a6900000-0000-4000-8000-000000000001', 'PROC_SUP', 'Supplier A', 'ACTIVE');
                INSERT INTO tenant_supplier_sku_mappings
                  (id, tenant_id, supplier_id, sku_id, supplier_sku_code, status, preferred)
                VALUES
                  ('a6900000-0000-4000-8000-000000000031',
                   'a6900000-0000-4000-8000-000000000001',
                   'a6900000-0000-4000-8000-000000000030',
                   'a6900000-0000-4000-8000-000000000011',
                   'SUP-PROC-SKU', 'ACTIVE', true);
                """);
    }

    private static int integer(String sql) {
        Integer value = jdbc.getJdbcTemplate().queryForObject(sql, Integer.class);
        return value == null ? 0 : value;
    }

    private static String string(String sql) {
        return jdbc.getJdbcTemplate().queryForObject(sql, String.class);
    }

    private static String planNo(UUID id) {
        return "PP-20260801-" + id.toString().replace("-", "")
                .substring(0, 28).toUpperCase();
    }

    private static String purchaseNo(UUID id) {
        return "PO-20260801-" + id.toString().replace("-", "")
                .substring(0, 28).toUpperCase();
    }

    private static String sqlState(Throwable error) {
        Throwable current = error;
        while (current != null) {
            if (current instanceof java.sql.SQLException sql) return sql.getSQLState();
            current = current.getCause();
        }
        return null;
    }

    private static UUID uuid(String value) {
        return UUID.fromString(value);
    }
}
