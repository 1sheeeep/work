package cn.xzkj.erp.inventory.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeMode;
import cn.xzkj.erp.inventory.domain.InventoryEventType;
import cn.xzkj.erp.inventory.repository.InventoryStore;
import cn.xzkj.erp.inventory.repository.InventoryStore.BalanceState;
import cn.xzkj.erp.inventory.repository.InventoryStore.IdempotencyRecord;
import cn.xzkj.erp.inventory.repository.InventoryStore.MasterDataState;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.warehouse.domain.WarehouseStatus;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

@ExtendWith(MockitoExtension.class)
class InventoryServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID SKU_ID = UUID.randomUUID();
    private static final UUID WAREHOUSE_ID = UUID.randomUUID();
    private static final UUID CATEGORY_ID = UUID.randomUUID();
    private static final UUID BALANCE_ID = UUID.randomUUID();

    @Mock private InventoryStore store;
    @Mock private WarehouseScopeEvaluator scopeEvaluator;
    @Mock private SecurityAuditRecorder auditRecorder;
    private InventoryService service;

    @BeforeEach
    void setUp() {
        service = new InventoryService(store, scopeEvaluator, auditRecorder);
        when(scopeEvaluator.evaluate(TENANT_ID, USER_ID, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void failsClosedForWarehouseOutsideSelectedScope() {
        WarehouseScopeAccess selected = new WarehouseScopeAccess(
                WarehouseScopeMode.SELECTED, Set.of(UUID.randomUUID()));
        when(scopeEvaluator.evaluate(TENANT_ID, USER_ID, null))
                .thenReturn(selected);
        org.mockito.Mockito.doThrow(
                        new cn.xzkj.erp.platform.service.ResourceNotFoundException(
                                "Warehouse was not found"))
                .when(scopeEvaluator)
                .requireVisible(selected, WAREHOUSE_ID);

        assertThatThrownBy(() -> service.listBalances(
                actor(), WAREHOUSE_ID, null, null, PageRequest.of(0, 20)))
                .isInstanceOf(
                        cn.xzkj.erp.platform.service.ResourceNotFoundException.class);
        verify(store, never()).listBalances(
                any(), any(), anyBoolean(), any(), any(), any(), any());
    }

    @Test
    void emptySelectedScopeReturnsNoRowsWithoutRepositoryQuery() {
        when(scopeEvaluator.evaluate(TENANT_ID, USER_ID, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, Set.of()));

        Page<InventoryBalanceView> result = service.listBalances(
                actor(), null, null, null, PageRequest.of(0, 20));

        assertThat(result).isEmpty();
        verify(store, never()).listBalances(
                any(), any(), anyBoolean(), any(), any(), any(), any());
    }

    @Test
    void normalizesAndForwardsTheSelectedBalanceSearchField() {
        PageRequest pageable = PageRequest.of(0, 20);
        when(store.listBalances(
                TENANT_ID,
                Set.of(),
                true,
                null,
                null,
                null,
                InventoryBalanceSearchField.MASTER_SKU,
                "master_100",
                null,
                null,
                null,
                null,
                pageable))
                .thenReturn(Page.empty(pageable));

        Page<InventoryBalanceView> result = service.listBalances(
                actor(),
                null,
                null,
                InventoryBalanceSearchField.MASTER_SKU,
                " MASTER_100 ",
                pageable);

        assertThat(result).isEmpty();
        verify(store).listBalances(
                TENANT_ID,
                Set.of(),
                true,
                null,
                null,
                null,
                InventoryBalanceSearchField.MASTER_SKU,
                "master_100",
                null,
                null,
                null,
                null,
                pageable);
    }

    @Test
    void rejectsAnInvertedOnHandRangeBeforeTheRepository() {
        assertThatThrownBy(() -> service.listBalances(
                actor(),
                null,
                null,
                InventoryBalanceSearchField.ALL,
                null,
                5L,
                -1L,
                PageRequest.of(0, 20)))
                .isInstanceOf(IllegalArgumentException.class);

        verify(store, never()).listBalances(
                any(),
                any(),
                anyBoolean(),
                any(),
                any(),
                any(),
                any(),
                any(),
                any(),
                any(),
                any(),
                any(),
                any());
    }

    @Test
    void convertsInclusiveUtc8BalanceDatesToARepositoryHalfOpenRange() {
        PageRequest pageable = PageRequest.of(0, 20);
        when(store.listBalances(
                TENANT_ID,
                Set.of(),
                true,
                null,
                null,
                CATEGORY_ID,
                InventoryBalanceSearchField.ALL,
                null,
                null,
                null,
                Instant.parse("2026-06-30T16:00:00Z"),
                Instant.parse("2026-08-01T16:00:00Z"),
                pageable))
                .thenReturn(Page.empty(pageable));

        Page<InventoryBalanceView> result = service.listBalances(
                actor(),
                null,
                null,
                CATEGORY_ID,
                InventoryBalanceSearchField.ALL,
                null,
                null,
                null,
                LocalDate.of(2026, 7, 1),
                LocalDate.of(2026, 8, 1),
                pageable);

        assertThat(result).isEmpty();
        verify(store).listBalances(
                TENANT_ID,
                Set.of(),
                true,
                null,
                null,
                CATEGORY_ID,
                InventoryBalanceSearchField.ALL,
                null,
                null,
                null,
                Instant.parse("2026-06-30T16:00:00Z"),
                Instant.parse("2026-08-01T16:00:00Z"),
                pageable);
    }

    @Test
    void rejectsAnInvertedBalanceUpdatedDateRangeBeforeTheRepository() {
        assertThatThrownBy(() -> service.listBalances(
                actor(),
                null,
                null,
                InventoryBalanceSearchField.ALL,
                null,
                null,
                null,
                LocalDate.of(2026, 8, 1),
                LocalDate.of(2026, 7, 31),
                PageRequest.of(0, 20)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.listBalances(
                actor(),
                null,
                null,
                InventoryBalanceSearchField.ALL,
                null,
                null,
                null,
                LocalDate.of(10_000, 1, 1),
                null,
                PageRequest.of(0, 20)))
                .isInstanceOf(IllegalArgumentException.class);

        verify(store, never()).listBalances(
                any(),
                any(),
                anyBoolean(),
                any(),
                any(),
                any(),
                any(),
                any(),
                any(),
                any(),
                any(),
                any(),
                any());
    }

    @Test
    void skuSummariesUseOnlyTheEvaluatedWarehouseScope() {
        UUID secondSkuId = UUID.randomUUID();
        Set<UUID> visibleWarehouses = Set.of(WAREHOUSE_ID);
        WarehouseScopeAccess selected = new WarehouseScopeAccess(
                WarehouseScopeMode.SELECTED, visibleWarehouses);
        when(scopeEvaluator.evaluate(TENANT_ID, USER_ID, null))
                .thenReturn(selected);
        InventorySkuSummaryView summary =
                new InventorySkuSummaryView(SKU_ID, 12, 3);
        when(store.listSkuSummaries(
                TENANT_ID,
                visibleWarehouses,
                false,
                Set.of(SKU_ID, secondSkuId)))
                .thenReturn(List.of(summary));

        List<InventorySkuSummaryView> result =
                service.listSkuSummaries(
                        actor(),
                        List.of(SKU_ID, secondSkuId));

        assertThat(result).containsExactly(summary);
        assertThat(result.getFirst().available()).isEqualTo(9);
    }

    @Test
    void emptySelectedScopeReturnsNoSkuSummaryRows() {
        when(scopeEvaluator.evaluate(TENANT_ID, USER_ID, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, Set.of()));

        assertThat(service.listSkuSummaries(
                actor(),
                List.of(SKU_ID))).isEmpty();
        verify(store, never()).listSkuSummaries(
                any(), any(), anyBoolean(), any());
    }

    @Test
    void negativeAdjustmentUsesLockedVersionAndAtomicAudit() {
        stubNewMutation(-7, 0, -7, 1);

        InventoryMutationResult result = service.adjust(
                actor(),
                InventoryEventType.OPENING_BALANCE,
                SKU_ID,
                WAREHOUSE_ID,
                -7,
                0,
                "initial_stock",
                "Authorization: Bearer secret",
                "adjust-1");

        assertThat(result.balance().onHand()).isEqualTo(-7);
        assertThat(result.balance().available()).isEqualTo(-7);
        assertThat(result.replayed()).isFalse();
        verify(store).updateBalance(BALANCE_ID, 0, -7, 1, result.event().id());
        verify(auditRecorder).recordAtomically(any());
    }

    @Test
    void sameIdempotencyFingerprintReplaysOriginalSnapshot() {
        InventoryEventView event = event(
                InventoryEventType.CORRECTION, 4, 9, 2, null);
        InventoryBalanceView current = balance(40, 7);
        when(store.findIdempotency(TENANT_ID, "ADJUSTMENT", "same-key"))
                .thenReturn(Optional.of(new IdempotencyRecord(
                        fingerprintForCorrection(4, 1), event.id())));
        when(store.findEvent(TENANT_ID, event.id()))
                .thenReturn(Optional.of(event));
        when(store.listBalances(
                eq(TENANT_ID),
                eq(Set.of()),
                eq(true),
                eq(WAREHOUSE_ID),
                eq(SKU_ID),
                eq(null),
                any()))
                .thenReturn(new PageImpl<>(java.util.List.of(current)));

        InventoryMutationResult result = service.adjust(
                actor(),
                InventoryEventType.CORRECTION,
                SKU_ID,
                WAREHOUSE_ID,
                4,
                1,
                "stock_correction",
                null,
                "same-key");

        assertThat(result.replayed()).isTrue();
        assertThat(result.balance().onHand()).isEqualTo(9);
        assertThat(result.balance().version()).isEqualTo(2);
        verify(store, never()).lockBalance(any(), any(), any());
        verify(auditRecorder, never()).recordAtomically(any());
    }

    @Test
    void reusedIdempotencyKeyWithDifferentRequestFails() {
        when(store.findIdempotency(TENANT_ID, "ADJUSTMENT", "same-key"))
                .thenReturn(Optional.of(new IdempotencyRecord(
                        "0".repeat(64), UUID.randomUUID())));

        assertThatThrownBy(() -> service.adjust(
                actor(),
                InventoryEventType.CORRECTION,
                SKU_ID,
                WAREHOUSE_ID,
                4,
                1,
                "stock_correction",
                null,
                "same-key"))
                .isInstanceOf(InventoryConflictException.class)
                .extracting("reason")
                .isEqualTo("idempotency_conflict");
        verify(store, never()).lockBalance(any(), any(), any());
    }

    @Test
    void inactiveMasterDataRejectsNewAdjustment() {
        when(store.findIdempotency(any(), anyString(), anyString()))
                .thenReturn(Optional.empty());
        when(store.lockMasterData(TENANT_ID, SKU_ID, WAREHOUSE_ID))
                .thenReturn(new MasterDataState(
                        ProductStatus.INACTIVE, WarehouseStatus.ACTIVE));

        assertThatThrownBy(() -> service.adjust(
                actor(),
                InventoryEventType.CORRECTION,
                SKU_ID,
                WAREHOUSE_ID,
                2,
                0,
                "stock_correction",
                null,
                "inactive-1"))
                .isInstanceOf(InventoryConflictException.class)
                .extracting("reason")
                .isEqualTo("master_data_inactive");
        verify(store, never()).lockBalance(any(), any(), any());
    }

    @Test
    void reversalUsesOriginalDimensionsAndOppositeDelta() {
        UUID originalId = UUID.randomUUID();
        InventoryEventView original = event(
                InventoryEventType.OPENING_BALANCE, -12, -12, 1, null);
        original = new InventoryEventView(
                originalId,
                original.ledgerSequence(),
                original.eventType(),
                original.skuId(),
                original.skuBusinessCode(),
                original.skuName(),
                original.warehouseId(),
                original.warehouseBusinessCode(),
                original.warehouseName(),
                original.signedDelta(),
                original.balanceAfter(),
                original.balanceVersionAfter(),
                original.reason(),
                null,
                original.requestId(),
                original.recordedAt());
        when(store.findIdempotency(TENANT_ID, "REVERSAL", "reverse-1"))
                .thenReturn(Optional.empty());
        when(store.lockEvent(TENANT_ID, originalId))
                .thenReturn(Optional.of(original));
        when(store.lockMasterData(TENANT_ID, SKU_ID, WAREHOUSE_ID))
                .thenReturn(activeMasterData());
        when(store.hasReversal(TENANT_ID, originalId)).thenReturn(false);
        when(store.lockBalance(TENANT_ID, SKU_ID, WAREHOUSE_ID))
                .thenReturn(new BalanceState(BALANCE_ID, -12, 1));
        InventoryEventView reversal = event(
                InventoryEventType.REVERSAL, 12, 0, 2, originalId);
        when(store.insertEvent(
                any(),
                eq(TENANT_ID),
                eq(InventoryEventType.REVERSAL),
                eq(SKU_ID),
                eq(WAREHOUSE_ID),
                eq(12L),
                eq(0L),
                eq(2L),
                eq("REVERSAL_CORRECTION"),
                eq(null),
                eq(originalId),
                eq(USER_ID),
                eq(null),
                eq("request-1")))
                .thenReturn(reversal);
        when(store.findBalance(TENANT_ID, BALANCE_ID))
                .thenReturn(Optional.of(balance(0, 2)));

        InventoryMutationResult result = service.reverse(
                actor(),
                originalId,
                1,
                "reversal_correction",
                null,
                "reverse-1");

        assertThat(result.event().signedDelta()).isEqualTo(12);
        assertThat(result.event().reversalOfEventId()).isEqualTo(originalId);
        assertThat(result.balance().onHand()).isZero();
    }

    @Test
    void inactiveMasterDataRejectsReversalBeforeBalanceMutation() {
        UUID originalId = UUID.randomUUID();
        InventoryEventView original = event(
                InventoryEventType.CORRECTION, 5, 5, 1, null);
        when(store.findIdempotency(TENANT_ID, "REVERSAL", "inactive-reversal"))
                .thenReturn(Optional.empty());
        when(store.lockEvent(TENANT_ID, originalId))
                .thenReturn(Optional.of(new InventoryEventView(
                        originalId,
                        original.ledgerSequence(),
                        original.eventType(),
                        original.skuId(),
                        original.skuBusinessCode(),
                        original.skuName(),
                        original.warehouseId(),
                        original.warehouseBusinessCode(),
                        original.warehouseName(),
                        original.signedDelta(),
                        original.balanceAfter(),
                        original.balanceVersionAfter(),
                        original.reason(),
                        null,
                        original.requestId(),
                        original.recordedAt())));
        when(store.lockMasterData(TENANT_ID, SKU_ID, WAREHOUSE_ID))
                .thenReturn(new MasterDataState(
                        ProductStatus.ACTIVE, WarehouseStatus.ARCHIVED));

        assertThatThrownBy(() -> service.reverse(
                actor(),
                originalId,
                1,
                "reversal_correction",
                null,
                "inactive-reversal"))
                .isInstanceOf(InventoryConflictException.class)
                .extracting("reason")
                .isEqualTo("master_data_inactive");
        verify(store, never()).lockBalance(any(), any(), any());
    }

    @Test
    void repeatedReversalFailsWithoutChangingBalance() {
        UUID originalId = UUID.randomUUID();
        InventoryEventView original = event(
                InventoryEventType.CORRECTION, 2, 2, 1, null);
        when(store.findIdempotency(TENANT_ID, "REVERSAL", "reverse-2"))
                .thenReturn(Optional.empty());
        when(store.lockEvent(TENANT_ID, originalId))
                .thenReturn(Optional.of(new InventoryEventView(
                        originalId,
                        original.ledgerSequence(),
                        original.eventType(),
                        original.skuId(),
                        original.skuBusinessCode(),
                        original.skuName(),
                        original.warehouseId(),
                        original.warehouseBusinessCode(),
                        original.warehouseName(),
                        original.signedDelta(),
                        original.balanceAfter(),
                        original.balanceVersionAfter(),
                        original.reason(),
                        null,
                        original.requestId(),
                        original.recordedAt())));
        when(store.lockMasterData(TENANT_ID, SKU_ID, WAREHOUSE_ID))
                .thenReturn(activeMasterData());
        when(store.hasReversal(TENANT_ID, originalId)).thenReturn(true);

        assertThatThrownBy(() -> service.reverse(
                actor(),
                originalId,
                1,
                "reversal_correction",
                null,
                "reverse-2"))
                .isInstanceOf(InventoryConflictException.class)
                .extracting("reason")
                .isEqualTo("reversal_not_allowed");
        verify(store, never()).lockBalance(any(), any(), any());
    }

    @Test
    void staleVersionDoesNotInsertLedgerEvent() {
        when(store.findIdempotency(any(), anyString(), anyString()))
                .thenReturn(Optional.empty());
        when(store.lockMasterData(TENANT_ID, SKU_ID, WAREHOUSE_ID))
                .thenReturn(activeMasterData());
        when(store.lockBalance(TENANT_ID, SKU_ID, WAREHOUSE_ID))
                .thenReturn(new BalanceState(BALANCE_ID, 5, 3));

        assertThatThrownBy(() -> service.adjust(
                actor(),
                InventoryEventType.CORRECTION,
                SKU_ID,
                WAREHOUSE_ID,
                2,
                2,
                "stock_correction",
                null,
                "stale-1"))
                .isInstanceOf(InventoryConflictException.class)
                .extracting("reason")
                .isEqualTo("stale_version");
        verify(store, never()).insertEvent(
                any(), any(), any(), any(), any(), anyLong(), anyLong(),
                anyLong(), any(), any(), any(), any(), any(), any());
    }

    private void stubNewMutation(
            long delta, long current, long after, long versionAfter) {
        when(store.findIdempotency(any(), anyString(), anyString()))
                .thenReturn(Optional.empty());
        when(store.lockMasterData(TENANT_ID, SKU_ID, WAREHOUSE_ID))
                .thenReturn(activeMasterData());
        when(store.lockBalance(TENANT_ID, SKU_ID, WAREHOUSE_ID))
                .thenReturn(new BalanceState(BALANCE_ID, current, versionAfter - 1));
        when(store.insertEvent(
                any(),
                eq(TENANT_ID),
                any(),
                eq(SKU_ID),
                eq(WAREHOUSE_ID),
                eq(delta),
                eq(after),
                eq(versionAfter),
                anyString(),
                any(),
                any(),
                eq(USER_ID),
                eq(null),
                eq("request-1")))
                .thenAnswer(invocation -> {
                    InventoryEventView source = event(
                            invocation.getArgument(2),
                            delta,
                            after,
                            versionAfter,
                            invocation.getArgument(10));
                    return new InventoryEventView(
                            invocation.getArgument(0),
                            source.ledgerSequence(),
                            source.eventType(),
                            source.skuId(),
                            source.skuBusinessCode(),
                            source.skuName(),
                            source.warehouseId(),
                            source.warehouseBusinessCode(),
                            source.warehouseName(),
                            source.signedDelta(),
                            source.balanceAfter(),
                            source.balanceVersionAfter(),
                            source.reason(),
                            source.reversalOfEventId(),
                            source.requestId(),
                            source.recordedAt());
                });
        when(store.findBalance(TENANT_ID, BALANCE_ID))
                .thenReturn(Optional.of(balance(after, versionAfter)));
    }

    private static MasterDataState activeMasterData() {
        return new MasterDataState(
                ProductStatus.ACTIVE, WarehouseStatus.ACTIVE);
    }

    private static InventoryActor actor() {
        return new InventoryActor(
                TENANT_ID, USER_ID, null, "request-1", "127.0.0.1");
    }

    private static InventoryBalanceView balance(long onHand, long version) {
        return new InventoryBalanceView(
                BALANCE_ID,
                SKU_ID,
                "SKU_1",
                "SKU One",
                WAREHOUSE_ID,
                "WH_1",
                "Warehouse One",
                onHand,
                version,
                Instant.parse("2026-07-30T00:00:00Z"));
    }

    private static InventoryEventView event(
            InventoryEventType type,
            long delta,
            long after,
            long version,
            UUID reversalOf) {
        return new InventoryEventView(
                UUID.randomUUID(),
                version,
                type,
                SKU_ID,
                "SKU_1",
                "SKU One",
                WAREHOUSE_ID,
                "WH_1",
                "Warehouse One",
                delta,
                after,
                version,
                type == InventoryEventType.REVERSAL
                        ? "REVERSAL_CORRECTION"
                        : "STOCK_CORRECTION",
                reversalOf,
                "request-1",
                Instant.parse("2026-07-30T00:00:00Z"));
    }

    private static String fingerprintForCorrection(
            long delta, long expectedVersion) {
        try {
            java.lang.reflect.Method method = InventoryService.class
                    .getDeclaredMethod("fingerprint", String[].class);
            method.setAccessible(true);
            return (String) method.invoke(
                    null,
                    (Object) new String[] {
                        "CORRECTION",
                        SKU_ID.toString(),
                        WAREHOUSE_ID.toString(),
                        Long.toString(delta),
                        Long.toString(expectedVersion),
                        "STOCK_CORRECTION",
                        null
                    });
        } catch (ReflectiveOperationException exception) {
            throw new AssertionError(exception);
        }
    }
}
