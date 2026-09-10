package cn.xzkj.erp.warehouse.operations.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeMode;
import cn.xzkj.erp.inventory.service.InventoryService;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementApprovalStatus;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementDirection;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementEntryMode;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementReasonCode;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementSearchField;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementSource;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementStatus;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementTimeBucket;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementWmsStatus;
import cn.xzkj.erp.warehouse.operations.repository.ManualMovementStore;
import cn.xzkj.erp.warehouse.operations.repository.ManualMovementWorkflowStore;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.LineInput;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.Review;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementCommands.Save;
import cn.xzkj.erp.warehouse.operations.service.ManualMovementViews.Summary;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.PageImpl;

class ManualMovementServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID WAREHOUSE_ID = UUID.randomUUID();
    private static final UUID SKU_ID = UUID.randomUUID();
    private static final UUID LOCATION_ID = UUID.randomUUID();

    private ManualMovementStore store;
    private ManualMovementWorkflowStore workflowStore;
    private InventoryService inventoryService;
    private WarehouseScopeEvaluator scopeEvaluator;
    private SecurityAuditRecorder auditRecorder;
    private ManualMovementService service;

    @BeforeEach
    void setUp() {
        store = mock(ManualMovementStore.class);
        workflowStore = mock(ManualMovementWorkflowStore.class);
        inventoryService = mock(InventoryService.class);
        scopeEvaluator = mock(WarehouseScopeEvaluator.class);
        auditRecorder = mock(SecurityAuditRecorder.class);
        service = new ManualMovementService(
                store,
                workflowStore,
                inventoryService,
                scopeEvaluator,
                auditRecorder);
    }

    @Test
    void emptySelectedWarehouseScopeReturnsAnEmptyPageWithoutRepositoryRead() {
        when(scopeEvaluator.evaluate(
                TENANT_ID,
                USER_ID,
                null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED,
                        Set.of()));

        var result = service.list(
                actor(),
                null,
                ManualMovementDirection.INBOUND,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                PageRequest.of(0, 25));

        assertThat(result).isEmpty();
        verifyNoInteractions(store);
    }

    @Test
    void exportsAllFilteredVisibleMovementsAndEscapesFormulaCells() {
        Instant createdFrom = Instant.parse("2026-08-01T00:00:00Z");
        Instant createdTo = Instant.parse("2026-08-02T23:59:59Z");
        PageRequest pageable = PageRequest.of(
                0, ManualMovementService.MAX_EXPORT_ROWS + 1);
        when(scopeEvaluator.evaluate(TENANT_ID, USER_ID, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
        when(store.list(
                TENANT_ID, Set.of(), true, WAREHOUSE_ID,
                ManualMovementDirection.INBOUND, ManualMovementStatus.DRAFT,
                ManualMovementReasonCode.FOUND_STOCK, null,
                ManualMovementSource.MANUAL,
                ManualMovementWmsStatus.NOT_CONFIGURED,
                ManualMovementApprovalStatus.NOT_REQUIRED,
                ManualMovementSearchField.BATCH_NO,
                ManualMovementTimeBucket.RECENT_THREE_MONTHS,
                "batch", createdFrom, createdTo, pageable))
                .thenReturn(new PageImpl<>(
                        List.of(summary(" =SUM(A1)")), pageable, 1));

        var result = service.exportCsv(
                actor(), WAREHOUSE_ID, ManualMovementDirection.INBOUND,
                ManualMovementStatus.DRAFT,
                ManualMovementReasonCode.FOUND_STOCK, null,
                ManualMovementSource.MANUAL,
                ManualMovementWmsStatus.NOT_CONFIGURED,
                ManualMovementApprovalStatus.NOT_REQUIRED,
                ManualMovementSearchField.BATCH_NO,
                ManualMovementTimeBucket.RECENT_THREE_MONTHS,
                " Batch ", createdFrom, createdTo);

        assertThat(result.filename()).isEqualTo("manual-movements-inbound.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=utf-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content())
                .startsWith("\uFEFF批次编号,方向,仓库编码,仓库名称,类型,来源,")
                .contains("MI-100,手工入库,WH-A,' =SUM(A1),盘盈或发现库存,")
                .contains("3,0,12.3400,CNY,创建人,,草稿,2026-08-02T01:02:03Z\r\n");
    }

    @Test
    void rejectsMovementExportsAboveTheBoundedRowLimit() {
        PageRequest pageable = PageRequest.of(
                0, ManualMovementService.MAX_EXPORT_ROWS + 1);
        when(scopeEvaluator.evaluate(TENANT_ID, USER_ID, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
        when(store.list(
                TENANT_ID, Set.of(), true, null, null, null, null, null,
                null, null, null, null, null, null, null, null, pageable))
                .thenReturn(new PageImpl<>(
                        List.of(), pageable,
                        ManualMovementService.MAX_EXPORT_ROWS + 1L));

        assertThatThrownBy(() -> service.exportCsv(
                actor(), null, null, null, null, null, null, null,
                null, null, null, null, null, null))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void rejectsReasonThatDoesNotMatchDirectionBeforePersistence() {
        assertThatThrownBy(() -> service.create(
                actor(),
                save(
                        ManualMovementDirection.OUTBOUND,
                        ManualMovementReasonCode.FOUND_STOCK)))
                .isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(store, inventoryService, auditRecorder);
    }

    @Test
    void rejectsProductEntryWithBoxesBeforePersistence() {
        Save command = new Save(
                WAREHOUSE_ID,
                ManualMovementDirection.INBOUND,
                null,
                ManualMovementReasonCode.FOUND_STOCK,
                ManualMovementSource.MANUAL,
                ManualMovementEntryMode.PRODUCT,
                "safe",
                null,
                null,
                null,
                null,
                Map.of(),
                List.of(line()),
                List.of(new ManualMovementCommands.BoxInput(
                        null,
                        "BOX-1",
                        1,
                        "SHARED_NUMBER",
                        java.math.BigDecimal.ONE,
                        java.math.BigDecimal.ONE,
                        java.math.BigDecimal.ONE,
                        java.math.BigDecimal.ONE,
                        List.of(new ManualMovementCommands.BoxItemInput(
                                SKU_ID,
                                1)))),
                0,
                UUID.randomUUID());

        assertThatThrownBy(() -> service.create(actor(), command))
                .isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(store, inventoryService, auditRecorder);
    }

    @Test
    void requiresAStableCommandAndNonEmptyLines() {
        Save command = new Save(
                WAREHOUSE_ID,
                ManualMovementDirection.INBOUND,
                null,
                ManualMovementReasonCode.FOUND_STOCK,
                ManualMovementSource.MANUAL,
                ManualMovementEntryMode.PRODUCT,
                "safe",
                null,
                null,
                null,
                null,
                Map.of(),
                List.of(),
                List.of(),
                0,
                null);

        assertThatThrownBy(() -> service.create(actor(), command))
                .isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(store, inventoryService, auditRecorder);
    }

    @Test
    void rejectionRequiresAReasonBeforePersistence() {
        assertThatThrownBy(() -> service.review(
                actor(),
                UUID.randomUUID(),
                new Review(
                        0,
                        UUID.randomUUID(),
                        false,
                        "   ")))
                .isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(store, inventoryService, auditRecorder);
    }

    private static Save save(
            ManualMovementDirection direction,
            ManualMovementReasonCode reason) {
        return new Save(
                WAREHOUSE_ID,
                direction,
                null,
                reason,
                ManualMovementSource.MANUAL,
                ManualMovementEntryMode.PRODUCT,
                "safe",
                null,
                null,
                null,
                null,
                Map.of(),
                List.of(line()),
                List.of(),
                0,
                UUID.randomUUID());
    }

    private static LineInput line() {
        return new LineInput(
                SKU_ID,
                LOCATION_ID,
                1,
                null,
                null,
                Map.of(),
                null);
    }

    private static ManualMovementActor actor() {
        return new ManualMovementActor(
                TENANT_ID,
                USER_ID,
                null,
                "Test user",
                "request-1",
                "127.0.0.1");
    }

    private static Summary summary(String warehouseName) {
        Instant now = Instant.parse("2026-08-02T01:02:03Z");
        return new Summary(
                UUID.randomUUID(),
                "MI-100",
                ManualMovementDirection.INBOUND,
                ManualMovementStatus.DRAFT,
                WAREHOUSE_ID,
                "WH-A",
                warehouseName,
                null,
                null,
                ManualMovementReasonCode.FOUND_STOCK,
                ManualMovementSource.MANUAL,
                ManualMovementWmsStatus.NOT_CONFIGURED,
                ManualMovementApprovalStatus.NOT_REQUIRED,
                ManualMovementEntryMode.PRODUCT,
                null,
                null,
                Map.of(),
                1,
                3,
                0,
                new BigDecimal("12.3400"),
                "CNY",
                0,
                "创建人",
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                now,
                now);
    }
}
