package cn.xzkj.erp.inventory.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeMode;
import cn.xzkj.erp.inventory.domain.InventoryEventType;
import cn.xzkj.erp.inventory.service.InventoryActor;
import cn.xzkj.erp.inventory.service.InventoryArchiveGuard;
import cn.xzkj.erp.inventory.service.InventoryBalanceSearchField;
import cn.xzkj.erp.inventory.service.InventoryBalanceView;
import cn.xzkj.erp.inventory.service.InventoryConflictException;
import cn.xzkj.erp.inventory.service.InventoryMutationResult;
import cn.xzkj.erp.inventory.service.InventoryService;
import cn.xzkj.erp.inventory.service.JdbcInventoryArchiveGuard;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Duration;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;

class InventoryPostgresql16GateTest {
    private static final UUID TENANT_A =
            UUID.fromString("a4400000-0000-0000-0000-000000000001");
    private static final UUID TENANT_B =
            UUID.fromString("a4400000-0000-0000-0000-000000000002");
    private static final UUID USER_A =
            UUID.fromString("a4400000-0000-0000-0000-000000000003");
    private static final UUID USER_B =
            UUID.fromString("a4400000-0000-0000-0000-000000000004");
    private static final UUID SKU_A =
            UUID.fromString("a4400000-0000-0000-0000-000000000010");
    private static final UUID SKU_B =
            UUID.fromString("a4400000-0000-0000-0000-000000000011");
    private static final UUID WAREHOUSE_A =
            UUID.fromString("a4400000-0000-0000-0000-000000000020");
    private static final UUID WAREHOUSE_B =
            UUID.fromString("a4400000-0000-0000-0000-000000000021");
    private static final UUID CATEGORY_A =
            UUID.fromString("a4400000-0000-0000-0000-000000000040");
    private static final UUID CATEGORY_B =
            UUID.fromString("a4400000-0000-0000-0000-000000000041");

    private static final String DATABASE_USER = "erp";
    private static final String DATABASE_PASSWORD = "erp";
    private static PostgreSQLContainer<?> postgres;
    private static String jdbcUrl;
    private static NamedParameterJdbcTemplate jdbc;
    private static TransactionTemplate transaction;
    private static WarehouseScopeEvaluator scopeEvaluator;
    private static InventoryService service;
    private static InventoryArchiveGuard archiveGuard;

