package cn.xzkj.erp.procurement.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeMode;
import cn.xzkj.erp.inventory.domain.InventoryEventType;
import cn.xzkj.erp.inventory.service.InventoryBalanceView;
import cn.xzkj.erp.inventory.service.InventoryEventView;
import cn.xzkj.erp.inventory.service.InventoryMutationResult;
import cn.xzkj.erp.inventory.service.InventoryService;
import cn.xzkj.erp.procurement.repository.ProcurementPurchaseReturnRepository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

class ProcurementPurchaseReturnServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID ORDER_ID = UUID.randomUUID();
    private static final UUID SKU_ID = UUID.randomUUID();
    private static final UUID WAREHOUSE_ID = UUID.randomUUID();
    private static final UUID LOCATION_ID = UUID.randomUUID();
    private static final UUID COMMAND_ID = UUID.randomUUID();
    private ProcurementPurchaseReturnRepository repository;
    private InventoryService inventoryService;
    private SecurityAuditRecorder audits;
    private ProcurementPurchaseReturnService service;

    @BeforeEach
    void setUp() {
        repository = mock(ProcurementPurchaseReturnRepository.class);
        WarehouseScopeEvaluator scopeEvaluator =
                mock(WarehouseScopeEvaluator.class);
        inventoryService = mock(InventoryService.class);
        audits = mock(SecurityAuditRecorder.class);
        service = new ProcurementPurchaseReturnService(
                repository, scopeEvaluator, inventoryService, audits);
        when(scopeEvaluator.evaluate(TENANT_ID, USER_ID, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void postsBoundedReturnToInventoryAndPersistsTheReturn() {
        UUID eventId = UUID.randomUUID();
        ProcurementReturnableOrderView order = returnable(5, 0, 5);
        ProcurementPurchaseReturnView created = created(eventId);
        when(repository.findCommand(TENANT_ID, COMMAND_ID))
                .thenReturn(Optional.empty());
        when(repository.lockReturnableOrder(TENANT_ID, ORDER_ID))
                .thenReturn(Optional.of(order));
        InventoryBalanceView balance = new InventoryBalanceView(
                UUID.randomUUID(), SKU_ID, "SKU-1", "Product", WAREHOUSE_ID,
                "WH-1", "Warehouse", 25, 3,
                Instant.parse("2026-08-09T14:00:00Z"));
        when(inventoryService.listBalances(
                any(), eq(WAREHOUSE_ID), eq(SKU_ID), eq(null), any()))
                .thenReturn(new PageImpl<>(
                        List.of(balance), PageRequest.of(0, 2), 1));
        InventoryEventView event = new InventoryEventView(
                eventId, 4, InventoryEventType.PURCHASE_ORDER_RETURN,
                SKU_ID, "SKU-1", "Product", WAREHOUSE_ID, "WH-1",
                "Warehouse", -2, 23, 4, "PURCHASE_ORDER_RETURN",
                null, "request-1", Instant.parse("2026-08-09T14:01:00Z"));
        when(inventoryService.adjust(
                any(), eq(InventoryEventType.PURCHASE_ORDER_RETURN),
                eq(SKU_ID), eq(WAREHOUSE_ID), eq(-2L), eq(3L),
                eq("PURCHASE_ORDER_RETURN"), any(), any()))
                .thenReturn(new InventoryMutationResult(event, balance, false));
        when(repository.markReturned(TENANT_ID, ORDER_ID, 2, 2))
                .thenReturn(1);
        when(repository.find(eq(TENANT_ID), any()))
                .thenReturn(Optional.of(created));

        assertThat(service.create(
                actor(), COMMAND_ID, ORDER_ID, 2, 2, " damaged "))
                .isEqualTo(created);

        verify(repository).insert(
                any(), eq(TENANT_ID), any(), eq(ORDER_ID), eq(2L),
                eq("damaged"), eq(eventId), eq("Operator"), eq(USER_ID),
                eq(null), eq("request-1"));
        verify(repository).insertCommand(
                eq(TENANT_ID), eq(COMMAND_ID), any(), any());
        verify(audits).recordAtomically(any());
    }

    @Test
    void rejectsQuantityAboveReceivedRemainderBeforeInventoryMutation() {
        when(repository.findCommand(TENANT_ID, COMMAND_ID))
                .thenReturn(Optional.empty());
        when(repository.lockReturnableOrder(TENANT_ID, ORDER_ID))
                .thenReturn(Optional.of(returnable(5, 3, 2)));

        assertThatThrownBy(() -> service.create(
                actor(), COMMAND_ID, ORDER_ID, 2, 3, "damaged"))
                .isInstanceOf(ProcurementPurchaseOrderConflictException.class)
                .extracting("reason")
                .isEqualTo("return_quantity_exceeds_received");
        verify(inventoryService, never()).adjust(
                any(), any(), any(), any(), any(Long.class), any(Long.class),
                any(), any(), any());
    }

    @Test
    void rejectsReturnWhenWarehouseStockWasAlreadyConsumed() {
        when(repository.findCommand(TENANT_ID, COMMAND_ID))
                .thenReturn(Optional.empty());
        when(repository.lockReturnableOrder(TENANT_ID, ORDER_ID))
                .thenReturn(Optional.of(returnable(5, 0, 5)));
        InventoryBalanceView balance = new InventoryBalanceView(
                UUID.randomUUID(), SKU_ID, "SKU-1", "Product", WAREHOUSE_ID,
                "WH-1", "Warehouse", 1, 4,
                Instant.parse("2026-08-09T14:00:00Z"));
        when(inventoryService.listBalances(
                any(), eq(WAREHOUSE_ID), eq(SKU_ID), eq(null), any()))
                .thenReturn(new PageImpl<>(
                        List.of(balance), PageRequest.of(0, 2), 1));

        assertThatThrownBy(() -> service.create(
                actor(), COMMAND_ID, ORDER_ID, 2, 2, "damaged"))
                .isInstanceOf(ProcurementPurchaseOrderConflictException.class)
                .extracting("reason").isEqualTo("insufficient_inventory");
        verify(repository, never()).markReturned(any(), any(), any(Long.class), any(Long.class));
    }

    private static ProcurementPlanActor actor() {
        return new ProcurementPlanActor(
                TENANT_ID, USER_ID, null, "Operator", "request-1", "127.0.0.1");
    }

    private static ProcurementReturnableOrderView returnable(
            long received, long returned, long returnable) {
        return new ProcurementReturnableOrderView(
                ORDER_ID, "PO-1", "SUP-1", "Supplier", SKU_ID, "SKU-1",
                "Product", null, WAREHOUSE_ID, "WH-1", "Warehouse",
                LOCATION_ID, "A-01", "Location", received, returned,
                returnable, 2);
    }

    private static ProcurementPurchaseReturnView created(UUID eventId) {
        return new ProcurementPurchaseReturnView(
                UUID.randomUUID(), "PR-1", ORDER_ID, "PO-1", "PP-1",
                UUID.randomUUID(), "SUP-1", "Supplier", SKU_ID, "SKU-1",
                "Product", null, WAREHOUSE_ID, "WH-1", "Warehouse",
                LOCATION_ID, "A-01", "Location", 2, "damaged", eventId,
                4, 23, "Operator", Instant.parse("2026-08-09T14:01:00Z"));
    }
}
