package cn.xzkj.erp.warehouse.operations.repository;

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
import cn.xzkj.erp.inventory.repository.InventoryStore;
import cn.xzkj.erp.inventory.service.InventoryActor;
import cn.xzkj.erp.inventory.service.InventoryService;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementApprovalStatus;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementDirection;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementEntryMode;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementReasonCode;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementSearchField;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementSource;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementStatus;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementActor;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.Batch;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.BatchItem;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.LineInput;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.BoxInput;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.BoxItemInput;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.Review;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.Save;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.Transition;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementConflictException;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementService;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.Mutation;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

class ManualMovementPostgresql16GateTest {
    private static final UUID TENANT_A =
            UUID.fromString("a4700000-0000-0000-0000-000000000001");
    private static final UUID TENANT_B =
            UUID.fromString("a4700000-0000-0000-0000-000000000002");
    private static final UUID USER_A =
            UUID.fromString("a4700000-0000-0000-0000-000000000003");
    private static final UUID USER_B =
            UUID.fromString("a4700000-0000-0000-0000-000000000004");
    private static final UUID SKU_A =
            UUID.fromString("a4700000-0000-4000-8000-000000000010");
    private static final UUID SKU_B =
            UUID.fromString("a4700000-0000-4000-8000-000000000011");
    private static final UUID WAREHOUSE_A =
            UUID.fromString("a4700000-0000-4000-8000-000000000020");
    private static final UUID WAREHOUSE_B =
            UUID.fromString("a4700000-0000-4000-8000-000000000021");
    private static final UUID LOCATION_A =
            UUID.fromString("a4700000-0000-4000-8000-000000000030");
    private static final UUID LOCATION_B =
            UUID.fromString("a4700000-0000-4000-8000-000000000031");
    private static final String DB_USER = "erp";
    private static final String DB_PASSWORD = "erp";

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRESQL =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("erp_manual_v47")
                    .withUsername(DB_USER)
                    .withPassword(DB_PASSWORD);
    private static String jdbcUrl;
    private static NamedParameterJdbcTemplate jdbc;
    private static TransactionTemplate transaction;
    private static WarehouseScopeEvaluator scopeEvaluator;
    private static InventoryService inventory;
    private static ManualMovementService service;