    @BeforeAll
    static void migrateEmptyPostgresql16AndBuildRuntime() throws Exception {
        startPostgresql16();
        Flyway flyway = Flyway.configure()
                .dataSource(
                        jdbcUrl,
                        DATABASE_USER,
                        DATABASE_PASSWORD)
                .locations("classpath:db/migration")
                .load();
        var result = flyway.migrate();
        assertThat(result.success).isTrue();
        assertThat(result.migrations.stream()
                        .filter(migration ->
                                migration.category.equals("SKIPPED")))
                .isEmpty();

        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                jdbcUrl,
                DATABASE_USER,
                DATABASE_PASSWORD);
        jdbc = new NamedParameterJdbcTemplate(dataSource);
        transaction = new TransactionTemplate(
                new DataSourceTransactionManager(dataSource));
        scopeEvaluator = mock(WarehouseScopeEvaluator.class);
        InventoryStore store = new InventoryStore(jdbc);
        service = new InventoryService(
                store, scopeEvaluator, new JdbcAuditRecorder(jdbc));
        archiveGuard = new JdbcInventoryArchiveGuard(store);
        seedMasterData();
    }

    @AfterAll
    static void stopPostgresql16() {
        if (postgres != null) {
            postgres.stop();
        }
    }

    @BeforeEach
    void resetInventoryFacts() {
        jdbc.getJdbcTemplate().execute("""
                TRUNCATE TABLE
                    inventory_command_idempotency,
                    inventory_balances,
                    inventory_ledger_events,
                    audit_logs
                RESTART IDENTITY CASCADE
                """);
        jdbc.update(
                """
                UPDATE tenant_product_skus SET status = 'ACTIVE'
                WHERE id IN (:skuIds)
                """,
                Map.of("skuIds", Set.of(SKU_A, SKU_B)));
        jdbc.update(
                """
                UPDATE tenant_warehouses SET status = 'ACTIVE'
                WHERE id IN (:warehouseIds)
                """,
                Map.of("warehouseIds", Set.of(WAREHOUSE_A, WAREHOUSE_B)));
        reset(scopeEvaluator);
        when(scopeEvaluator.evaluate(any(), any(), any()))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void emptyMigrationCreatesV44WithoutAutoGrantingPermissions()
            throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        jdbcUrl,
                        DATABASE_USER,
                        DATABASE_PASSWORD);
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("""
                        SELECT
                          (SELECT count(*) FROM flyway_schema_history
                           WHERE version = '44' AND success) AS v44,
                          (SELECT count(*) FROM permissions
                           WHERE code IN (
                             'inventory.read', 'inventory.adjust'
                           )) AS permissions,
                          (SELECT count(*) FROM role_permissions rp
                           JOIN permissions p ON p.id = rp.permission_id
                           WHERE p.code IN (
                             'inventory.read', 'inventory.adjust'
                           )) AS grants
                        """)) {
            assertThat(result.next()).isTrue();
            assertThat(result.getInt("v44")).isOne();
            assertThat(result.getInt("permissions")).isEqualTo(2);
            assertThat(result.getInt("grants")).isZero();
        }
    }

    @Test
    void tenantCompositeForeignKeysRejectCrossTenantDimensions() {
        assertThatThrownBy(() -> jdbc.update(
                """
                INSERT INTO inventory_balances (
                    tenant_id, sku_id, warehouse_id
                ) VALUES (
                    :tenantId, :skuId, :warehouseId
                )
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", TENANT_A)
                        .addValue("skuId", SKU_B)
                        .addValue("warehouseId", WAREHOUSE_A)))
                .hasRootCauseInstanceOf(java.sql.SQLException.class);
    }

    @Test
    void ledgerRejectsUnknownSystemAdminActor() {
        assertThatThrownBy(() -> jdbc.update(
                """
                INSERT INTO inventory_ledger_events (
                    tenant_id, event_type, sku_id, warehouse_id,
                    signed_delta, balance_after, balance_version_after,
                    reason, actor_system_admin_id, request_id
                ) VALUES (
                    :tenantId, 'CORRECTION', :skuId, :warehouseId,
                    1, 1, 1, 'STOCK_CORRECTION',
                    :systemAdminId, 'invalid-system-admin'
                )
                """,
                new MapSqlParameterSource()
                        .addValue("tenantId", TENANT_A)
                        .addValue("skuId", SKU_A)
                        .addValue("warehouseId", WAREHOUSE_A)
                        .addValue("systemAdminId", UUID.randomUUID())))
                .hasRootCauseInstanceOf(java.sql.SQLException.class);
        assertThat(count("inventory_ledger_events")).isZero();
    }

    @Test
    void negativeOpeningBalanceAndAvailableProjectionRemainEqual() {
        InventoryMutationResult result = adjust(
                actorA(),
                InventoryEventType.OPENING_BALANCE,
                SKU_A,
                WAREHOUSE_A,
                -15,
                0,
                "INITIAL_STOCK",
                "opening-negative",
                "request-negative");

        assertThat(result.balance().onHand()).isEqualTo(-15);
        assertThat(result.balance().available()).isEqualTo(-15);
        InventoryBalanceView listed = inTransaction(() -> service.listBalances(
                        actorA(),
                        WAREHOUSE_A,
                        SKU_A,
                        null,
                        PageRequest.of(0, 20)))
                .getContent()
                .getFirst();
        assertThat(listed.onHand()).isEqualTo(-15);
        assertThat(listed.available()).isEqualTo(-15);
        assertThat(inTransaction(() -> service.listBalances(
                actorA(),
                WAREHOUSE_A,
                null,
                InventoryBalanceSearchField.ALL,
                null,
                -15L,
                -15L,
                PageRequest.of(0, 20))).getContent())
                .extracting(InventoryBalanceView::skuId)
                .containsExactly(SKU_A);
        assertThat(inTransaction(() -> service.listBalances(
                actorA(),
                WAREHOUSE_A,
                null,
                InventoryBalanceSearchField.ALL,
                null,
                -14L,
                null,
                PageRequest.of(0, 20))).getContent()).isEmpty();
        var summaries = inTransaction(() -> service.listSkuSummaries(
                actorA(),
                List.of(SKU_A, SKU_B)));
        assertThat(summaries).singleElement().satisfies(summary -> {
            assertThat(summary.skuId()).isEqualTo(SKU_A);
            assertThat(summary.onHand()).isEqualTo(-15);
            assertThat(summary.reserved()).isZero();
            assertThat(summary.available()).isEqualTo(-15);
        });
    }

    @Test
    void balanceUpdatedDateFilterUsesInclusiveUtc8CalendarDays() {
        adjust(
                actorA(),
                InventoryEventType.OPENING_BALANCE,
                SKU_A,
                WAREHOUSE_A,
                5,
                0,
                "INITIAL_STOCK",
                "updated-range",
                "request-updated-range");
        jdbc.update(
                """
                UPDATE inventory_balances
                SET updated_at = :updatedAt
                WHERE tenant_id = :tenantId
                  AND sku_id = :skuId
                  AND warehouse_id = :warehouseId
                """,
                new MapSqlParameterSource()
                        .addValue(
                                "updatedAt",
                                java.time.OffsetDateTime.parse(
                                        "2026-07-31T16:00:00Z"))
                        .addValue("tenantId", TENANT_A)
                        .addValue("skuId", SKU_A)
                        .addValue("warehouseId", WAREHOUSE_A));

        assertThat(inTransaction(() -> service.listBalances(
                actorA(),
                null,
                null,
                InventoryBalanceSearchField.ALL,
                null,
                null,
                null,
                LocalDate.of(2026, 8, 1),
                LocalDate.of(2026, 8, 1),
                PageRequest.of(0, 20))).getContent())
                .extracting(InventoryBalanceView::skuId)
                .containsExactly(SKU_A);
        assertThat(inTransaction(() -> service.listBalances(
                actorA(),
                null,
                null,
                InventoryBalanceSearchField.ALL,
                null,
                null,
                null,
                LocalDate.of(2026, 7, 31),
                LocalDate.of(2026, 7, 31),
                PageRequest.of(0, 20))).getContent()).isEmpty();
    }

    @Test
    void balanceCategoryFilterUsesTenantSafeSpuCatalogReferences() {
        adjust(
                actorA(),
                InventoryEventType.OPENING_BALANCE,
                SKU_A,
                WAREHOUSE_A,
                5,
                0,
                "INITIAL_STOCK",
                "category-a",
                "request-category-a");
        adjust(
                actorB(),
                InventoryEventType.OPENING_BALANCE,
                SKU_B,
                WAREHOUSE_B,
                7,
                0,
                "INITIAL_STOCK",
                "category-b",
                "request-category-b");

        assertThat(inTransaction(() -> service.listBalances(
                actorA(),
                null,
                null,
                CATEGORY_A,
                InventoryBalanceSearchField.ALL,
                null,
                null,
                null,
                null,
                null,
                PageRequest.of(0, 20))).getContent())
                .extracting(InventoryBalanceView::skuId)
                .containsExactly(SKU_A);
        assertThat(inTransaction(() -> service.listBalances(
                actorA(),
                null,
                null,
                CATEGORY_B,
                InventoryBalanceSearchField.ALL,
                null,
                null,
                null,
                null,
                null,
                PageRequest.of(0, 20))).getContent())
                .isEmpty();
    }

    @Test
    void balanceSearchFieldsUseTenantSafeSkuAndMasterDataColumns() {
        adjust(
                actorA(),
                InventoryEventType.OPENING_BALANCE,
                SKU_A,
                WAREHOUSE_A,
                5,
                0,
                "INITIAL_STOCK",
                "search-a",
                "request-search-a");
        adjust(
                actorB(),
                InventoryEventType.OPENING_BALANCE,
                SKU_B,
                WAREHOUSE_B,
                7,
                0,
                "INITIAL_STOCK",
                "search-b",
                "request-search-b");

        assertThat(searchBalances(
                InventoryBalanceSearchField.ALL, "inventory widget"))
                .extracting(InventoryBalanceView::skuId)
                .containsExactly(SKU_A);
        assertThat(searchBalances(
                InventoryBalanceSearchField.MASTER_SKU, "spu_a"))
                .extracting(InventoryBalanceView::skuId)
                .containsExactly(SKU_A);
        assertThat(searchBalances(
                InventoryBalanceSearchField.NAME_ZH, "库存商品甲"))
                .extracting(InventoryBalanceView::skuId)
                .containsExactly(SKU_A);
        assertThat(searchBalances(
                InventoryBalanceSearchField.NAME_EN, "inventory widget"))
                .extracting(InventoryBalanceView::skuId)
                .containsExactly(SKU_A);
        assertThat(searchBalances(
                InventoryBalanceSearchField.INVENTORY_SKU, "sku_a"))
                .extracting(InventoryBalanceView::skuId)
                .containsExactly(SKU_A);
        assertThat(searchBalances(
                InventoryBalanceSearchField.NAME_EN, "spu_a")).isEmpty();
        assertThat(searchBalances(
                InventoryBalanceSearchField.ALL, "tenant b widget")).isEmpty();
    }

    @Test
    void sameIdempotencyRequestReplaysAndDifferentFingerprintConflicts() {
        InventoryMutationResult first = adjust(
                actorA(),
                InventoryEventType.CORRECTION,
                SKU_A,
                WAREHOUSE_A,
                8,
                0,
                "STOCK_CORRECTION",
                "same-key",
                "request-idem-1");
        InventoryMutationResult replay = adjust(
                actorA(),
                InventoryEventType.CORRECTION,
                SKU_A,
                WAREHOUSE_A,
                8,
                0,
                "STOCK_CORRECTION",
                "same-key",
                "request-idem-2");

        assertThat(replay.replayed()).isTrue();
        assertThat(replay.event().id()).isEqualTo(first.event().id());
        assertThat(count("inventory_ledger_events")).isOne();
        assertThat(count("audit_logs")).isOne();
        assertThatThrownBy(() -> adjust(
                actorA(),
                InventoryEventType.CORRECTION,
                SKU_A,
                WAREHOUSE_A,
                9,
                0,
                "STOCK_CORRECTION",
                "same-key",
                "request-idem-3"))
                .isInstanceOf(InventoryConflictException.class)
                .extracting("reason")
                .isEqualTo("idempotency_conflict");
    }

    @Test
    void warehouseTransferShipmentPersistsItsFullEventType() {
        adjust(
                actorA(),
                InventoryEventType.OPENING_BALANCE,
                SKU_A,
                WAREHOUSE_A,
                3,
                0,
                "INITIAL_STOCK",
                "transfer-shipment-opening",
                "request-transfer-shipment-opening");

        InventoryMutationResult shipment = adjust(
                actorA(),
                InventoryEventType.WAREHOUSE_TRANSFER_SHIPMENT,
                SKU_A,
                WAREHOUSE_A,
                -1,
                1,
                "WAREHOUSE_TRANSFER_SHIPMENT",
                "transfer-shipment-event",
                "request-transfer-shipment-event");

        assertThat(shipment.event().eventType())
                .isEqualTo(InventoryEventType.WAREHOUSE_TRANSFER_SHIPMENT);
        assertThat(shipment.balance().onHand()).isEqualTo(2);
        assertThat(jdbc.queryForObject(
                "SELECT event_type FROM inventory_ledger_events WHERE id = :id",
                Map.of("id", shipment.event().id()),
                String.class)).isEqualTo("WAREHOUSE_TRANSFER_SHIPMENT");
    }

    @Test
    void concurrentSameCommandCommitsOnceAndReplaysOnce()
            throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            java.util.concurrent.Callable<InventoryMutationResult> command =
                    () -> {
                        start.await(10, TimeUnit.SECONDS);
                        return adjust(
                                actorA(),
                                InventoryEventType.CORRECTION,
                                SKU_A,
                                WAREHOUSE_A,
                                5,
                                0,
                                "STOCK_CORRECTION",
                                "concurrent-same",
                                "request-concurrent");
                    };
            Future<InventoryMutationResult> first = executor.submit(command);
            Future<InventoryMutationResult> second = executor.submit(command);
            start.countDown();
            InventoryMutationResult left = first.get(20, TimeUnit.SECONDS);
            InventoryMutationResult right = second.get(20, TimeUnit.SECONDS);

            assertThat(right.event().id()).isEqualTo(left.event().id());
            assertThat(left.replayed() || right.replayed()).isTrue();
            assertThat(count("inventory_ledger_events")).isOne();
            assertThat(currentOnHand()).isEqualTo(5);
        }
    }

    @Test
    void concurrentDifferentCommandsExposeStaleVersionWithoutLostUpdate()
            throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            Future<Object> first = executor.submit(() ->
                    concurrentAdjust(start, 3, "concurrent-a"));
            Future<Object> second = executor.submit(() ->
                    concurrentAdjust(start, 4, "concurrent-b"));
            start.countDown();
            Object left = first.get(20, TimeUnit.SECONDS);
            Object right = second.get(20, TimeUnit.SECONDS);

            assertThat(java.util.List.of(left, right)
                    .stream()
                    .filter(InventoryMutationResult.class::isInstance)
                    .count()).isOne();
            assertThat(java.util.List.of(left, right)
                    .stream()
                    .filter(InventoryConflictException.class::isInstance)
                    .map(InventoryConflictException.class::cast)
                    .map(InventoryConflictException::reason))
                    .containsExactly("stale_version");
            assertThat(count("inventory_ledger_events")).isOne();
            assertThat(currentOnHand()).isIn(3L, 4L);
        }
    }

    @Test
    void reversalRestoresBalanceAndCannotBeRepeated() {
        InventoryMutationResult original = adjust(
                actorA(),
                InventoryEventType.OPENING_BALANCE,
                SKU_A,
                WAREHOUSE_A,
                -11,
                0,
                "INITIAL_STOCK",
                "original",
                "request-original");
        InventoryMutationResult reversal = inTransaction(() -> service.reverse(
                actorA(),
                original.event().id(),
                1,
                "REVERSAL_CORRECTION",
                null,
                "reverse-once"));

        assertThat(reversal.event().signedDelta()).isEqualTo(11);
        assertThat(reversal.balance().onHand()).isZero();
        assertThatThrownBy(() -> inTransaction(() -> service.reverse(
                actorA(),
                original.event().id(),
                2,
                "REVERSAL_CORRECTION",
                null,
                "reverse-twice")))
                .isInstanceOf(InventoryConflictException.class)
                .extracting("reason")
                .isEqualTo("reversal_not_allowed");
        assertThat(count("inventory_ledger_events")).isEqualTo(2);
    }

    @Test
    void concurrentDifferentKeysSerializeDuplicateReversalToSafeReason()
            throws Exception {
        InventoryMutationResult original = adjust(
                actorA(),
                InventoryEventType.OPENING_BALANCE,
                SKU_A,
                WAREHOUSE_A,
                9,
                0,
                "INITIAL_STOCK",
                "concurrent-reversal-original",
                "request-concurrent-reversal-original");
        try (Connection blocker = DriverManager.getConnection(
                        jdbcUrl,
                        DATABASE_USER,
                        DATABASE_PASSWORD);
                Statement statement = blocker.createStatement();
                var executor = Executors.newFixedThreadPool(2)) {
            blocker.setAutoCommit(false);
            statement.executeQuery("""
                    SELECT id FROM inventory_balances
                    WHERE tenant_id = '%s'
                      AND sku_id = '%s'
                      AND warehouse_id = '%s'
                    FOR UPDATE
                    """.formatted(TENANT_A, SKU_A, WAREHOUSE_A)).close();

            Future<Object> first = executor.submit(() -> concurrentReverse(
                    original.event().id(),
                    1,
                    "concurrent-reverse-first"));
            awaitEventLock(original.event().id());
            Future<Object> second = executor.submit(() -> concurrentReverse(
                    original.event().id(),
                    2,
                    "concurrent-reverse-second"));
            blocker.commit();

            Object left = first.get(20, TimeUnit.SECONDS);
            Object right = second.get(20, TimeUnit.SECONDS);
            assertThat(left).isInstanceOf(InventoryMutationResult.class);
            assertThat(right).isInstanceOf(InventoryConflictException.class);
            assertThat(((InventoryConflictException) right).reason())
                    .isEqualTo("reversal_not_allowed");
        }
        assertThat(count("inventory_ledger_events")).isEqualTo(2);
        assertThat(count("inventory_command_idempotency")).isEqualTo(2);
        assertThat(count("audit_logs")).isEqualTo(2);
        assertThat(currentOnHand()).isZero();
    }

    @Test
    void ledgerReplayMatchesProjectionAndHistoryIsAppendOnly() {
        adjust(
                actorA(),
                InventoryEventType.OPENING_BALANCE,
                SKU_A,
                WAREHOUSE_A,
                10,
                0,
                "INITIAL_STOCK",
                "replay-1",
                "request-replay-1");
        adjust(
                actorA(),
                InventoryEventType.CORRECTION,
                SKU_A,
                WAREHOUSE_A,
                -14,
                1,
                "STOCK_CORRECTION",
                "replay-2",
                "request-replay-2");

        Long replayed = jdbc.queryForObject(
                """
                SELECT sum(signed_delta)
                FROM inventory_ledger_events
                WHERE tenant_id = :tenantId
                  AND sku_id = :skuId
                  AND warehouse_id = :warehouseId
                """,
                Map.of(
                        "tenantId", TENANT_A,
                        "skuId", SKU_A,
                        "warehouseId", WAREHOUSE_A),
                Long.class);
        assertThat(replayed).isEqualTo(currentOnHand());
        assertThatThrownBy(() -> jdbc.update(
                "UPDATE inventory_ledger_events SET reason = 'TAMPERED'",
                Map.of()))
                .hasRootCauseInstanceOf(java.sql.SQLException.class);
        assertThatThrownBy(() -> jdbc.update(
                "DELETE FROM inventory_ledger_events",
                Map.of()))
                .hasRootCauseInstanceOf(java.sql.SQLException.class);
    }

    @Test
    void crossTenantOutOfScopeAndInactiveMasterDataFailSafely() {
        assertThatThrownBy(() -> adjust(
                actorA(),
                InventoryEventType.CORRECTION,
                SKU_B,
                WAREHOUSE_A,
                1,
                0,
                "STOCK_CORRECTION",
                "cross-tenant",
                "request-cross"))
                .isInstanceOf(ResourceNotFoundException.class);

        WarehouseScopeAccess selected = new WarehouseScopeAccess(
                WarehouseScopeMode.SELECTED, Set.of());
        when(scopeEvaluator.evaluate(TENANT_A, USER_A, null))
                .thenReturn(selected);
        doThrow(new ResourceNotFoundException("Warehouse was not found"))
                .when(scopeEvaluator)
                .requireVisible(selected, WAREHOUSE_A);
        assertThatThrownBy(() -> adjust(
                actorA(),
                InventoryEventType.CORRECTION,
                SKU_A,
                WAREHOUSE_A,
                1,
                0,
                "STOCK_CORRECTION",
                "out-of-scope",
                "request-scope"))
                .isInstanceOf(ResourceNotFoundException.class);

        reset(scopeEvaluator);
        when(scopeEvaluator.evaluate(any(), any(), any()))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
        jdbc.update(
                "UPDATE tenant_product_skus SET status = 'INACTIVE'"
                        + " WHERE id = :id",
                Map.of("id", SKU_A));
        assertThatThrownBy(() -> adjust(
                actorA(),
                InventoryEventType.CORRECTION,
                SKU_A,
                WAREHOUSE_A,
                1,
                0,
                "STOCK_CORRECTION",
                "inactive",
                "request-inactive"))
                .isInstanceOf(InventoryConflictException.class)
                .extracting("reason")
                .isEqualTo("master_data_inactive");

        jdbc.update(
                "UPDATE tenant_product_skus SET status = 'ACTIVE'"
                        + " WHERE id = :id",
                Map.of("id", SKU_A));
        jdbc.update(
                "UPDATE tenant_warehouses SET status = 'ARCHIVED'"
                        + " WHERE id = :id",
                Map.of("id", WAREHOUSE_A));
        assertThatThrownBy(() -> adjust(
                actorA(),
                InventoryEventType.CORRECTION,
                SKU_A,
                WAREHOUSE_A,
                1,
                0,
                "STOCK_CORRECTION",
                "archived",
                "request-archived"))
                .isInstanceOf(InventoryConflictException.class)
                .extracting("reason")
                .isEqualTo("master_data_inactive");
    }

    @Test
    void nonzeroBalanceGuardsSkuAndWarehouseArchive() {
        adjust(
                actorA(),
                InventoryEventType.OPENING_BALANCE,
                SKU_A,
                WAREHOUSE_A,
                1,
                0,
                "INITIAL_STOCK",
                "archive-guard",
                "request-guard");

        assertThatThrownBy(() -> archiveGuard.requireSkuHasZeroBalance(
                TENANT_A, SKU_A))
                .isInstanceOf(InventoryConflictException.class)
                .extracting("reason")
                .isEqualTo("nonzero_inventory_balance");
        assertThatThrownBy(() ->
                archiveGuard.requireWarehouseHasZeroBalance(
                        TENANT_A, WAREHOUSE_A))
                .isInstanceOf(InventoryConflictException.class);
    }

    @Test
    void auditFailureRollsBackLedgerBalanceAndIdempotency() {
        InventoryStore store = new InventoryStore(jdbc);
        InventoryService failingService = new InventoryService(
                store,
                scopeEvaluator,
                event -> {
                    throw new IllegalStateException("audit unavailable");
                });

        assertThatThrownBy(() -> transaction.execute(status ->
                failingService.adjust(
                        actorA(),
                        InventoryEventType.CORRECTION,
                        SKU_A,
                        WAREHOUSE_A,
                        6,
                        0,
                        "STOCK_CORRECTION",
                        null,
                        "audit-failure")))
                .isInstanceOf(IllegalStateException.class);
        assertThat(count("inventory_ledger_events")).isZero();
        assertThat(count("inventory_balances")).isZero();
        assertThat(count("inventory_command_idempotency")).isZero();
        assertThat(count("audit_logs")).isZero();
    }

    private static Object concurrentAdjust(
            CountDownLatch start, long delta, String key)
            throws InterruptedException {
        start.await(10, TimeUnit.SECONDS);
        try {
            return adjust(
                    actorA(),
                    InventoryEventType.CORRECTION,
                    SKU_A,
                    WAREHOUSE_A,
                    delta,
                    0,
                    "STOCK_CORRECTION",
                    key,
                    "request-" + key);
        } catch (InventoryConflictException exception) {
            return exception;
        }
    }

    private static Object concurrentReverse(
            UUID eventId, long expectedVersion, String key) {
        try {
            return inTransaction(() -> service.reverse(
                    new InventoryActor(
                            TENANT_A,
                            USER_A,
                            null,
                            "request-" + key,
                            "127.0.0.1"),
                    eventId,
                    expectedVersion,
                    "REVERSAL_CORRECTION",
                    null,
                    key));
        } catch (InventoryConflictException exception) {
            return exception;
        }
    }

    private static void awaitEventLock(UUID eventId) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (System.nanoTime() < deadline) {
            try (Connection probe = DriverManager.getConnection(
                            jdbcUrl,
                            DATABASE_USER,
                            DATABASE_PASSWORD);
                    Statement statement = probe.createStatement()) {
                probe.setAutoCommit(false);
                statement.executeQuery("""
                        SELECT id FROM inventory_ledger_events
                        WHERE id = '%s'
                        FOR UPDATE NOWAIT
                        """.formatted(eventId)).close();
                probe.rollback();
            } catch (java.sql.SQLException exception) {
                if ("55P03".equals(exception.getSQLState())) {
                    return;
                }
                throw exception;
            }
            Thread.sleep(25);
        }
        throw new IllegalStateException(
                "First reversal did not lock the original event");
    }

    private static InventoryMutationResult adjust(
            InventoryActor actor,
            InventoryEventType type,
            UUID skuId,
            UUID warehouseId,
            long delta,
            long expectedVersion,
            String reason,
            String key,
            String requestId) {
        InventoryActor commandActor = new InventoryActor(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                requestId,
                actor.sourceIp());
        return inTransaction(() -> service.adjust(
                commandActor,
                type,
                skuId,
                warehouseId,
                delta,
                expectedVersion,
                reason,
                "access_token=must-redact",
                key));
    }

    private static long currentOnHand() {
        Long value = jdbc.queryForObject(
                """
                SELECT on_hand FROM inventory_balances
                WHERE tenant_id = :tenantId
                  AND sku_id = :skuId
                  AND warehouse_id = :warehouseId
                """,
                Map.of(
                        "tenantId", TENANT_A,
                        "skuId", SKU_A,
                        "warehouseId", WAREHOUSE_A),
                Long.class);
        return value == null ? 0 : value;
    }

    private static long count(String table) {
        if (!Set.of(
                "inventory_ledger_events",
                "inventory_balances",
                "inventory_command_idempotency",
                "audit_logs").contains(table)) {
            throw new IllegalArgumentException("Unexpected table");
        }
        Long count = jdbc.getJdbcTemplate().queryForObject(
                "SELECT count(*) FROM " + table, Long.class);
        return count == null ? 0 : count;
    }

    private static InventoryActor actorA() {
        return new InventoryActor(
                TENANT_A, USER_A, null, "request-default", "127.0.0.1");
    }

    private static InventoryActor actorB() {
        return new InventoryActor(
                TENANT_B, USER_B, null, "request-default-b", "127.0.0.1");
    }

    private static List<InventoryBalanceView> searchBalances(
            InventoryBalanceSearchField searchField,
            String keyword) {
        return inTransaction(() -> service.listBalances(
                actorA(),
                null,
                null,
                searchField,
                keyword,
                PageRequest.of(0, 20))).getContent();
    }

    private static <T> T inTransaction(java.util.function.Supplier<T> action) {
        return transaction.execute(status -> action.get());
    }

    private static void seedMasterData() {
        jdbc.update(
                """
                INSERT INTO tenants (id, code, name) VALUES
                  (:tenantA, 'inventory_a', 'Inventory A'),
                  (:tenantB, 'inventory_b', 'Inventory B')
                """,
                Map.of("tenantA", TENANT_A, "tenantB", TENANT_B));
        jdbc.update(
                """
                INSERT INTO users (
                    id, tenant_id, username, display_name, status
                ) VALUES
                  (:userA, :tenantA, 'inventory_actor_a', 'Actor A', 'ACTIVE'),
                  (:userB, :tenantB, 'inventory_actor_b', 'Actor B', 'ACTIVE')
                """,
                Map.of(
                        "userA", USER_A,
                        "tenantA", TENANT_A,
                        "userB", USER_B,
                        "tenantB", TENANT_B));
        jdbc.update(
                """
                INSERT INTO tenant_product_categories (
                    id, tenant_id, name, sort_order
                ) VALUES
                  (:categoryA, :tenantA, 'Inventory Category A', 100),
                  (:categoryB, :tenantB, 'Inventory Category B', 100)
                """,
                Map.of(
                        "categoryA", CATEGORY_A,
                        "tenantA", TENANT_A,
                        "categoryB", CATEGORY_B,
                        "tenantB", TENANT_B));
        jdbc.update(
                """
                INSERT INTO tenant_product_spus (
                    id, tenant_id, business_code, name,
                    category_id, category_name_snapshot
                ) VALUES
                  ('a4400000-0000-0000-0000-000000000030',
                   :tenantA, 'SPU_A', 'SPU A',
                   :categoryA, 'Inventory Category A'),
                  ('a4400000-0000-0000-0000-000000000031',
                   :tenantB, 'SPU_B', 'SPU B',
                   :categoryB, 'Inventory Category B')
                """,
                Map.of(
                        "tenantA", TENANT_A,
                        "categoryA", CATEGORY_A,
                        "tenantB", TENANT_B,
                        "categoryB", CATEGORY_B));
        jdbc.update(
                """
                INSERT INTO tenant_product_skus (
                    id, tenant_id, spu_id, business_code, name, name_en
                ) VALUES
                  (:skuA, :tenantA,
                   'a4400000-0000-0000-0000-000000000030',
                   'SKU_A', '库存商品甲', 'Inventory Widget'),
                  (:skuB, :tenantB,
                   'a4400000-0000-0000-0000-000000000031',
                   'SKU_B', '租户乙商品', 'Tenant B Widget')
                """,
                Map.of(
                        "skuA", SKU_A,
                        "tenantA", TENANT_A,
                        "skuB", SKU_B,
                        "tenantB", TENANT_B));
        jdbc.update(
                """
                INSERT INTO tenant_warehouses (
                    id, tenant_id, business_code, name
                ) VALUES
                  (:warehouseA, :tenantA, 'WH_A', 'Warehouse A'),
                  (:warehouseB, :tenantB, 'WH_B', 'Warehouse B')
                """,
                Map.of(
                        "warehouseA", WAREHOUSE_A,
                        "tenantA", TENANT_A,
                        "warehouseB", WAREHOUSE_B,
                        "tenantB", TENANT_B));
    }

    @SuppressWarnings("resource")
    private static void startPostgresql16() {
        postgres = new PostgreSQLContainer<>("postgres:16-alpine")
                .withDatabaseName("erp_inventory_v44")
                .withUsername(DATABASE_USER)
                .withPassword(DATABASE_PASSWORD);
        postgres.start();
        jdbcUrl = postgres.getJdbcUrl();
    }

    private record JdbcAuditRecorder(
            NamedParameterJdbcTemplate jdbc) implements SecurityAuditRecorder {

        @Override
        public void record(SecurityAuditEvent event) {
            recordAtomically(event);
        }

        @Override
        public void recordAtomically(SecurityAuditEvent event) {
            jdbc.update(
                    """
                    INSERT INTO audit_logs (
                        tenant_id, actor_user_id, actor_system_admin_id,
                        action, resource_type, resource_id, request_id,
                        source_ip, details
                    ) VALUES (
                        :tenantId, :actorUserId, :actorSystemAdminId,
                        :action, :resourceType, :resourceId, :requestId,
                        CAST(:sourceIp AS inet), CAST('{}' AS jsonb)
                    )
                    """,
                    new MapSqlParameterSource()
                            .addValue("tenantId", event.tenantId())
                            .addValue("actorUserId", event.actorUserId())
                            .addValue(
                                    "actorSystemAdminId",
                                    event.actorSystemAdminId())
                            .addValue("action", event.action())
                            .addValue("resourceType", event.resourceType())
                            .addValue("resourceId", event.resourceId())
                            .addValue("requestId", event.requestId())
                            .addValue("sourceIp", event.sourceIp()));
        }
    }
}
