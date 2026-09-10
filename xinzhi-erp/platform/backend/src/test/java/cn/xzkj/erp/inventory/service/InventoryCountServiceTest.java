package cn.xzkj.erp.inventory.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeMode;
import cn.xzkj.erp.inventory.domain.InventoryCountStatus;
import cn.xzkj.erp.inventory.domain.InventoryEventType;
import cn.xzkj.erp.inventory.repository.InventoryCountRepository;
import cn.xzkj.erp.platform.service.ConflictException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

class InventoryCountServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID WAREHOUSE_ID = UUID.randomUUID();
    private static final UUID BALANCE_ID = UUID.randomUUID();
    private static final UUID SKU_ID = UUID.randomUUID();

    private InventoryCountRepository repository;
    private InventoryService inventoryService;
    private WarehouseScopeEvaluator scopeEvaluator;
    private SecurityAuditRecorder auditRecorder;
    private InventoryCountService service;

    @BeforeEach
    void setUp() {
        repository = mock(InventoryCountRepository.class);
        inventoryService = mock(InventoryService.class);
        scopeEvaluator = mock(WarehouseScopeEvaluator.class);
        auditRecorder = mock(SecurityAuditRecorder.class);
        service = new InventoryCountService(
                repository, inventoryService, scopeEvaluator, auditRecorder);
        when(scopeEvaluator.evaluate(TENANT_ID, USER_ID, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void createsSnapshotLinesFromAuthoritativeBalances() {
        InventoryBalanceView balance = balance();
        InventoryCountDetail detail = detail(InventoryCountStatus.PENDING, 0, null);
        when(inventoryService.getBalance(any(), eq(BALANCE_ID)))
                .thenReturn(balance);
        when(repository.findCommand(eq(TENANT_ID), any()))
                .thenReturn(Optional.empty());
        when(repository.insertBatch(
                any(), eq(TENANT_ID), anyString(), eq(WAREHOUSE_ID),
                eq(LocalDate.of(2026, 8, 1)), isNull(), eq("Operator"),
                eq(USER_ID), isNull()))
                .thenReturn(detail.summary());
        when(repository.find(eq(TENANT_ID), any()))
                .thenReturn(Optional.of(detail));

        InventoryCountDetail result = service.create(
                actor(),
                UUID.randomUUID(),
                WAREHOUSE_ID,
                LocalDate.of(2026, 8, 1),
                null,
                false,
                List.of(new InventoryCountService.LineInput(BALANCE_ID, 12)));

        assertThat(result).isSameAs(detail);
        verify(repository).insertLine(
                any(), eq(TENANT_ID), any(), eq(BALANCE_ID), eq(SKU_ID),
                eq(WAREHOUSE_ID), eq(3L), eq(10L), eq(1L), eq(12L));
        verify(auditRecorder).recordAtomically(any());
    }

    @Test
    void approvalUsesSnapshotVersionAndLinksResultEvent() {
        UUID countId = UUID.randomUUID();
        UUID lineId = UUID.randomUUID();
        UUID eventId = UUID.randomUUID();
        InventoryCountSummary approval = summary(
                countId, InventoryCountStatus.APPROVAL, 1, 2);
        InventoryCountLineView line = new InventoryCountLineView(
                lineId, BALANCE_ID, SKU_ID, "SKU-1", "Product",
                3, 10, 1, 9, 12, 2, null);
        InventoryCountDetail completed = new InventoryCountDetail(
                summary(countId, InventoryCountStatus.COMPLETED, 2, 2),
                List.of(new InventoryCountLineView(
                        lineId, BALANCE_ID, SKU_ID, "SKU-1", "Product",
                        3, 10, 1, 9, 12, 2, eventId)));
        when(repository.findCommand(eq(TENANT_ID), any()))
                .thenReturn(Optional.empty());
        when(repository.lock(TENANT_ID, countId))
                .thenReturn(Optional.of(approval));
        when(repository.listLines(TENANT_ID, countId))
                .thenReturn(List.of(line));
        when(inventoryService.adjust(
                any(), eq(InventoryEventType.CORRECTION), eq(SKU_ID),
                eq(WAREHOUSE_ID), eq(2L), eq(3L),
                eq("INVENTORY_COUNT"), anyString(), anyString()))
                .thenReturn(mutation(eventId));
        when(repository.transition(
                eq(TENANT_ID), eq(countId), eq(1L),
                eq(InventoryCountStatus.APPROVAL),
                eq(InventoryCountStatus.COMPLETED),
                eq("Operator"), eq(USER_ID), isNull()))
                .thenReturn(1);
        when(repository.find(TENANT_ID, countId))
                .thenReturn(Optional.of(completed));

        InventoryCountDetail result = service.approve(
                actor(), countId, UUID.randomUUID(), 1);

        assertThat(result.summary().status())
                .isEqualTo(InventoryCountStatus.COMPLETED);
        verify(repository).setResultEvent(TENANT_ID, lineId, eventId);
        verify(inventoryService).adjust(
                any(), eq(InventoryEventType.CORRECTION), eq(SKU_ID),
                eq(WAREHOUSE_ID), eq(2L), eq(3L),
                eq("INVENTORY_COUNT"), anyString(),
                eq("count." + countId + "." + lineId));
    }

    @Test
    void exportsFilteredVisibleCountsAndEscapesFormulaCells() {
        PageRequest pageable = PageRequest.of(
                0, InventoryCountService.MAX_EXPORT_ROWS + 1);
        InventoryCountSummary source = new InventoryCountSummary(
                UUID.randomUUID(), "IC-20260801-00000000", WAREHOUSE_ID,
                "WH-1", "Warehouse", InventoryCountStatus.APPROVAL,
                LocalDate.of(2026, 8, 1), " =SUM(A1)", 1, -2, 1,
                "Operator", null, Instant.parse("2026-08-01T00:00:00Z"),
                Instant.parse("2026-08-01T01:00:00Z"));
        when(repository.list(
                TENANT_ID, Set.of(), true, null, InventoryCountStatus.APPROVAL,
                InventoryCountSearchField.SKU, "sku-1",
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 8, 1),
                -2L, 5L, pageable))
                .thenReturn(new PageImpl<>(List.of(source), pageable, 1));

        var result = service.exportCsv(
                actor(), null, InventoryCountStatus.APPROVAL,
                InventoryCountSearchField.SKU, " SKU-1 ",
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 8, 1),
                -2L, 5L);

        assertThat(result.filename()).isEqualTo("inventory-counts.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=utf-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content())
                .startsWith("\uFEFF盘点批次,仓库编码,仓库名称,状态,盘点日期,备注,")
                .contains("审批中,2026-08-01,' =SUM(A1),1,-2,Operator,");
    }

    @Test
    void rejectsCountExportsAboveTheBoundedRowLimit() {
        PageRequest pageable = PageRequest.of(
                0, InventoryCountService.MAX_EXPORT_ROWS + 1);
        when(repository.list(
                TENANT_ID, Set.of(), true, null, null,
                InventoryCountSearchField.BATCH, null, null, null,
                null, null, pageable))
                .thenReturn(new PageImpl<>(
                        List.of(), pageable,
                        InventoryCountService.MAX_EXPORT_ROWS + 1L));

        assertThatThrownBy(() -> service.exportCsv(
                actor(), null, null, InventoryCountSearchField.BATCH,
                null, null, null, null, null))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void exportsOnlyTheHeaderWhenActorHasNoWarehouseScope() {
        when(scopeEvaluator.evaluate(TENANT_ID, USER_ID, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, Set.of()));

        var result = service.exportCsv(
                actor(), null, null, InventoryCountSearchField.BATCH,
                null, null, null, null, null);

        assertThat(result.rowCount()).isZero();
        assertThat(result.content()).startsWith("\uFEFF盘点批次,");
        verify(repository, never()).list(
                any(), any(), anyBoolean(), any(), any(), any(), any(),
                any(), any(), any(), any(), any());
    }

    private static InventoryCountActor actor() {
        return new InventoryCountActor(
                TENANT_ID, USER_ID, null, "Operator",
                "count.request-1", "127.0.0.1");
    }

    private static InventoryBalanceView balance() {
        return new InventoryBalanceView(
                BALANCE_ID, SKU_ID, "SKU-1", "Product",
                WAREHOUSE_ID, "WH-1", "Warehouse", 10, 1, 3,
                Instant.parse("2026-08-01T00:00:00Z"));
    }

    private static InventoryCountDetail detail(
            InventoryCountStatus status, long version, UUID eventId) {
        UUID countId = UUID.randomUUID();
        return new InventoryCountDetail(
                summary(countId, status, version, 2),
                List.of(new InventoryCountLineView(
                        UUID.randomUUID(), BALANCE_ID, SKU_ID,
                        "SKU-1", "Product", 3, 10, 1, 9, 12, 2,
                        eventId)));
    }

    private static InventoryCountSummary summary(
            UUID id,
            InventoryCountStatus status,
            long version,
            long difference) {
        return new InventoryCountSummary(
                id, "IC-20260801-00000000", WAREHOUSE_ID, "WH-1",
                "Warehouse", status, LocalDate.of(2026, 8, 1), null,
                1, difference, version, "Operator",
                status == InventoryCountStatus.COMPLETED ? "Operator" : null,
                Instant.parse("2026-08-01T00:00:00Z"),
                Instant.parse("2026-08-01T00:00:00Z"));
    }

    private static InventoryMutationResult mutation(UUID eventId) {
        InventoryEventView event = new InventoryEventView(
                eventId, 1, InventoryEventType.CORRECTION, SKU_ID,
                "SKU-1", "Product", WAREHOUSE_ID, "WH-1", "Warehouse",
                2, 12, 4, "INVENTORY_COUNT", null,
                "count.request-1", Instant.parse("2026-08-01T00:00:00Z"));
        return new InventoryMutationResult(event, balance(), false);
    }
}
