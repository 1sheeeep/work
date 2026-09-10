package cn.xzkj.erp.analytics.inventoryperiod;

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
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;

class InventoryPeriodReportServiceTest {
    private final UUID tenantId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID warehouseId = UUID.randomUUID();
    private final InventoryPeriodReportRepository repository =
            mock(InventoryPeriodReportRepository.class);
    private final WarehouseScopeEvaluator scopeEvaluator =
            mock(WarehouseScopeEvaluator.class);
    private final InventoryPeriodReportService service =
            new InventoryPeriodReportService(repository, scopeEvaluator);
    private final InventoryPeriodReportActor actor =
            new InventoryPeriodReportActor(tenantId, userId, null);

    @BeforeEach
    void allWarehouses() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void usesShanghaiDayBoundariesAndNormalizesKeyword() {
        PageRequest pageable = PageRequest.of(0, 50);
        Instant from = Instant.parse("2026-06-30T16:00:00Z");
        Instant to = Instant.parse("2026-07-31T16:00:00Z");
        when(repository.summarize(
                tenantId, Set.of(), true, warehouseId, "sku a",
                from, to, pageable))
                .thenReturn(InventoryPeriodReportResult.empty());

        assertThat(service.summarize(
                actor,
                LocalDate.parse("2026-07-01"),
                LocalDate.parse("2026-07-31"),
                warehouseId,
                " SKU A ",
                pageable).items()).isEmpty();
        verify(scopeEvaluator).requireVisible(any(), eq(warehouseId));
    }

    @Test
    void returnsEmptyWithoutQueryingWhenWarehouseScopeIsEmpty() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, Set.of()));

        assertThat(service.summarize(
                actor,
                LocalDate.parse("2026-07-01"),
                LocalDate.parse("2026-07-31"),
                null,
                null,
                PageRequest.of(0, 50)).items()).isEmpty();
        verify(repository, never()).summarize(
                any(), any(), eq(false), any(), any(), any(), any(), any());
    }

    @Test
    void rejectsReversedOrUnsupportedPeriods() {
        assertThatThrownBy(() -> service.summarize(
                actor,
                LocalDate.parse("2026-08-01"),
                LocalDate.parse("2026-07-31"),
                null,
                null,
                PageRequest.of(0, 50)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.summarize(
                actor,
                LocalDate.parse("9999-12-31"),
                LocalDate.parse("9999-12-31"),
                null,
                null,
                PageRequest.of(0, 50)))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).summarize(
                any(), any(), any(Boolean.class), any(), any(),
                any(), any(), any());
    }

    @Test
    void exportsTheBoundedScopedResultWithSpreadsheetSafeCsv() {
        LocalDate fromDate = LocalDate.parse("2026-07-01");
        LocalDate toDate = LocalDate.parse("2026-07-31");
        Instant from = Instant.parse("2026-06-30T16:00:00Z");
        Instant to = Instant.parse("2026-07-31T16:00:00Z");
        PageRequest exportPage = PageRequest.of(
                0, InventoryPeriodReportService.MAX_EXPORT_ROWS + 1);
        when(repository.summarize(
                tenantId, Set.of(), true, warehouseId, "sku a",
                from, to, exportPage))
                .thenReturn(new InventoryPeriodReportResult(
                        List.of(new InventoryPeriodReportItem(
                                UUID.randomUUID(), "=SKU-A", "商品,\"A\"",
                                warehouseId, "WH-1", "主仓",
                                10, 5, 3, 12)),
                        10, 5, 3, 12, 1));

        var result = service.exportCsv(
                actor, fromDate, toDate, warehouseId, " SKU A ");

        assertThat(result.filename()).isEqualTo("inventory-period-report.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=utf-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content()).startsWith(
                "\uFEFF库存SKU,商品名称,仓库编码,仓库名称,期初数量,期间增加,期间减少,期末数量\r\n");
        assertThat(result.content()).contains(
                "'=SKU-A,\"商品,\"\"A\"\"\",WH-1,主仓,10,5,3,12\r\n");
    }

    @Test
    void rejectsExportsAboveTheBoundedRowLimit() {
        PageRequest exportPage = PageRequest.of(
                0, InventoryPeriodReportService.MAX_EXPORT_ROWS + 1);
        when(repository.summarize(
                tenantId, Set.of(), true, null, null,
                Instant.parse("2026-06-30T16:00:00Z"),
                Instant.parse("2026-07-31T16:00:00Z"), exportPage))
                .thenReturn(new InventoryPeriodReportResult(
                        List.of(), 0, 0, 0, 0,
                        InventoryPeriodReportService.MAX_EXPORT_ROWS + 1L));

        assertThatThrownBy(() -> service.exportCsv(
                actor, LocalDate.parse("2026-07-01"),
                LocalDate.parse("2026-07-31"), null, null))
                .isInstanceOf(cn.xzkj.erp.platform.service.ConflictException.class);
    }
}
