package cn.xzkj.erp.inventory.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
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
import cn.xzkj.erp.inventory.domain.InventoryEventType;
import cn.xzkj.erp.inventory.domain.WarehouseTransferAllocationMethod;
import cn.xzkj.erp.inventory.domain.WarehouseTransferStatus;
import cn.xzkj.erp.inventory.domain.WarehouseTransferTransportMode;
import cn.xzkj.erp.inventory.repository.WarehouseTransferRepository;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.warehouse.domain.Warehouse;
import cn.xzkj.erp.warehouse.domain.WarehouseStatus;
import cn.xzkj.erp.warehouse.repository.WarehouseRepository;
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

class WarehouseTransferServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID SOURCE_ID = UUID.randomUUID();
    private static final UUID TARGET_ID = UUID.randomUUID();
    private static final UUID BALANCE_ID = UUID.randomUUID();
    private static final UUID SKU_ID = UUID.randomUUID();
    private static final Instant NOW = Instant.parse("2026-08-01T00:00:00Z");

    private WarehouseTransferRepository repository;
    private WarehouseRepository warehouseRepository;
    private InventoryService inventoryService;
    private WarehouseScopeEvaluator scopeEvaluator;
    private SecurityAuditRecorder auditRecorder;
    private WarehouseTransferService service;

    @BeforeEach
    void setUp() {
        repository = mock(WarehouseTransferRepository.class);
        warehouseRepository = mock(WarehouseRepository.class);
        inventoryService = mock(InventoryService.class);
        scopeEvaluator = mock(WarehouseScopeEvaluator.class);
        auditRecorder = mock(SecurityAuditRecorder.class);
        service = new WarehouseTransferService(
                repository, warehouseRepository, inventoryService,
                scopeEvaluator, auditRecorder);
        when(scopeEvaluator.evaluate(TENANT_ID, USER_ID, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
        Warehouse active = mock(Warehouse.class);
        when(active.getStatus()).thenReturn(WarehouseStatus.ACTIVE);
        when(warehouseRepository.findByIdAndTenantId(SOURCE_ID, TENANT_ID))
                .thenReturn(Optional.of(active));
        when(warehouseRepository.findByIdAndTenantId(TARGET_ID, TENANT_ID))
                .thenReturn(Optional.of(active));
    }

    @Test
    void createsAuthoritativeSnapshotWithoutMutatingInventory() {
        WarehouseTransferDetail detail = detail(
                UUID.randomUUID(), WarehouseTransferStatus.DRAFT, 0, null, null);
        when(inventoryService.getBalance(any(), eq(BALANCE_ID)))
                .thenReturn(sourceBalance(10, 1, 3));
        when(repository.findCommand(eq(TENANT_ID), any()))
                .thenReturn(Optional.empty());
        when(repository.find(eq(TENANT_ID), any()))
                .thenReturn(Optional.of(detail));

        WarehouseTransferDetail result = service.create(
                actor(), UUID.randomUUID(), SOURCE_ID, TARGET_ID,
                LocalDate.of(2026, 8, 1), WarehouseTransferTransportMode.LAND,
                120L, "cny", "Carrier", "TRACK-1",
                WarehouseTransferAllocationMethod.WEIGHT,
                NOW.plusSeconds(3600), NOW.plusSeconds(7200),
                "Transfer note", false,
                List.of(new WarehouseTransferService.LineInput(BALANCE_ID, 4)));

        assertThat(result).isSameAs(detail);
        verify(repository).insertLine(
                any(), eq(TENANT_ID), any(), eq(BALANCE_ID), eq(SKU_ID),
                eq(SOURCE_ID), eq(TARGET_ID), eq(3L), eq(10L), eq(1L), eq(4L));
        verify(inventoryService, never()).adjust(
                any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyLong(),
                anyString(), anyString(), anyString());
        verify(auditRecorder).recordAtomically(any());
    }

    @Test
    void shipFailsClosedWhenAvailableInventoryDropped() {
        UUID transferId = UUID.randomUUID();
        WarehouseTransferSummary ready = summary(
                transferId, WarehouseTransferStatus.READY_TO_SHIP, 2);
        when(repository.findCommand(eq(TENANT_ID), any()))
                .thenReturn(Optional.empty());
        when(repository.lock(TENANT_ID, transferId))
                .thenReturn(Optional.of(ready));
        when(repository.listLines(TENANT_ID, transferId))
                .thenReturn(List.of(line(4, null, null)));
        when(inventoryService.getBalance(any(), eq(BALANCE_ID)))
                .thenReturn(sourceBalance(4, 2, 5));

        assertThatThrownBy(() -> service.ship(
                actor(), transferId, UUID.randomUUID(), 2))
                .isInstanceOf(InventoryConflictException.class)
                .extracting(error -> ((InventoryConflictException) error).reason())
                .isEqualTo("insufficient_available_inventory");

        verify(inventoryService, never()).adjust(
                any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyLong(),
                anyString(), anyString(), anyString());
        verify(repository, never()).transition(
                any(), any(), org.mockito.ArgumentMatchers.anyLong(),
                any(), any(), any(), any(), any());
    }

    @Test
    void shipPostsNegativeLedgerEventAndLinksIt() {
        UUID transferId = UUID.randomUUID();
        UUID eventId = UUID.randomUUID();
        WarehouseTransferSummary ready = summary(
                transferId, WarehouseTransferStatus.READY_TO_SHIP, 2);
        WarehouseTransferDetail shipped = detail(
                transferId, WarehouseTransferStatus.IN_TRANSIT, 3, eventId, null);
        when(repository.findCommand(eq(TENANT_ID), any()))
                .thenReturn(Optional.empty());
        when(repository.lock(TENANT_ID, transferId))
                .thenReturn(Optional.of(ready));
        when(repository.listLines(TENANT_ID, transferId))
                .thenReturn(List.of(line(4, null, null)));
        when(inventoryService.getBalance(any(), eq(BALANCE_ID)))
                .thenReturn(sourceBalance(10, 1, 5));
        when(inventoryService.adjust(
                any(), eq(InventoryEventType.WAREHOUSE_TRANSFER_SHIPMENT),
                eq(SKU_ID), eq(SOURCE_ID), eq(-4L), eq(5L),
                eq("WAREHOUSE_TRANSFER_SHIPMENT"), anyString(), anyString()))
                .thenReturn(mutation(eventId, InventoryEventType.WAREHOUSE_TRANSFER_SHIPMENT,
                        SOURCE_ID, -4));
        when(repository.transition(
                eq(TENANT_ID), eq(transferId), eq(2L),
                eq(WarehouseTransferStatus.READY_TO_SHIP),
                eq(WarehouseTransferStatus.IN_TRANSIT),
                eq("Operator"), eq(USER_ID), isNull()))
                .thenReturn(1);
        when(repository.find(TENANT_ID, transferId))
                .thenReturn(Optional.of(shipped));

        WarehouseTransferDetail result = service.ship(
                actor(), transferId, UUID.randomUUID(), 2);

        assertThat(result.summary().status())
                .isEqualTo(WarehouseTransferStatus.IN_TRANSIT);
        verify(repository).setShipmentEvent(TENANT_ID, line(4, null, null).id(), eventId);
        verify(inventoryService).adjust(
                any(), eq(InventoryEventType.WAREHOUSE_TRANSFER_SHIPMENT),
                eq(SKU_ID), eq(SOURCE_ID), eq(-4L), eq(5L),
                eq("WAREHOUSE_TRANSFER_SHIPMENT"), anyString(),
                eq("transfer.ship." + transferId + "." + lineId()));
    }

    @Test
    void receivePostsPositiveTargetLedgerEventAndLinksIt() {
        UUID transferId = UUID.randomUUID();
        UUID shipmentEventId = UUID.randomUUID();
        UUID receiptEventId = UUID.randomUUID();
        WarehouseTransferSummary transit = summary(
                transferId, WarehouseTransferStatus.IN_TRANSIT, 3);
        WarehouseTransferDetail received = detail(
                transferId, WarehouseTransferStatus.RECEIVED, 4,
                shipmentEventId, receiptEventId);
        when(repository.findCommand(eq(TENANT_ID), any()))
                .thenReturn(Optional.empty());
        when(repository.lock(TENANT_ID, transferId))
                .thenReturn(Optional.of(transit));
        when(repository.listLines(TENANT_ID, transferId))
                .thenReturn(List.of(line(4, shipmentEventId, null)));
        when(inventoryService.listBalances(
                any(), eq(TARGET_ID), eq(SKU_ID), isNull(), any()))
                .thenReturn(new PageImpl<>(List.of(targetBalance(2, 7))));
        when(inventoryService.adjust(
                any(), eq(InventoryEventType.WAREHOUSE_TRANSFER_RECEIPT),
                eq(SKU_ID), eq(TARGET_ID), eq(4L), eq(7L),
                eq("WAREHOUSE_TRANSFER_RECEIPT"), anyString(), anyString()))
                .thenReturn(mutation(receiptEventId,
                        InventoryEventType.WAREHOUSE_TRANSFER_RECEIPT,
                        TARGET_ID, 4));
        when(repository.transition(
                eq(TENANT_ID), eq(transferId), eq(3L),
                eq(WarehouseTransferStatus.IN_TRANSIT),
                eq(WarehouseTransferStatus.RECEIVED),
                eq("Operator"), eq(USER_ID), isNull()))
                .thenReturn(1);
        when(repository.find(TENANT_ID, transferId))
                .thenReturn(Optional.of(received));

        WarehouseTransferDetail result = service.receive(
                actor(), transferId, UUID.randomUUID(), 3);

        assertThat(result.summary().status())
                .isEqualTo(WarehouseTransferStatus.RECEIVED);
        verify(repository).recordReceipt(
                eq(TENANT_ID), eq(transferId), eq(lineId()), eq(4L),
                eq(receiptEventId), any(), eq("Operator"), eq(USER_ID), isNull());
        verify(inventoryService).adjust(
                any(), eq(InventoryEventType.WAREHOUSE_TRANSFER_RECEIPT),
                eq(SKU_ID), eq(TARGET_ID), eq(4L), eq(7L),
                eq("WAREHOUSE_TRANSFER_RECEIPT"), anyString(),
                eq("transfer.receive." + transferId + "." + lineId()));
    }

    @Test
    void partialReceiptPostsOnlyRequestedQuantityAndKeepsTransferOpen() {
        UUID transferId = UUID.randomUUID();
        UUID commandId = UUID.randomUUID();
        UUID shipmentEventId = UUID.randomUUID();
        UUID receiptEventId = UUID.randomUUID();
        WarehouseTransferSummary transit = summary(
                transferId, WarehouseTransferStatus.IN_TRANSIT, 3);
        WarehouseTransferDetail partial = detail(
                transferId, WarehouseTransferStatus.PARTIALLY_RECEIVED, 4,
                shipmentEventId, receiptEventId, 2, 2);
        when(repository.findCommand(TENANT_ID, commandId))
                .thenReturn(Optional.empty());
        when(repository.lock(TENANT_ID, transferId))
                .thenReturn(Optional.of(transit));
        when(repository.listLines(TENANT_ID, transferId))
                .thenReturn(List.of(line(4, 0, 4, shipmentEventId, null)));
        when(inventoryService.listBalances(
                any(), eq(TARGET_ID), eq(SKU_ID), isNull(), any()))
                .thenReturn(new PageImpl<>(List.of(targetBalance(2, 7))));
        when(inventoryService.adjust(
                any(), eq(InventoryEventType.WAREHOUSE_TRANSFER_RECEIPT),
                eq(SKU_ID), eq(TARGET_ID), eq(2L), eq(7L),
                eq("WAREHOUSE_TRANSFER_RECEIPT"), anyString(), anyString()))
                .thenReturn(mutation(receiptEventId,
                        InventoryEventType.WAREHOUSE_TRANSFER_RECEIPT,
                        TARGET_ID, 2));
        when(repository.transition(
                eq(TENANT_ID), eq(transferId), eq(3L),
                eq(WarehouseTransferStatus.IN_TRANSIT),
                eq(WarehouseTransferStatus.PARTIALLY_RECEIVED),
                eq("Operator"), eq(USER_ID), isNull()))
                .thenReturn(1);
        when(repository.find(TENANT_ID, transferId))
                .thenReturn(Optional.of(partial));

        WarehouseTransferDetail result = service.receivePartial(
                actor(), transferId, commandId, 3,
                List.of(new WarehouseTransferService.ReceiptInput(lineId(), 2)));

        assertThat(result.summary().status())
                .isEqualTo(WarehouseTransferStatus.PARTIALLY_RECEIVED);
        verify(repository).recordReceipt(
                TENANT_ID, transferId, lineId(), 2, receiptEventId, commandId,
                "Operator", USER_ID, null);
        verify(inventoryService).adjust(
                any(), eq(InventoryEventType.WAREHOUSE_TRANSFER_RECEIPT),
                eq(SKU_ID), eq(TARGET_ID), eq(2L), eq(7L),
                eq("WAREHOUSE_TRANSFER_RECEIPT"), anyString(),
                eq("transfer.receive.partial." + commandId + "." + lineId()));
    }

    @Test
    void partialReceiptFailsClosedWhenItWouldReceiveAllRemainingQuantity() {
        UUID transferId = UUID.randomUUID();
        UUID shipmentEventId = UUID.randomUUID();
        when(repository.findCommand(eq(TENANT_ID), any()))
                .thenReturn(Optional.empty());
        when(repository.lock(TENANT_ID, transferId))
                .thenReturn(Optional.of(summary(
                        transferId, WarehouseTransferStatus.IN_TRANSIT, 3)));
        when(repository.listLines(TENANT_ID, transferId))
                .thenReturn(List.of(line(4, 1, 3, shipmentEventId, null)));

        assertThatThrownBy(() -> service.receivePartial(
                actor(), transferId, UUID.randomUUID(), 3,
                List.of(new WarehouseTransferService.ReceiptInput(lineId(), 3))))
                .isInstanceOf(InventoryConflictException.class)
                .extracting(error -> ((InventoryConflictException) error).reason())
                .isEqualTo("partial_receipt_must_leave_remaining");

        verify(inventoryService, never()).adjust(
                any(), any(), any(), any(),
                org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyLong(),
                anyString(), anyString(), anyString());
    }

    @Test
    void exportsTheFilteredTransferListAsFormulaSafeCsv() {
        WarehouseTransferSummary export = new WarehouseTransferSummary(
                UUID.randomUUID(), "WT-20260801-EXPORT", WarehouseTransferStatus.APPROVAL,
                LocalDate.of(2026, 8, 1), SOURCE_ID, "WH-1", "Source",
                TARGET_ID, "WH-2", "Target", WarehouseTransferTransportMode.LAND,
                120L, "CNY", "=unsafe", "TRACK-1",
                WarehouseTransferAllocationMethod.WEIGHT, NOW.plusSeconds(3600),
                NOW.plusSeconds(7200), "=SUM(1,1)", 1, 4, 1,
                "Operator", "Approver", null, null, NOW, NOW);
        when(repository.list(
                eq(TENANT_ID), any(), eq(true), eq(SOURCE_ID), eq(TARGET_ID),
                eq(List.of(WarehouseTransferStatus.APPROVAL)),
                eq(WarehouseTransferTransportMode.LAND),
                eq(WarehouseTransferSearchField.SKU), eq("sku-1"),
                eq(LocalDate.of(2026, 7, 1)), eq(LocalDate.of(2026, 8, 1)),
                any()))
                .thenReturn(new PageImpl<>(List.of(export),
                        PageRequest.of(0, WarehouseTransferService.MAX_EXPORT_ROWS + 1), 1));

        var result = service.exportCsv(
                actor(), SOURCE_ID, TARGET_ID,
                List.of(WarehouseTransferStatus.APPROVAL),
                WarehouseTransferTransportMode.LAND,
                WarehouseTransferSearchField.SKU, " SKU-1 ",
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 8, 1));

        assertThat(result.filename()).isEqualTo("warehouse-transfers.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=utf-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content())
                .startsWith("\uFEFF调拨批次,状态,调拨日期,起始仓库编码")
                .contains("WT-20260801-EXPORT,审核中,2026-08-01")
                .contains("'=unsafe")
                .contains("\"'=SUM(1,1)\"");
    }

    @Test
    void rejectsACombinedReceiptExportAboveTheRowLimit() {
        when(repository.list(
                eq(TENANT_ID), any(), eq(true), isNull(), isNull(),
                eq(List.of(WarehouseTransferStatus.IN_TRANSIT,
                        WarehouseTransferStatus.PARTIALLY_RECEIVED)),
                isNull(), eq(WarehouseTransferSearchField.BATCH), isNull(),
                isNull(), isNull(), any()))
                .thenReturn(new PageImpl<>(
                        List.of(), PageRequest.of(0, 10_001), 11_001));

        assertThatThrownBy(() -> service.exportCsv(
                actor(), null, null,
                List.of(WarehouseTransferStatus.IN_TRANSIT,
                        WarehouseTransferStatus.PARTIALLY_RECEIVED),
                null, WarehouseTransferSearchField.BATCH, null, null, null))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("row limit");
    }

    private static WarehouseTransferActor actor() {
        return new WarehouseTransferActor(
                TENANT_ID, USER_ID, null, "Operator",
                "transfer.request-1", "127.0.0.1");
    }

    private static InventoryBalanceView sourceBalance(
            long onHand, long reserved, long version) {
        return new InventoryBalanceView(
                BALANCE_ID, SKU_ID, "SKU-1", "Product",
                SOURCE_ID, "WH-1", "Source", onHand, reserved,
                version, NOW);
    }

    private static InventoryBalanceView targetBalance(
            long onHand, long version) {
        return new InventoryBalanceView(
                UUID.randomUUID(), SKU_ID, "SKU-1", "Product",
                TARGET_ID, "WH-2", "Target", onHand, 0,
                version, NOW);
    }

    private static UUID lineId() {
        return UUID.nameUUIDFromBytes("warehouse-transfer-line".getBytes());
    }

    private static WarehouseTransferLineView line(
            long quantity, UUID shipmentEventId, UUID receiptEventId) {
        long receivedQuantity = receiptEventId == null ? 0 : quantity;
        return line(quantity, receivedQuantity,
                Math.subtractExact(quantity, receivedQuantity),
                shipmentEventId, receiptEventId);
    }

    private static WarehouseTransferLineView line(
            long quantity,
            long receivedQuantity,
            long remainingQuantity,
            UUID shipmentEventId,
            UUID receiptEventId) {
        return new WarehouseTransferLineView(
                lineId(), BALANCE_ID, SKU_ID, "SKU-1", "Product",
                3, 10, 1, 9, quantity, receivedQuantity,
                remainingQuantity, shipmentEventId, receiptEventId);
    }

    private static WarehouseTransferDetail detail(
            UUID transferId,
            WarehouseTransferStatus status,
            long version,
            UUID shipmentEventId,
            UUID receiptEventId) {
        return new WarehouseTransferDetail(
                summary(transferId, status, version),
                List.of(line(4, shipmentEventId, receiptEventId)));
    }

    private static WarehouseTransferDetail detail(
            UUID transferId,
            WarehouseTransferStatus status,
            long version,
            UUID shipmentEventId,
            UUID receiptEventId,
            long receivedQuantity,
            long remainingQuantity) {
        return new WarehouseTransferDetail(
                summary(transferId, status, version),
                List.of(line(4, receivedQuantity, remainingQuantity,
                        shipmentEventId, receiptEventId)));
    }

    private static WarehouseTransferSummary summary(
            UUID transferId,
            WarehouseTransferStatus status,
            long version) {
        return new WarehouseTransferSummary(
                transferId, "WT-20260801-00000000", status,
                LocalDate.of(2026, 8, 1),
                SOURCE_ID, "WH-1", "Source",
                TARGET_ID, "WH-2", "Target",
                WarehouseTransferTransportMode.LAND,
                null, null, null, null,
                WarehouseTransferAllocationMethod.WEIGHT,
                null, null, null, 1, 4, version,
                "Operator", null, null, null, NOW, NOW);
    }

    private static InventoryMutationResult mutation(
            UUID eventId,
            InventoryEventType type,
            UUID warehouseId,
            long delta) {
        InventoryEventView event = new InventoryEventView(
                eventId, 1, type, SKU_ID, "SKU-1", "Product",
                warehouseId, "WH", "Warehouse", delta, 6, 8,
                type.name(), null, "transfer.request-1", NOW);
        return new InventoryMutationResult(event, sourceBalance(6, 1, 8), false);
    }
}
