package cn.xzkj.erp.analytics.inventoryaging;

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
import cn.xzkj.erp.platform.service.ConflictException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;

class InventoryAgingReportServiceTest {
    private final UUID tenantId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID warehouseId = UUID.randomUUID();
    private final InventoryAgingReportRepository repository =
            mock(InventoryAgingReportRepository.class);
    private final WarehouseScopeEvaluator scopeEvaluator =
            mock(WarehouseScopeEvaluator.class);
    private final InventoryAgingReportService service =
            new InventoryAgingReportService(repository, scopeEvaluator);
    private final InventoryAgingReportActor actor =
            new InventoryAgingReportActor(tenantId, userId, null);

    @BeforeEach
    void allWarehouses() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void usesShanghaiCutoffAndNormalizesKeyword() {
        PageRequest pageable = PageRequest.of(0, 50);
        LocalDate cutoff = LocalDate.parse("2026-08-10");
        Instant cutoffExclusive = Instant.parse("2026-08-10T16:00:00Z");
        when(repository.summarize(
                tenantId, Set.of(), true, warehouseId, "sku a",
                cutoff, cutoffExclusive, pageable))
                .thenReturn(InventoryAgingReportResult.empty());

        assertThat(service.summarize(
                actor, cutoff, warehouseId, " SKU A ", pageable)
                .items()).isEmpty();
        verify(scopeEvaluator).requireVisible(any(), eq(warehouseId));
    }

    @Test
    void returnsEmptyWithoutQueryingWhenWarehouseScopeIsEmpty() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, Set.of()));

        assertThat(service.summarize(
                actor, LocalDate.parse("2026-08-10"), null, null,
                PageRequest.of(0, 50)).items()).isEmpty();
        verify(repository, never()).summarize(
                any(), any(), eq(false), any(), any(), any(), any(), any());
    }

    @Test
    void exportsSpreadsheetSafeBoundedResult() {
        LocalDate cutoff = LocalDate.parse("2026-08-10");
        Instant cutoffExclusive = Instant.parse("2026-08-10T16:00:00Z");
        PageRequest exportPage = PageRequest.of(
                0, InventoryAgingReportService.MAX_EXPORT_ROWS + 1);
        when(repository.summarize(
                tenantId, Set.of(), true, warehouseId, "sku a",
                cutoff, cutoffExclusive, exportPage))
                .thenReturn(new InventoryAgingReportResult(
                        List.of(new InventoryAgingReportItem(
                                UUID.randomUUID(), "=SKU-A", "商品,\"A\"",
                                warehouseId, "WH-1", "主仓",
                                LocalDate.parse("2026-03-01"), 162,
                                40, 0, 0, 20, 20, 0)),
                        40, 0, 0, 20, 20, 0, 1));

        var result = service.exportCsv(
                actor, cutoff, warehouseId, " SKU A ");

        assertThat(result.filename()).isEqualTo("inventory-aging-report.csv");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content()).startsWith(
                "\uFEFF库存SKU,商品名称,仓库编码,仓库名称,最早在库日期,最长库龄(天),库存总数,0-30天,31-60天,61-90天,91-365天,365天以上\r\n");
        assertThat(result.content()).contains(
                "'=SKU-A,\"商品,\"\"A\"\"\",WH-1,主仓,2026-03-01,162,40,0,0,20,20,0\r\n");
    }

    @Test
    void rejectsUnsupportedCutoffAndOversizedExport() {
        assertThatThrownBy(() -> service.summarize(
                actor, LocalDate.parse("9999-12-31"), null, null,
                PageRequest.of(0, 50)))
                .isInstanceOf(IllegalArgumentException.class);

        LocalDate cutoff = LocalDate.parse("2026-08-10");
        PageRequest exportPage = PageRequest.of(
                0, InventoryAgingReportService.MAX_EXPORT_ROWS + 1);
        when(repository.summarize(
                tenantId, Set.of(), true, null, null, cutoff,
                Instant.parse("2026-08-10T16:00:00Z"), exportPage))
                .thenReturn(new InventoryAgingReportResult(
                        List.of(), 0, 0, 0, 0, 0, 0,
                        InventoryAgingReportService.MAX_EXPORT_ROWS + 1L));

        assertThatThrownBy(() -> service.exportCsv(
                actor, cutoff, null, null))
                .isInstanceOf(ConflictException.class);
    }
}