    @BeforeAll
    static void migrateAndBuildRuntime() throws Exception {
        startPostgresql16();
        var migration = Flyway.configure()
                .dataSource(jdbcUrl, DB_USER, DB_PASSWORD)
                .locations("classpath:db/migration")
                .load()
                .migrate();
        assertThat(migration.success).isTrue();
        assertThat(migration.migrations.stream()
                .filter(item -> item.category.equals("SKIPPED")))
                .isEmpty();

        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                jdbcUrl, DB_USER, DB_PASSWORD);
        jdbc = new NamedParameterJdbcTemplate(dataSource);
        transaction = new TransactionTemplate(
                new DataSourceTransactionManager(dataSource));
        scopeEvaluator = mock(WarehouseScopeEvaluator.class);
        SecurityAuditRecorder audit = new JdbcAuditRecorder(jdbc);
        inventory = new InventoryService(
                new InventoryStore(jdbc), scopeEvaluator, audit);
        service = new ManualMovementService(
                new ManualMovementStore(jdbc),
                new ManualMovementWorkflowStore(jdbc),
                inventory,
                scopeEvaluator,
                audit);
        seedMasterData();
    }

    @AfterAll
    static void stopPostgresql16() {
        POSTGRESQL.stop();
    }

    @BeforeEach
    void resetFacts() {
        jdbc.getJdbcTemplate().execute("""
                TRUNCATE TABLE
                    inventory_manual_configuration_commands,
                    inventory_manual_movement_settings,
                    inventory_manual_movement_types,
                    inventory_manual_movement_commands,
                    inventory_manual_movement_events,
                    inventory_manual_sku_price_snapshots,
                    inventory_manual_movement_lines,
                    inventory_manual_movements,
                    inventory_command_idempotency,
                    inventory_balances,
                    inventory_ledger_events,
                    audit_logs
                RESTART IDENTITY CASCADE
                """);
        jdbc.update(
                """
                UPDATE tenant_product_skus SET status = 'ACTIVE'
                WHERE id IN (:ids)
                """,
                Map.of("ids", Set.of(SKU_A, SKU_B)));
        jdbc.update(
                """
                UPDATE tenant_warehouses SET status = 'ACTIVE'
                WHERE id IN (:ids)
                """,
                Map.of("ids", Set.of(WAREHOUSE_A, WAREHOUSE_B)));
        jdbc.update(
                """
                UPDATE tenant_warehouse_locations SET status = 'ACTIVE'
                WHERE id IN (:ids)
                """,
                Map.of("ids", Set.of(LOCATION_A, LOCATION_B)));
        reset(scopeEvaluator);
        when(scopeEvaluator.evaluate(any(), any(), any()))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void v48CreatesCatalogOnlyPermissionsAndTenantCompositeConstraints()
            throws Exception {
        try (Connection connection = DriverManager.getConnection(
                        jdbcUrl, DB_USER, DB_PASSWORD);
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("""
                        SELECT
                          (SELECT count(*) FROM flyway_schema_history
                           WHERE version = '48' AND success) AS v48,
                          (SELECT count(*) FROM permissions
                           WHERE code IN (
                             'inventory.manual.write',
                             'inventory.manual.post',
                             'inventory.reverse',
                             'inventory.manual.approve',
                             'inventory.manual.configure'
                           )) AS permissions,
                          (SELECT count(*) FROM role_permissions rp
                           JOIN permissions p ON p.id = rp.permission_id
                           WHERE p.code IN (
                             'inventory.manual.write',
                             'inventory.manual.post',
                             'inventory.reverse',
                             'inventory.manual.approve',
                             'inventory.manual.configure'
                           )) AS grants
                        """)) {
            assertThat(result.next()).isTrue();
            assertThat(result.getInt("v48")).isOne();
            assertThat(result.getInt("permissions")).isEqualTo(5);
            assertThat(result.getInt("grants")).isZero();
        }

        UUID movementId = createDraft(
                ManualMovementDirection.INBOUND,
                ManualMovementReasonCode.FOUND_STOCK,
                1,
                UUID.randomUUID()).movementId();
        assertThatThrownBy(() -> jdbc.update(
                """
                UPDATE inventory_manual_movement_lines
                SET warehouse_id = :warehouseB,
                    location_id = :locationB
                WHERE tenant_id = :tenantA
                  AND movement_id = :movementId
                """,
                new MapSqlParameterSource()
                        .addValue("warehouseB", WAREHOUSE_B)
                        .addValue("locationB", LOCATION_B)
                        .addValue("tenantA", TENANT_A)
                        .addValue("movementId", movementId)))
                .hasRootCauseInstanceOf(java.sql.SQLException.class);

        var operatorSearch = service.list(
                actor("search-operator"),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                ManualMovementSearchField.OPERATOR,
                null,
                "Manual A",
                null,
                null,
                PageRequest.of(0, 20));
        assertThat(operatorSearch.getTotalElements()).isOne();
        assertThat(operatorSearch.getContent().getFirst().id())
                .isEqualTo(movementId);
    }

    @Test
    void inboundAndOutboundPostAtomicallyUpdateRealSignedBalances() {
        Mutation inbound = createDraft(
                ManualMovementDirection.INBOUND,
                ManualMovementReasonCode.FOUND_STOCK,
                5,
                UUID.randomUUID());
        Mutation submittedInbound = submitDraft(inbound);
        Mutation postedInbound = inTransaction(() -> service.post(
                actor("post-inbound"),
                inbound.movementId(),
                new Transition(
                        submittedInbound.version(),
                        UUID.randomUUID())));
        assertThat(postedInbound.status())
                .isEqualTo(ManualMovementStatus.POSTED);
        assertThat(onHand()).isEqualTo(5);

        Mutation outbound = createDraft(
                ManualMovementDirection.OUTBOUND,
                ManualMovementReasonCode.DAMAGED_STOCK,
                12,
                UUID.randomUUID());
        Mutation submittedOutbound = submitDraft(outbound);
        inTransaction(() -> service.post(
                actor("post-outbound"),
                outbound.movementId(),
                new Transition(
                        submittedOutbound.version(),
                        UUID.randomUUID())));

        assertThat(onHand()).isEqualTo(-7);
        assertThat(count("inventory_ledger_events")).isEqualTo(2);
        assertThat(count("audit_logs")).isEqualTo(8);
        var balance = inventory.listBalances(
                        new InventoryActor(
                                TENANT_A,
                                USER_A,
                                null,
                                "balance-read",
                                "127.0.0.1"),
                        WAREHOUSE_A,
                        SKU_A,
                        null,
                        PageRequest.of(0, 20))
                .getContent()
                .getFirst();
        assertThat(balance.available()).isEqualTo(balance.onHand());
    }

    @Test
    void sameCommandReplaysAndDifferentFingerprintConflicts() {
        UUID commandId = UUID.randomUUID();
        Mutation first = createDraft(
                ManualMovementDirection.INBOUND,
                ManualMovementReasonCode.FOUND_STOCK,
                3,
                commandId);
        Mutation replay = createDraft(
                ManualMovementDirection.INBOUND,
                ManualMovementReasonCode.FOUND_STOCK,
                3,
                commandId);

        assertThat(replay.movementId()).isEqualTo(first.movementId());
        assertThat(replay.replayed()).isTrue();
        assertThat(count("inventory_manual_movements")).isOne();
        assertThat(count("audit_logs")).isOne();

        assertThatThrownBy(() -> createDraft(
                ManualMovementDirection.INBOUND,
                ManualMovementReasonCode.FOUND_STOCK,
                4,
                commandId))
                .isInstanceOf(ManualMovementConflictException.class)
                .extracting("reason")
                .isEqualTo("idempotency_conflict");
    }

    @Test
    void concurrentPostAllowsOneLedgerMutationWithoutLostUpdate()
            throws Exception {
        Mutation draft = createDraft(
                ManualMovementDirection.OUTBOUND,
                ManualMovementReasonCode.LOST_STOCK,
                9,
                UUID.randomUUID());
        Mutation submitted = submitDraft(draft);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = executor.submit(() ->
                    concurrentPost(start, submitted, "post-a"));
            var second = executor.submit(() ->
                    concurrentPost(start, submitted, "post-b"));
            start.countDown();
            List<Object> results = List.of(
                    first.get(20, TimeUnit.SECONDS),
                    second.get(20, TimeUnit.SECONDS));

            assertThat(results.stream()
                    .filter(Mutation.class::isInstance)).hasSize(1);
            assertThat(results.stream()
                    .filter(ManualMovementConflictException.class::isInstance))
                    .hasSize(1);
        }
        assertThat(onHand()).isEqualTo(-9);
        assertThat(count("inventory_ledger_events")).isOne();
        assertThat(count("inventory_manual_movement_events")).isEqualTo(3);
    }

    @Test
    void reversalRestoresBalanceAndCannotBeRepeated() {
        Mutation draft = createDraft(
                ManualMovementDirection.INBOUND,
                ManualMovementReasonCode.OTHER,
                8,
                UUID.randomUUID());
        Mutation submitted = submitDraft(draft);
        Mutation posted = inTransaction(() -> service.post(
                actor("post-reverse"),
                draft.movementId(),
                new Transition(submitted.version(), UUID.randomUUID())));
        Mutation reversed = inTransaction(() -> service.reverse(
                actor("reverse-once"),
                draft.movementId(),
                new Transition(posted.version(), UUID.randomUUID())));

        assertThat(reversed.status())
                .isEqualTo(ManualMovementStatus.REVERSED);
        assertThat(onHand()).isZero();
        assertThat(count("inventory_ledger_events")).isEqualTo(2);
        assertThat(jdbc.queryForObject(
                """
                SELECT count(*) FROM inventory_ledger_events
                WHERE reversal_of_event_id IS NOT NULL
                """,
                Map.of(),
                Long.class)).isOne();

        assertThatThrownBy(() -> inTransaction(() -> service.reverse(
                actor("reverse-twice"),
                draft.movementId(),
                new Transition(reversed.version(), UUID.randomUUID()))))
                .isInstanceOf(ManualMovementConflictException.class)
                .extracting("reason")
                .isEqualTo("illegal_transition");
        assertThat(count("inventory_ledger_events")).isEqualTo(2);
    }

    @Test
    void crossTenantScopeAndInactiveReferencesFailClosed() {
        Mutation draft = createDraft(
                ManualMovementDirection.INBOUND,
                ManualMovementReasonCode.FOUND_STOCK,
                2,
                UUID.randomUUID());
        assertThatThrownBy(() -> inTransaction(() -> service.get(
                new ManualMovementActor(
                        TENANT_B, USER_B, null, "Tenant B user",
                        null, "127.0.0.1"),
                draft.movementId())))
                .isInstanceOf(ResourceNotFoundException.class);

        doThrow(new ResourceNotFoundException("not found"))
                .when(scopeEvaluator)
                .requireVisible(any(), org.mockito.ArgumentMatchers.eq(
                        WAREHOUSE_A));
        assertThatThrownBy(() -> inTransaction(() -> service.get(
                actor(null), draft.movementId())))
                .isInstanceOf(ResourceNotFoundException.class);
        reset(scopeEvaluator);
        when(scopeEvaluator.evaluate(any(), any(), any()))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));

        Mutation submitted = submitDraft(draft);
        jdbc.update(
                """
                UPDATE tenant_product_skus
                SET status = 'ARCHIVED'
                WHERE id = :skuId
                """,
                Map.of("skuId", SKU_A));
        assertThatThrownBy(() -> inTransaction(() -> service.post(
                actor("inactive-post"),
                draft.movementId(),
                new Transition(submitted.version(), UUID.randomUUID()))))
                .isInstanceOf(ManualMovementConflictException.class)
                .extracting("reason")
                .isEqualTo("inactive_master_data");
        assertThat(count("inventory_ledger_events")).isZero();
    }

    @Test
    void approvalGateAndConfigurationIdempotencyArePersistent() {
        UUID settingsCommandId = UUID.randomUUID();
        var settings = inTransaction(() -> service.saveSettings(
                actor("settings"),
                ManualMovementDirection.INBOUND,
                true,
                false,
                true,
                "UPDATE_SNAPSHOT",
                true,
                0,
                settingsCommandId));
        var replay = inTransaction(() -> service.saveSettings(
                actor("settings-replay"),
                ManualMovementDirection.INBOUND,
                true,
                false,
                true,
                "UPDATE_SNAPSHOT",
                true,
                0,
                settingsCommandId));
        assertThat(replay).isEqualTo(settings);
        assertThat(settings.contactInformationRequired()).isTrue();
        assertThat(count(
                "inventory_manual_configuration_commands")).isOne();

        assertThatThrownBy(() -> inTransaction(() -> service.saveSettings(
                actor("settings-conflict"),
                ManualMovementDirection.INBOUND,
                false,
                false,
                true,
                "UPDATE_SNAPSHOT",
                true,
                0,
                settingsCommandId)))
                .isInstanceOf(ManualMovementConflictException.class)
                .extracting("reason")
                .isEqualTo("idempotency_conflict");

        Save missingContact = withoutContact(save(
                ManualMovementDirection.INBOUND,
                ManualMovementReasonCode.FOUND_STOCK,
                1,
                UUID.randomUUID()));
        Mutation missingContactDraft = inTransaction(() ->
                service.create(actor("missing-contact"), missingContact));
        assertThatThrownBy(() -> inTransaction(() -> service.submit(
                actor("missing-contact-submit"),
                missingContactDraft.movementId(),
                new Transition(
                        missingContactDraft.version(),
                        UUID.randomUUID()))))
                .isInstanceOf(IllegalArgumentException.class);

        Mutation draft = createDraft(
                ManualMovementDirection.INBOUND,
                ManualMovementReasonCode.FOUND_STOCK,
                4,
                UUID.randomUUID());
        jdbc.update(
                """
                UPDATE inventory_manual_movement_lines
                SET unit_price = 12.5000, currency = 'CNY'
                WHERE tenant_id = :tenantId
                  AND movement_id = :movementId
                """,
                Map.of(
                        "tenantId", TENANT_A,
                        "movementId", draft.movementId()));
        Mutation submitted = submitDraft(draft);
        assertThat(submitted.status())
                .isEqualTo(ManualMovementStatus.SUBMITTED);
        assertThatThrownBy(() -> inTransaction(() -> service.post(
                actor("post-before-approval"),
                draft.movementId(),
                new Transition(
                        submitted.version(), UUID.randomUUID()))))
                .isInstanceOf(ManualMovementConflictException.class)
                .extracting("reason")
                .isEqualTo("approval_required");
        Mutation approved = inTransaction(() -> service.review(
                actor("approve"),
                draft.movementId(),
                new Review(
                        submitted.version(),
                        UUID.randomUUID(),
                        true,
                        null)));
        Mutation posted = inTransaction(() -> service.post(
                actor("post-approved"),
                draft.movementId(),
                new Transition(approved.version(), UUID.randomUUID())));
        assertThat(posted.status())
                .isEqualTo(ManualMovementStatus.POSTED);
        assertThat(onHand()).isEqualTo(4);
        assertThat(jdbc.queryForObject(
                """
                SELECT unit_price
                FROM inventory_manual_sku_price_snapshots
                WHERE tenant_id = :tenantId
                  AND sku_id = :skuId
                  AND direction = 'INBOUND'
                """,
                Map.of("tenantId", TENANT_A, "skuId", SKU_A),
                BigDecimal.class))
                .isEqualByComparingTo("12.5000");

        Mutation rejectedDraft = createDraft(
                ManualMovementDirection.INBOUND,
                ManualMovementReasonCode.FOUND_STOCK,
                2,
                UUID.randomUUID());
        Mutation pendingRejection = submitDraft(rejectedDraft);
        Mutation rejected = inTransaction(() -> service.review(
                actor("reject"),
                rejectedDraft.movementId(),
                new Review(
                        pendingRejection.version(),
                        UUID.randomUUID(),
                        false,
                        "箱清单需要复核")));
        assertThat(rejected.status()).isEqualTo(ManualMovementStatus.DRAFT);
        var rejectedDetail = inTransaction(() -> service.get(
                actor("read-rejection"),
                rejectedDraft.movementId()));
        assertThat(rejectedDetail.summary().approvalStatus())
                .isEqualTo(ManualMovementApprovalStatus.REJECTED);
        assertThat(rejectedDetail.summary().reviewNote())
                .isEqualTo("箱清单需要复核");
    }

    @Test
    void boxedInboundOutboundAndReversalPreserveCompositionAndBalance() {
        Mutation inbound = inTransaction(() -> service.create(
                actor("box-in-create"),
                boxedSave(
                        ManualMovementDirection.INBOUND,
                        null,
                        2,
                        2,
                        UUID.randomUUID())));
        Mutation submittedInbound = submitDraft(inbound);
        Mutation postedInbound = inTransaction(() -> service.post(
                actor("box-in-post"),
                inbound.movementId(),
                new Transition(
                        submittedInbound.version(),
                        UUID.randomUUID())));
        UUID stockId = jdbc.queryForObject(
                """
                SELECT id FROM inventory_manual_box_stock
                WHERE tenant_id = :tenantId
                  AND source_movement_id = :movementId
                """,
                Map.of(
                        "tenantId", TENANT_A,
                        "movementId", inbound.movementId()),
                UUID.class);
        assertThat(stockId).isNotNull();
        assertThat(boxAvailable(stockId)).isEqualTo(2);
        assertThat(onHand()).isEqualTo(4);

        Mutation outbound = inTransaction(() -> service.create(
                actor("box-out-create"),
                boxedSave(
                        ManualMovementDirection.OUTBOUND,
                        stockId,
                        1,
                        2,
                        UUID.randomUUID())));
        Mutation submittedOutbound = submitDraft(outbound);
        Mutation postedOutbound = inTransaction(() -> service.post(
                actor("box-out-post"),
                outbound.movementId(),
                new Transition(
                        submittedOutbound.version(),
                        UUID.randomUUID())));
        assertThat(boxAvailable(stockId)).isOne();
        assertThat(onHand()).isEqualTo(2);

        inTransaction(() -> service.reverse(
                actor("box-out-reverse"),
                outbound.movementId(),
                new Transition(
                        postedOutbound.version(),
                        UUID.randomUUID())));
        assertThat(boxAvailable(stockId)).isEqualTo(2);
        assertThat(onHand()).isEqualTo(4);

        Mutation invalid = inTransaction(() -> service.create(
                actor("box-invalid-create"),
                boxedSave(
                        ManualMovementDirection.OUTBOUND,
                        stockId,
                        1,
                        3,
                        UUID.randomUUID())));
        Mutation submittedInvalid = submitDraft(invalid);
        long ledgerBefore = count("inventory_ledger_events");
        assertThatThrownBy(() -> inTransaction(() -> service.post(
                actor("box-invalid-post"),
                invalid.movementId(),
                new Transition(
                        submittedInvalid.version(),
                        UUID.randomUUID()))))
                .isInstanceOf(ManualMovementConflictException.class)
                .extracting("reason")
                .isEqualTo("box_stock_insufficient");
        assertThat(count("inventory_ledger_events"))
                .isEqualTo(ledgerBefore);
        assertThat(boxAvailable(stockId)).isEqualTo(2);
        assertThat(postedInbound.status())
                .isEqualTo(ManualMovementStatus.POSTED);
    }

    @Test
    void everyManualWritePathHasCommittedAuditOrReviewedFailClosedEvidence() {
        inTransaction(() -> service.saveSettings(
                actor("audit-settings"),
                ManualMovementDirection.INBOUND,
                true,
                false,
                true,
                "NO_UPDATE",
                false,
                0,
                UUID.randomUUID()));
        inTransaction(() -> service.saveType(
                actor("audit-type"),
                null,
                ManualMovementDirection.INBOUND,
                "AUDIT_TYPE",
                "Audit type",
                "ACTIVE",
                0,
                UUID.randomUUID()));

        Mutation postedDraft = createDraft(
                ManualMovementDirection.INBOUND,
                ManualMovementReasonCode.FOUND_STOCK,
                3,
                UUID.randomUUID());
        Mutation updated = inTransaction(() -> service.update(
                actor("audit-update"),
                postedDraft.movementId(),
                save(
                        ManualMovementDirection.INBOUND,
                        ManualMovementReasonCode.FOUND_STOCK,
                        4,
                        UUID.randomUUID())));
        Mutation submitted = submitDraft(updated);
        Mutation approved = inTransaction(() -> service.review(
                actor("audit-approve"),
                submitted.movementId(),
                new Review(
                        submitted.version(),
                        UUID.randomUUID(),
                        true,
                        null)));
        Mutation posted = inTransaction(() -> service.batchPost(
                actor("audit-batch-post"),
                batch(approved, "audit-batch-post"))).getFirst();
        inTransaction(() -> service.reverse(
                actor("audit-reverse"),
                posted.movementId(),
                new Transition(posted.version(), UUID.randomUUID())));

        Mutation cancelledDraft = createDraft(
                ManualMovementDirection.OUTBOUND,
                ManualMovementReasonCode.LOST_STOCK,
                2,
                UUID.randomUUID());
        inTransaction(() -> service.batchCancel(
                actor("audit-batch-cancel"),
                batch(cancelledDraft, "audit-batch-cancel")));

        Mutation rejectedDraft = createDraft(
                ManualMovementDirection.INBOUND,
                ManualMovementReasonCode.FOUND_STOCK,
                1,
                UUID.randomUUID());
        Mutation pending = submitDraft(rejectedDraft);
        inTransaction(() -> service.batchReview(
                actor("audit-batch-review"),
                batch(pending, "audit-batch-review"),
                false));

        assertThat(manualAuditActions()).containsExactlyInAnyOrder(
                "inventory.manual.settings.updated",
                "inventory.manual.type.saved",
                "inventory.manual.created",
                "inventory.manual.updated",
                "inventory.manual.submitted",
                "inventory.manual.approved",
                "inventory.manual.posted",
                "inventory.manual.reversed",
                "inventory.manual.created",
                "inventory.manual.cancelled",
                "inventory.manual.created",
                "inventory.manual.submitted",
                "inventory.manual.rejected");
    }

    @Test
    void auditFailureRollsBackDocumentLedgerBalanceAndTimeline() {
        SecurityAuditRecorder failingAudit = mock(SecurityAuditRecorder.class);
        doThrow(new IllegalStateException("audit unavailable"))
                .when(failingAudit)
                .recordAtomically(any());
        InventoryService inventory = new InventoryService(
                new InventoryStore(jdbc), scopeEvaluator, failingAudit);
        ManualMovementService failingService = new ManualMovementService(
                new ManualMovementStore(jdbc),
                new ManualMovementWorkflowStore(jdbc),
                inventory,
                scopeEvaluator,
                failingAudit);
        Save command = save(
                ManualMovementDirection.INBOUND,
                ManualMovementReasonCode.FOUND_STOCK,
                1,
                UUID.randomUUID());

        assertThatThrownBy(() -> inTransaction(() ->
                failingService.create(actor("audit-failure"), command)))
                .isInstanceOf(IllegalStateException.class);
        assertThat(count("inventory_manual_movements")).isZero();
        assertThat(count("inventory_manual_movement_events")).isZero();
        assertThat(count("inventory_manual_movement_commands")).isZero();
        assertThat(count("inventory_ledger_events")).isZero();
        assertThat(count("inventory_balances")).isZero();
    }

    private static Object concurrentPost(
            CountDownLatch start, Mutation draft, String requestId)
            throws InterruptedException {
        start.await(10, TimeUnit.SECONDS);
        try {
            return inTransaction(() -> service.post(
                    actor(requestId),
                    draft.movementId(),
                    new Transition(draft.version(), UUID.randomUUID())));
        } catch (ManualMovementConflictException exception) {
            return exception;
        }
    }

    private static Mutation createDraft(
            ManualMovementDirection direction,
            ManualMovementReasonCode reason,
            long quantity,
            UUID commandId) {
        return inTransaction(() -> service.create(
                actor("create-" + commandId),
                save(direction, reason, quantity, commandId)));
    }

    private static Mutation submitDraft(Mutation draft) {
        return inTransaction(() -> service.submit(
                actor("submit-" + draft.movementId()),
                draft.movementId(),
                new Transition(draft.version(), UUID.randomUUID())));
    }

    private static Batch batch(Mutation movement, String note) {
        return new Batch(
                List.of(new BatchItem(
                        movement.movementId(),
                        movement.version())),
                UUID.randomUUID(),
                note);
    }

    private static Save save(
            ManualMovementDirection direction,
            ManualMovementReasonCode reason,
            long quantity,
            UUID commandId) {
        return new Save(
                WAREHOUSE_A,
                direction,
                null,
                reason,
                ManualMovementSource.MANUAL,
                ManualMovementEntryMode.PRODUCT,
                "safe note",
                "SOURCE-1",
                "测试联系人",
                "010-12345678",
                "测试园区 1 号",
                Map.of(),
                List.of(new LineInput(
                        SKU_A,
                        LOCATION_A,
                        quantity,
                        null,
                        null,
                        Map.of(),
                        "line note")),
                List.of(),
                0,
                commandId);
    }

    private static Save boxedSave(
            ManualMovementDirection direction,
            UUID sourceBoxStockId,
            int boxCount,
            long quantityPerBox,
            UUID commandId) {
        long totalQuantity = Math.multiplyExact(boxCount, quantityPerBox);
        return new Save(
                WAREHOUSE_A,
                direction,
                null,
                direction == ManualMovementDirection.INBOUND
                        ? ManualMovementReasonCode.FOUND_STOCK
                        : ManualMovementReasonCode.DAMAGED_STOCK,
                ManualMovementSource.MANUAL,
                ManualMovementEntryMode.BOX,
                "box movement note",
                "BOX-" + commandId.toString().substring(0, 8),
                "测试联系人",
                "010-12345678",
                "测试园区 1 号",
                Map.of("batch", "gate"),
                List.of(new LineInput(
                        SKU_A,
                        LOCATION_A,
                        totalQuantity,
                        null,
                        null,
                        Map.of("quality", "checked"),
                        "box line")),
                List.of(new BoxInput(
                        sourceBoxStockId,
                        "BOX-" + commandId.toString().substring(0, 8),
                        boxCount,
                        boxCount > 1
                                ? "UNIQUE_NUMBER"
                                : "SHARED_NUMBER",
                        BigDecimal.TEN,
                        BigDecimal.TEN,
                        BigDecimal.TEN,
                        BigDecimal.ONE,
                        List.of(new BoxItemInput(
                                SKU_A,
                                quantityPerBox)))),
                0,
                commandId);
    }

    private static Save withoutContact(Save source) {
        return new Save(
                source.warehouseId(),
                source.direction(),
                source.movementTypeId(),
                source.reasonCode(),
                source.source(),
                source.entryMode(),
                source.note(),
                source.sourceReference(),
                null,
                null,
                null,
                source.extensionAttributes(),
                source.lines(),
                source.boxes(),
                source.expectedVersion(),
                source.commandId());
    }

    private static ManualMovementActor actor(String requestId) {
        return new ManualMovementActor(
                TENANT_A, USER_A, null, "Test user", requestId, "127.0.0.1");
    }

    private static long onHand() {
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

    private static long boxAvailable(UUID stockId) {
        Integer value = jdbc.queryForObject(
                """
                SELECT available_count
                FROM inventory_manual_box_stock
                WHERE tenant_id = :tenantId
                  AND id = :stockId
                """,
                Map.of("tenantId", TENANT_A, "stockId", stockId),
                Integer.class);
        return value == null ? 0 : value.longValue();
    }

    private static long count(String table) {
        Set<String> allowed = Set.of(
                "inventory_manual_movements",
                "inventory_manual_movement_events",
                "inventory_manual_movement_commands",
                "inventory_manual_configuration_commands",
                "inventory_ledger_events",
                "inventory_balances",
                "audit_logs");
        if (!allowed.contains(table)) {
            throw new IllegalArgumentException("Unexpected table");
        }
        Long count = jdbc.getJdbcTemplate().queryForObject(
                "SELECT count(*) FROM " + table, Long.class);
        return count == null ? 0 : count;
    }

    private static List<String> manualAuditActions() {
        return jdbc.getJdbcTemplate().queryForList(
                """
                SELECT action
                FROM audit_logs
                WHERE action LIKE 'inventory.manual.%'
                ORDER BY action
                """,
                String.class);
    }

    private static <T> T inTransaction(java.util.function.Supplier<T> action) {
        return transaction.execute(status -> action.get());
    }

    private static void seedMasterData() {
        jdbc.update(
                """
                INSERT INTO tenants (id, code, name) VALUES
                  (:tenantA, 'manual_a', 'Manual A'),
                  (:tenantB, 'manual_b', 'Manual B')
                """,
                Map.of("tenantA", TENANT_A, "tenantB", TENANT_B));
        jdbc.update(
                """
                INSERT INTO users (
                    id, tenant_id, username, display_name, status
                ) VALUES
                  (:userA, :tenantA, 'manual_a', 'Manual A', 'ACTIVE'),
                  (:userB, :tenantB, 'manual_b', 'Manual B', 'ACTIVE')
                """,
                Map.of(
                        "userA", USER_A,
                        "tenantA", TENANT_A,
                        "userB", USER_B,
                        "tenantB", TENANT_B));
        jdbc.update(
                """
                INSERT INTO tenant_product_spus (
                    id, tenant_id, business_code, name
                ) VALUES
                  ('a4700000-0000-4000-8000-000000000040',
                   :tenantA, 'SPU_A', 'SPU A'),
                  ('a4700000-0000-4000-8000-000000000041',
                   :tenantB, 'SPU_B', 'SPU B')
                """,
                Map.of("tenantA", TENANT_A, "tenantB", TENANT_B));
        jdbc.update(
                """
                INSERT INTO tenant_product_skus (
                    id, tenant_id, spu_id, business_code, name
                ) VALUES
                  (:skuA, :tenantA,
                   'a4700000-0000-4000-8000-000000000040',
                   'SKU_A', 'SKU A'),
                  (:skuB, :tenantB,
                   'a4700000-0000-4000-8000-000000000041',
                   'SKU_B', 'SKU B')
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
        jdbc.update(
                """
                INSERT INTO tenant_warehouse_locations (
                    id, tenant_id, warehouse_id, business_code, name
                ) VALUES
                  (:locationA, :tenantA, :warehouseA, 'A-01', 'A-01'),
                  (:locationB, :tenantB, :warehouseB, 'B-01', 'B-01')
                """,
                new MapSqlParameterSource()
                        .addValue("locationA", LOCATION_A)
                        .addValue("tenantA", TENANT_A)
                        .addValue("warehouseA", WAREHOUSE_A)
                        .addValue("locationB", LOCATION_B)
                        .addValue("tenantB", TENANT_B)
                        .addValue("warehouseB", WAREHOUSE_B));
    }

    private static void startPostgresql16() throws Exception {
        POSTGRESQL.start();
        jdbcUrl = POSTGRESQL.getJdbcUrl();
        assertThat(POSTGRESQL.getDatabaseName())
                .isEqualTo("erp_manual_v47");
    }

    private record JdbcAuditRecorder(
            NamedParameterJdbcTemplate jdbc)
            implements SecurityAuditRecorder {
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
                        CAST(:sourceIp AS inet), CAST(:details AS jsonb)
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
                            .addValue("sourceIp", event.sourceIp())
                            .addValue("details", "{}"));
        }
    }
}
