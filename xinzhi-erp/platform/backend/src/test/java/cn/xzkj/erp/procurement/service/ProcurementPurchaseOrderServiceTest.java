package cn.xzkj.erp.procurement.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeMode;
import cn.xzkj.erp.inventory.service.InventoryService;
import cn.xzkj.erp.inventory.domain.InventoryEventType;
import cn.xzkj.erp.inventory.service.InventoryBalanceView;
import cn.xzkj.erp.inventory.service.InventoryEventView;
import cn.xzkj.erp.inventory.service.InventoryMutationResult;
import cn.xzkj.erp.procurement.domain.ProcurementPlanSource;
import cn.xzkj.erp.procurement.domain.ProcurementPlanStatus;
import cn.xzkj.erp.procurement.domain.ProcurementPurchaseOrderSearchField;
import cn.xzkj.erp.procurement.domain.ProcurementPurchaseOrderStatus;
import cn.xzkj.erp.procurement.domain.ProcurementReceiptSort;
import cn.xzkj.erp.procurement.repository.ProcurementPlanRepository;
import cn.xzkj.erp.procurement.repository.ProcurementPurchaseOrderRepository;
import cn.xzkj.erp.procurement.repository.ProcurementPurchaseOrderRepository.CommandRecord;
import cn.xzkj.erp.procurement.repository.ProcurementPurchaseOrderRepository.CreateFacts;
import java.lang.reflect.Method;
import java.time.Instant;
import java.util.Optional;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Page;

class ProcurementPurchaseOrderServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID PLAN_ID = UUID.randomUUID();
    private static final UUID ORDER_ID = UUID.randomUUID();
    private static final UUID SUPPLIER_ID = UUID.randomUUID();
    private static final UUID SKU_ID = UUID.randomUUID();
    private static final UUID WAREHOUSE_ID = UUID.randomUUID();
    private static final UUID LOCATION_ID = UUID.randomUUID();
    private static final UUID COMMAND_ID = UUID.randomUUID();
    private ProcurementPurchaseOrderRepository repository;
    private ProcurementPlanRepository planRepository;
    private WarehouseScopeEvaluator scopeEvaluator;
    private SecurityAuditRecorder audits;
    private InventoryService inventoryService;
    private ProcurementPurchaseOrderService service;

    @BeforeEach
    void setUp() {
        repository = mock(ProcurementPurchaseOrderRepository.class);
        planRepository = mock(ProcurementPlanRepository.class);
        scopeEvaluator = mock(WarehouseScopeEvaluator.class);
        audits = mock(SecurityAuditRecorder.class);
        inventoryService = mock(InventoryService.class);
        service = new ProcurementPurchaseOrderService(
                repository, planRepository, scopeEvaluator, audits,
                inventoryService);
        when(scopeEvaluator.evaluate(TENANT_ID, USER_ID, null))
                .thenReturn(new WarehouseScopeAccess(WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void createsOrderFromLockedPlanAndActiveSupplierFacts() {
        when(repository.findCommand(TENANT_ID, COMMAND_ID)).thenReturn(Optional.empty());
        when(planRepository.lock(TENANT_ID, PLAN_ID)).thenReturn(Optional.of(plan(0)));
        when(repository.findCreateFacts(TENANT_ID, PLAN_ID, SUPPLIER_ID))
                .thenReturn(Optional.of(facts()));
        when(planRepository.markOrdered(TENANT_ID, PLAN_ID, 0)).thenReturn(1);
        when(repository.find(eq(TENANT_ID), any())).thenReturn(Optional.of(order()));

        ProcurementPurchaseOrderView created = service.create(
                actor(), COMMAND_ID, PLAN_ID, 0, SUPPLIER_ID, "  urgent  ");

        assertThat(created).isEqualTo(order());
        verify(repository).insert(
                any(), eq(TENANT_ID), any(), eq(PLAN_ID), eq(facts()),
                eq("urgent"), eq("Operator"), eq(USER_ID), eq(null));
        verify(planRepository).markOrdered(TENANT_ID, PLAN_ID, 0);
        verify(repository).insertCommand(eq(TENANT_ID), eq(COMMAND_ID), any(), eq(fingerprint(
                PLAN_ID.toString(), "0", SUPPLIER_ID.toString(), "urgent")));
        ArgumentCaptor<SecurityAuditEvent> event = ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(audits).recordAtomically(event.capture());
        assertThat(event.getValue().action()).isEqualTo("procurement_purchase_order.created");
        assertThat(event.getValue().details())
                .containsEntry("supplierId", SUPPLIER_ID.toString())
                .doesNotContainKeys("orderNote", "supplierName");
    }

    @Test
    void createsDirectOrderWithoutMutatingProcurementPlans() {
        CreateFacts directFacts = directFacts();
        ProcurementPurchaseOrderView directOrder = directOrder();
        when(repository.findCommand(TENANT_ID, COMMAND_ID)).thenReturn(Optional.empty());
        when(repository.findDirectCreateFacts(
                TENANT_ID, SKU_ID, WAREHOUSE_ID, LOCATION_ID, SUPPLIER_ID, 12))
                .thenReturn(Optional.of(directFacts));
        when(repository.find(eq(TENANT_ID), any()))
                .thenReturn(Optional.of(directOrder));

        assertThat(service.createDirect(
                actor(), COMMAND_ID, SUPPLIER_ID, SKU_ID, WAREHOUSE_ID,
                LOCATION_ID, 12, "  urgent  "))
                .isEqualTo(directOrder);

        verify(repository).insert(
                any(), eq(TENANT_ID), any(), eq(null), eq(directFacts),
                eq("urgent"), eq("Operator"), eq(USER_ID), eq(null));
        verifyNoInteractions(planRepository);
        ArgumentCaptor<SecurityAuditEvent> event =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(audits).recordAtomically(event.capture());
        assertThat(event.getValue().details())
                .containsEntry("supplierId", SUPPLIER_ID.toString())
                .doesNotContainKey("planId");
    }

    @Test
    void replaysSameCommandWithoutTouchingPlanOrAuditingTwice() {
        String fingerprint = fingerprint(PLAN_ID.toString(), "0", SUPPLIER_ID.toString(), null);
        when(repository.findCommand(TENANT_ID, COMMAND_ID))
                .thenReturn(Optional.of(new CommandRecord(ORDER_ID, fingerprint)));
        when(repository.find(TENANT_ID, ORDER_ID)).thenReturn(Optional.of(order()));

        assertThat(service.create(actor(), COMMAND_ID, PLAN_ID, 0, SUPPLIER_ID, null))
                .isEqualTo(order());

        verify(planRepository, never()).lock(any(), any());
        verify(repository, never()).insert(any(), any(), any(), any(), any(), any(), any(), any(), any());
        verifyNoInteractions(audits);
    }

    @Test
    void rejectsStaleOrAlreadyHandledPlanBeforeSupplierSnapshot() {
        when(repository.findCommand(TENANT_ID, COMMAND_ID)).thenReturn(Optional.empty());
        when(planRepository.lock(TENANT_ID, PLAN_ID)).thenReturn(Optional.of(plan(2)));
        assertThatThrownBy(() -> service.create(
                actor(), COMMAND_ID, PLAN_ID, 1, SUPPLIER_ID, null))
                .isInstanceOf(ProcurementPurchaseOrderConflictException.class)
                .extracting("reason").isEqualTo("optimistic_lock_conflict");

        when(planRepository.lock(TENANT_ID, PLAN_ID))
                .thenReturn(Optional.of(plan(ProcurementPlanStatus.ORDERED, 2)));
        assertThatThrownBy(() -> service.create(
                actor(), COMMAND_ID, PLAN_ID, 2, SUPPLIER_ID, null))
                .isInstanceOf(ProcurementPurchaseOrderConflictException.class)
                .extracting("reason").isEqualTo("invalid_plan_state");
        verify(repository, never()).findCreateFacts(any(), any(), any());
    }

    @Test
    void rejectsSupplierWithoutActiveRelationship() {
        when(repository.findCommand(TENANT_ID, COMMAND_ID)).thenReturn(Optional.empty());
        when(planRepository.lock(TENANT_ID, PLAN_ID)).thenReturn(Optional.of(plan(0)));
        when(repository.findCreateFacts(TENANT_ID, PLAN_ID, SUPPLIER_ID))
                .thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.create(
                actor(), COMMAND_ID, PLAN_ID, 0, SUPPLIER_ID, null))
                .isInstanceOf(ProcurementPurchaseOrderConflictException.class)
                .extracting("reason").isEqualTo("supplier_mapping_unavailable");
        verify(planRepository, never()).markOrdered(any(), any(), any(Long.class));
        verifyNoInteractions(audits);
    }

    @Test
    void approvesPendingOrderAndRecordsTheReviewer() {
        when(repository.lock(TENANT_ID, ORDER_ID)).thenReturn(Optional.of(order()));
        when(repository.review(
                TENANT_ID, ORDER_ID, 0, true, "approved for replenishment",
                "Operator", USER_ID, null)).thenReturn(1);
        when(repository.find(TENANT_ID, ORDER_ID))
                .thenReturn(Optional.of(approvedOrder()));

        assertThat(service.review(
                actor(), ORDER_ID, 0, true, "  approved for replenishment  "))
                .isEqualTo(approvedOrder());

        verify(repository).review(
                TENANT_ID, ORDER_ID, 0, true, "approved for replenishment",
                "Operator", USER_ID, null);
        ArgumentCaptor<SecurityAuditEvent> event =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(audits).recordAtomically(event.capture());
        assertThat(event.getValue().action())
                .isEqualTo("procurement_purchase_order.approved");
    }

    @Test
    void requiresAReasonBeforeRejectingAnOrder() {
        assertThatThrownBy(() -> service.review(
                actor(), ORDER_ID, 0, false, "   "))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("rejection reason");
        verifyNoInteractions(repository);
    }

    @Test
    void blocksReceiptUntilTheOrderHasBeenApproved() {
        when(repository.findReceiptCommand(TENANT_ID, COMMAND_ID))
                .thenReturn(Optional.empty());
        when(repository.lock(TENANT_ID, ORDER_ID)).thenReturn(Optional.of(order()));

        assertThatThrownBy(() -> service.receive(
                actor(), ORDER_ID, COMMAND_ID, 0, 5))
                .isInstanceOf(ProcurementPurchaseOrderConflictException.class)
                .extracting("reason").isEqualTo("invalid_order_state");
        verifyNoInteractions(inventoryService);
    }

    @Test
    void postsPartialReceiptToInventoryAndAdvancesOrder() {
        UUID eventId = UUID.randomUUID();
        ProcurementPurchaseOrderView changed = receivedOrder(5);
        when(repository.findReceiptCommand(TENANT_ID, COMMAND_ID))
                .thenReturn(Optional.empty());
        when(repository.lock(TENANT_ID, ORDER_ID))
                .thenReturn(Optional.of(approvedOrder()));
        InventoryBalanceView balance = new InventoryBalanceView(
                UUID.randomUUID(), SKU_ID, "SKU-1", "Product", WAREHOUSE_ID,
                "WH-1", "Warehouse", 20, 3,
                Instant.parse("2026-08-02T10:00:00Z"));
        when(inventoryService.listBalances(
                any(), eq(WAREHOUSE_ID), eq(SKU_ID), eq(null), any()))
                .thenReturn(new PageImpl<>(
                        List.of(balance), PageRequest.of(0, 2), 1));
        InventoryEventView event = new InventoryEventView(
                eventId, 1, InventoryEventType.PURCHASE_ORDER_RECEIPT,
                SKU_ID, "SKU-1", "Product", WAREHOUSE_ID, "WH-1",
                "Warehouse", 5, 25, 4, "PURCHASE_ORDER_RECEIPT",
                null, "request-1", Instant.parse("2026-08-02T11:00:00Z"));
        when(inventoryService.adjust(
                any(), eq(InventoryEventType.PURCHASE_ORDER_RECEIPT),
                eq(SKU_ID), eq(WAREHOUSE_ID), eq(5L), eq(3L),
                eq("PURCHASE_ORDER_RECEIPT"), any(), any()))
                .thenReturn(new InventoryMutationResult(event, balance, false));
        when(repository.markReceived(
                TENANT_ID, ORDER_ID, 1, 5,
                ProcurementPurchaseOrderStatus.PARTIALLY_RECEIVED))
                .thenReturn(1);
        when(repository.find(TENANT_ID, ORDER_ID)).thenReturn(Optional.of(changed));

        assertThat(service.receive(actor(), ORDER_ID, COMMAND_ID, 1, 5))
                .isEqualTo(changed);

        verify(repository).insertReceipt(
                any(), eq(TENANT_ID), eq(ORDER_ID), eq(5L), eq(eventId),
                eq("Operator"), eq(USER_ID), eq(null), eq("request-1"));
        verify(repository).insertReceiptCommand(
                eq(TENANT_ID), eq(COMMAND_ID), eq(ORDER_ID), any(), eq(2L));
        ArgumentCaptor<SecurityAuditEvent> eventCaptor =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(audits).recordAtomically(eventCaptor.capture());
        assertThat(eventCaptor.getValue().action())
                .isEqualTo("procurement_purchase_order.received");
        assertThat(eventCaptor.getValue().details())
                .containsEntry("receiptQuantity", "5")
                .containsEntry("inventoryEventId", eventId.toString());
    }

    @Test
    void rejectsReceiptAboveRemainingBeforeInventoryMutation() {
        when(repository.findReceiptCommand(TENANT_ID, COMMAND_ID))
                .thenReturn(Optional.empty());
        when(repository.lock(TENANT_ID, ORDER_ID))
                .thenReturn(Optional.of(receivedOrder(5)));

        assertThatThrownBy(() -> service.receive(
                actor(), ORDER_ID, COMMAND_ID, 2, 8))
                .isInstanceOf(ProcurementPurchaseOrderConflictException.class)
                .extracting("reason")
                .isEqualTo("receipt_quantity_exceeds_remaining");
        verifyNoInteractions(inventoryService);
    }

    @Test
    void emptySelectedWarehouseScopeReturnsEmptyListWithoutRepositoryRead() {
        when(scopeEvaluator.evaluate(TENANT_ID, USER_ID, null))
                .thenReturn(new WarehouseScopeAccess(WarehouseScopeMode.SELECTED, Set.of()));
        assertThat(service.list(
                actor(), null, null, null, false,
                ProcurementPurchaseOrderSearchField.PURCHASE_NO,
                null, null, null, PageRequest.of(0, 25))).isEmpty();
        verifyNoInteractions(repository);
    }

    @Test
    void forwardsReceivableOnlyToTheTenantScopedRepositoryQuery() {
        PageRequest pageable = PageRequest.of(0, 25);
        when(repository.list(
                TENANT_ID, Set.of(), true, null, null, null, true,
                ProcurementPurchaseOrderSearchField.PURCHASE_NO,
                null, null, null, pageable))
                .thenReturn(Page.empty(pageable));

        assertThat(service.list(
                actor(), null, null, null, true,
                ProcurementPurchaseOrderSearchField.PURCHASE_NO,
                null, null, null, pageable)).isEmpty();

        verify(repository).list(
                TENANT_ID, Set.of(), true, null, null, null, true,
                ProcurementPurchaseOrderSearchField.PURCHASE_NO,
                null, null, null, pageable);
    }

    @Test
    void exportsBoundedReceivableOrdersWithSpreadsheetSafeCsv() {
        Instant from = Instant.parse("2026-08-01T00:00:00Z");
        Instant to = Instant.parse("2026-08-02T23:59:59.999Z");
        PageRequest exportPage = PageRequest.of(
                0, ProcurementPurchaseOrderService.MAX_EXPORT_ROWS + 1);
        ProcurementPurchaseOrderView order = followUpOrder();
        when(repository.list(
                TENANT_ID, Set.of(), true, null, null, null, true,
                ProcurementPurchaseOrderSearchField.SUPPLIER_NAME,
                "=supplier", from, to, exportPage))
                .thenReturn(new PageImpl<>(List.of(order), exportPage, 1));

        var result = service.exportFollowUpCsv(
                actor(), ProcurementPurchaseOrderSearchField.SUPPLIER_NAME,
                " =Supplier ", from, to);

        assertThat(result.filename()).isEqualTo("procurement-follow-up.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=utf-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content()).startsWith(
                "\uFEFF采购单号,计划编号,SKU编号,SKU名称,规格,仓库编码,仓库名称,"
                        + "库位编码,库位名称,供应商编码,供应商名称,供应商SKU,采购数量,"
                        + "已到货,待到货,状态,下单员,下单时间,最近到货\r\n");
        assertThat(result.content()).contains("\"'=Supplier,\"\"A\"\"\"");
        assertThat(result.content()).contains(",12,5,7,部分收货,");
    }

    @Test
    void rejectsFollowUpExportsAboveTheBoundedRowLimit() {
        PageRequest exportPage = PageRequest.of(
                0, ProcurementPurchaseOrderService.MAX_EXPORT_ROWS + 1);
        when(repository.list(
                TENANT_ID, Set.of(), true, null, null, null, true,
                ProcurementPurchaseOrderSearchField.PURCHASE_NO,
                null, null, null, exportPage))
                .thenReturn(new PageImpl<>(
                        List.of(), exportPage,
                        ProcurementPurchaseOrderService.MAX_EXPORT_ROWS + 1L));

        assertThatThrownBy(() -> service.exportFollowUpCsv(
                actor(), ProcurementPurchaseOrderSearchField.PURCHASE_NO,
                null, null, null))
                .isInstanceOf(cn.xzkj.erp.platform.service.ConflictException.class);
    }

    @Test
    void exportsBoundedPurchaseOrdersWithFiltersAndSpreadsheetSafeCsv() {
        Instant from = Instant.parse("2026-08-01T00:00:00Z");
        Instant to = Instant.parse("2026-08-02T23:59:59.999Z");
        PageRequest exportPage = PageRequest.of(
                0, ProcurementPurchaseOrderService.MAX_EXPORT_ROWS + 1);
        when(repository.list(
                TENANT_ID, Set.of(), true, null, null,
                ProcurementPurchaseOrderStatus.PARTIALLY_RECEIVED, true,
                ProcurementPurchaseOrderSearchField.SUPPLIER_NAME,
                "=supplier", from, to, exportPage))
                .thenReturn(new PageImpl<>(
                        List.of(followUpOrder()), exportPage, 1));

        var result = service.exportCsv(
                actor(), ProcurementPurchaseOrderStatus.PARTIALLY_RECEIVED,
                true,
                ProcurementPurchaseOrderSearchField.SUPPLIER_NAME,
                " =Supplier ", from, to);

        assertThat(result.filename()).isEqualTo("procurement-orders.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=utf-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content()).startsWith(
                "\uFEFF采购单号,状态,计划编号,供应商编码,供应商名称,供应商SKU,"
                        + "SKU编号,SKU名称,规格,仓库编码,仓库名称,库位编码,库位名称,"
                        + "采购数量,已收数量,待收数量,订单备注,下单员,最近到货,创建时间,"
                        + "更新时间\r\n");
        assertThat(result.content()).contains("\"'=Supplier,\"\"A\"\"\"");
        assertThat(result.content()).contains(",12,5,7,urgent,Operator,");
    }

    @Test
    void rejectsPurchaseOrderExportsAboveTheBoundedRowLimit() {
        PageRequest exportPage = PageRequest.of(
                0, ProcurementPurchaseOrderService.MAX_EXPORT_ROWS + 1);
        when(repository.list(
                TENANT_ID, Set.of(), true, null, null, null, false,
                ProcurementPurchaseOrderSearchField.PURCHASE_NO,
                null, null, null, exportPage))
                .thenReturn(new PageImpl<>(
                        List.of(), exportPage,
                        ProcurementPurchaseOrderService.MAX_EXPORT_ROWS + 1L));

        assertThatThrownBy(() -> service.exportCsv(
                actor(), null, false,
                ProcurementPurchaseOrderSearchField.PURCHASE_NO,
                null, null, null))
                .isInstanceOf(cn.xzkj.erp.platform.service.ConflictException.class);
    }

    @Test
    void rejectsReceivedOrdersFromTheReceivableOnlyExport() {
        PageRequest exportPage = PageRequest.of(
                0, ProcurementPurchaseOrderService.MAX_EXPORT_ROWS + 1);
        when(repository.list(
                TENANT_ID, Set.of(), true, null, null, null, true,
                ProcurementPurchaseOrderSearchField.PURCHASE_NO,
                null, null, null, exportPage))
                .thenReturn(new PageImpl<>(
                        List.of(receivedOrder(12)), exportPage, 1));

        assertThatThrownBy(() -> service.exportCsv(
                actor(), null, true,
                ProcurementPurchaseOrderSearchField.PURCHASE_NO,
                null, null, null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("received order");
    }

    @Test
    void listsReceiptsWithinWarehouseScopeAndNormalizesSupplierKeyword() {
        PageRequest pageable = PageRequest.of(0, 25);
        when(repository.listReceipts(
                TENANT_ID, Set.of(), true, null, "supplier",
                "po-123", null, null,
                ProcurementReceiptSort.PURCHASE_NO, pageable))
                .thenReturn(Page.empty(pageable));

        assertThat(service.listReceipts(
                actor(), null, "  SUPPLIER  ", "  PO-123  ", null, null,
                ProcurementReceiptSort.PURCHASE_NO, pageable)).isEmpty();

        verify(repository).listReceipts(
                TENANT_ID, Set.of(), true, null, "supplier",
                "po-123", null, null,
                ProcurementReceiptSort.PURCHASE_NO, pageable);
    }

    @Test
    void exportsBoundedReceiptLedgerWithSpreadsheetSafeCsv() {
        Instant from = Instant.parse("2026-08-01T00:00:00Z");
        Instant to = Instant.parse("2026-08-02T23:59:59.999Z");
        PageRequest exportPage = PageRequest.of(
                0, ProcurementPurchaseOrderService.MAX_EXPORT_ROWS + 1);
        when(repository.listReceipts(
                TENANT_ID, Set.of(), true, null, "=supplier", "po-1",
                from, to, ProcurementReceiptSort.SKU_CODE, exportPage))
                .thenReturn(new PageImpl<>(
                        List.of(receiptLedgerRecord()), exportPage, 1));

        var result = service.exportReceiptLedgerCsv(
                actor(), " =Supplier ", " PO-1 ", from, to,
                ProcurementReceiptSort.SKU_CODE);

        assertThat(result.filename())
                .isEqualTo("procurement-receipt-ledger.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=utf-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content()).startsWith(
                "\uFEFF入库时间,采购单号,计划编号,供应商编码,供应商名称,SKU编号,"
                        + "SKU名称,规格,仓库编码,仓库名称,库位编码,库位名称,本次入库,"
                        + "入库后库存,库存事件序号,库存事件ID,操作人\r\n");
        assertThat(result.content()).contains("\"'=Supplier,\"\"A\"\"\"");
        assertThat(result.content()).contains(",5,-2,9,");
    }

    @Test
    void rejectsReceiptLedgerExportsAboveTheBoundedRowLimit() {
        PageRequest exportPage = PageRequest.of(
                0, ProcurementPurchaseOrderService.MAX_EXPORT_ROWS + 1);
        when(repository.listReceipts(
                TENANT_ID, Set.of(), true, null, null, null,
                null, null, ProcurementReceiptSort.RECEIVED_AT, exportPage))
                .thenReturn(new PageImpl<>(
                        List.of(), exportPage,
                        ProcurementPurchaseOrderService.MAX_EXPORT_ROWS + 1L));

        assertThatThrownBy(() -> service.exportReceiptLedgerCsv(
                actor(), null, null, null, null,
                ProcurementReceiptSort.RECEIVED_AT))
                .isInstanceOf(cn.xzkj.erp.platform.service.ConflictException.class);
    }

    @Test
    void rejectsReversedReceiptDateRangeBeforeRepositoryRead() {
        assertThatThrownBy(() -> service.listReceipts(
                actor(), null, null, null,
                Instant.parse("2026-08-03T00:00:00Z"),
                Instant.parse("2026-08-02T00:00:00Z"),
                ProcurementReceiptSort.RECEIVED_AT, PageRequest.of(0, 25)))
                .isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(repository);
    }

    private static ProcurementPlanActor actor() {
        return new ProcurementPlanActor(
                TENANT_ID, USER_ID, null, "Operator", "request-1", "127.0.0.1");
    }

    private static ProcurementPlanView plan(long version) {
        return plan(ProcurementPlanStatus.UNPURCHASED, version);
    }

    private static ProcurementPlanView plan(ProcurementPlanStatus status, long version) {
        return new ProcurementPlanView(
                PLAN_ID, "PP-20260802-1111111111111111111111111111", status,
                ProcurementPlanSource.MANUAL, SKU_ID, "SKU-1", "Product", "Black",
                WAREHOUSE_ID, "WH-1", "Warehouse", LOCATION_ID, "LOC-1", "Location",
                12, "restock", "Operator", Instant.parse("2026-08-02T09:00:00Z"),
                null, null, null, version, Instant.parse("2026-08-02T09:00:00Z"));
    }

    private static CreateFacts facts() {
        return new CreateFacts(
                "PP-20260802-1111111111111111111111111111", SUPPLIER_ID,
                "SUP-1", "Supplier", "SUP-SKU-1", SKU_ID, "SKU-1", "Product",
                "Black", WAREHOUSE_ID, "WH-1", "Warehouse", LOCATION_ID,
                "LOC-1", "Location", 12);
    }

    private static CreateFacts directFacts() {
        return new CreateFacts(
                null, SUPPLIER_ID, "SUP-1", "Supplier", "SUP-SKU-1",
                SKU_ID, "SKU-1", "Product", "Black", WAREHOUSE_ID,
                "WH-1", "Warehouse", LOCATION_ID, "LOC-1", "Location", 12);
    }

    private static ProcurementPurchaseOrderView directOrder() {
        return new ProcurementPurchaseOrderView(
                ORDER_ID, "PO-20260802-1111111111111111111111111111",
                ProcurementPurchaseOrderStatus.NEW_ORDER, null, null,
                SUPPLIER_ID, "SUP-1", "Supplier", "SUP-SKU-1", SKU_ID,
                "SKU-1", "Product", "Black", WAREHOUSE_ID, "WH-1",
                "Warehouse", LOCATION_ID, "LOC-1", "Location", 12, 0,
                "urgent", "Operator", null, null, null, null, 0, null,
                Instant.parse("2026-08-02T10:00:00Z"),
                Instant.parse("2026-08-02T10:00:00Z"));
    }

    private static ProcurementPurchaseOrderView order() {
        return new ProcurementPurchaseOrderView(
                ORDER_ID, "PO-20260802-1111111111111111111111111111",
                ProcurementPurchaseOrderStatus.NEW_ORDER, PLAN_ID,
                "PP-20260802-1111111111111111111111111111", SUPPLIER_ID,
                "SUP-1", "Supplier", "SUP-SKU-1", SKU_ID, "SKU-1", "Product",
                "Black", WAREHOUSE_ID, "WH-1", "Warehouse", LOCATION_ID,
                "LOC-1", "Location", 12, 0, "urgent", "Operator",
                null, null, null, null, 0, null,
                Instant.parse("2026-08-02T10:00:00Z"),
                Instant.parse("2026-08-02T10:00:00Z"));
    }

    private static ProcurementPurchaseOrderView approvedOrder() {
        return new ProcurementPurchaseOrderView(
                ORDER_ID, "PO-20260802-1111111111111111111111111111",
                ProcurementPurchaseOrderStatus.APPROVED, PLAN_ID,
                "PP-20260802-1111111111111111111111111111", SUPPLIER_ID,
                "SUP-1", "Supplier", "SUP-SKU-1", SKU_ID, "SKU-1", "Product",
                "Black", WAREHOUSE_ID, "WH-1", "Warehouse", LOCATION_ID,
                "LOC-1", "Location", 12, 0, "urgent", "Operator",
                "APPROVED", "approved for replenishment", "Operator",
                Instant.parse("2026-08-02T10:30:00Z"), 1, null,
                Instant.parse("2026-08-02T10:00:00Z"),
                Instant.parse("2026-08-02T10:30:00Z"));
    }

    private static ProcurementPurchaseOrderView receivedOrder(long received) {
        return new ProcurementPurchaseOrderView(
                ORDER_ID, "PO-20260802-1111111111111111111111111111",
                received == 12
                        ? ProcurementPurchaseOrderStatus.RECEIVED
                        : ProcurementPurchaseOrderStatus.PARTIALLY_RECEIVED,
                PLAN_ID, "PP-20260802-1111111111111111111111111111",
                SUPPLIER_ID, "SUP-1", "Supplier", "SUP-SKU-1", SKU_ID,
                "SKU-1", "Product", "Black", WAREHOUSE_ID, "WH-1",
                "Warehouse", LOCATION_ID, "LOC-1", "Location", 12,
                received, "urgent", "Operator", "APPROVED", null, "Reviewer",
                Instant.parse("2026-08-02T10:30:00Z"), 2,
                Instant.parse("2026-08-02T11:00:00Z"),
                Instant.parse("2026-08-02T10:00:00Z"),
                Instant.parse("2026-08-02T11:00:00Z"));
    }

    private static ProcurementPurchaseOrderView followUpOrder() {
        return new ProcurementPurchaseOrderView(
                ORDER_ID, "PO-20260802-1111111111111111111111111111",
                ProcurementPurchaseOrderStatus.PARTIALLY_RECEIVED, PLAN_ID,
                "PP-20260802-1111111111111111111111111111", SUPPLIER_ID,
                "SUP-1", "=Supplier,\"A\"", "+SUP-SKU-1", SKU_ID,
                "SKU-1", "Product", "Black", WAREHOUSE_ID, "WH-1",
                "Warehouse", LOCATION_ID, "LOC-1", "Location", 12, 5,
                "urgent", "Operator", "APPROVED", null, "Reviewer",
                Instant.parse("2026-08-02T10:30:00Z"), 1,
                Instant.parse("2026-08-02T11:00:00Z"),
                Instant.parse("2026-08-02T10:00:00Z"),
                Instant.parse("2026-08-02T11:00:00Z"));
    }

    private static ProcurementReceiptView receiptLedgerRecord() {
        return new ProcurementReceiptView(
                UUID.randomUUID(), ORDER_ID,
                "PO-20260802-1111111111111111111111111111",
                "PP-20260802-1111111111111111111111111111", SUPPLIER_ID,
                "SUP-1", "=Supplier,\"A\"", SKU_ID, "SKU-1", "Product",
                "Black", WAREHOUSE_ID, "WH-1", "Warehouse", LOCATION_ID,
                "LOC-1", "Location", 5, COMMAND_ID, 9, -2, "Operator",
                Instant.parse("2026-08-02T12:00:00Z"));
    }

    private static String fingerprint(String... values) {
        try {
            Method method = ProcurementPurchaseOrderService.class
                    .getDeclaredMethod("fingerprint", String[].class);
            method.setAccessible(true);
            return (String) method.invoke(null, (Object) values);
        } catch (ReflectiveOperationException exception) {
            throw new AssertionError(exception);
        }
    }
}
