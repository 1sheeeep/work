package cn.xzkj.erp.analytics.inventorysales;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeMode;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;

class InventoryRealtimeSalesServiceTest {
    private final UUID tenantId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final InventoryRealtimeSalesRepository repository =
            mock(InventoryRealtimeSalesRepository.class);
    private final WarehouseScopeEvaluator scopeEvaluator =
            mock(WarehouseScopeEvaluator.class);
    private final InventoryRealtimeSalesService service =
            new InventoryRealtimeSalesService(repository, scopeEvaluator);
    private final InventoryRealtimeSalesActor actor =
            new InventoryRealtimeSalesActor(tenantId, userId, null);

    @BeforeEach
    void allWarehouses() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void normalizesKeywordAndPreservesExplicitObservationWindow() {
        Instant from = Instant.parse("2026-08-01T00:00:00Z");
        Instant asOf = Instant.parse("2026-08-10T12:00:00Z");
        PageRequest pageable = PageRequest.of(0, 25);
        when(repository.summarize(
                tenantId, Set.of(), true, "sku a", from, asOf, pageable))
                .thenReturn(InventoryRealtimeSalesResult.empty());

        assertThat(service.summarize(
                actor, " SKU A ", from, asOf, pageable).items()).isEmpty();

        verify(repository).summarize(
                tenantId, Set.of(), true, "sku a", from, asOf, pageable);
    }

    @Test
    void returnsEmptyWithoutQueryingWhenWarehouseScopeIsEmpty() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, Set.of()));

        assertThat(service.summarize(
                actor, null, null,
                Instant.parse("2026-08-10T12:00:00Z"),
                PageRequest.of(0, 25)).items()).isEmpty();
        verify(repository, never()).summarize(
                any(), any(), eq(false), any(), any(), any(), any());
    }

    @Test
    void rejectsMissingOrNonIncreasingObservationWindow() {
        Instant asOf = Instant.parse("2026-08-10T12:00:00Z");
        PageRequest pageable = PageRequest.of(0, 25);

        assertThatThrownBy(() -> service.summarize(
                actor, null, null, null, pageable))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.summarize(
                actor, null, asOf, asOf, pageable))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).summarize(
                any(), any(), any(Boolean.class), any(), any(), any(), any());
    }

    @Test
    void exportsTheBoundedScopedResultWithSpreadsheetSafeCsv() {
        Instant from = Instant.parse("2026-08-01T00:00:00Z");
        Instant asOf = Instant.parse("2026-08-10T12:00:00Z");
        UUID balanceId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        UUID warehouseId = UUID.randomUUID();
        PageRequest exportPage = PageRequest.of(
                0, InventoryRealtimeSalesService.MAX_EXPORT_ROWS + 1);
        when(repository.summarize(
                tenantId, Set.of(), true, "=sku", from, asOf, exportPage))
                .thenReturn(new InventoryRealtimeSalesResult(
                        List.of(new InventoryRealtimeSalesItem(
                                balanceId, skuId, "=SKU", "商品,\"A\"", null,
                                warehouseId, "WH-A", "仓库 A", 20, 3, 17,
                                9, 2, 3, 2, 9, 14, 20,
                                Instant.parse("2026-08-10T11:00:00Z"))),
                        1, 20, 3, 17, 9));

        var result = service.exportCsv(actor, " =SKU ", from, asOf);

        assertThat(result.filename()).isEqualTo("inventory-realtime-sales.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=utf-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content()).startsWith(
                "\uFEFF库存SKU,SKU名称,规格,仓库编码,仓库名称,现货,预留,可用,");
        assertThat(result.content()).contains(
                "'=SKU,\"商品,\"\"A\"\"\",,WH-A,仓库 A,20,3,17,9,2,");
        assertThat(result.content()).endsWith(
                "2026-08-10T11:00:00Z,2026-08-10T12:00:00Z\r\n");
    }

    @Test
    void rejectsExportsAboveTheBoundedRowLimit() {
        Instant asOf = Instant.parse("2026-08-10T12:00:00Z");
        PageRequest exportPage = PageRequest.of(
                0, InventoryRealtimeSalesService.MAX_EXPORT_ROWS + 1);
        when(repository.summarize(
                tenantId, Set.of(), true, null, null, asOf, exportPage))
                .thenReturn(new InventoryRealtimeSalesResult(
                        List.of(),
                        InventoryRealtimeSalesService.MAX_EXPORT_ROWS + 1L,
                        0, 0, 0, 0));

        assertThatThrownBy(() -> service.exportCsv(actor, null, null, asOf))
                .isInstanceOf(cn.xzkj.erp.platform.service.ConflictException.class);
    }
}
