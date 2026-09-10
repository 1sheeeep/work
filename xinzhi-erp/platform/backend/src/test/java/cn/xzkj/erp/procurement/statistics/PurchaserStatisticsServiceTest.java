package cn.xzkj.erp.procurement.statistics;

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

class PurchaserStatisticsServiceTest {
    private final UUID tenantId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final PurchaserStatisticsRepository repository =
            mock(PurchaserStatisticsRepository.class);
    private final WarehouseScopeEvaluator scopeEvaluator =
            mock(WarehouseScopeEvaluator.class);
    private final PurchaserStatisticsService service =
            new PurchaserStatisticsService(repository, scopeEvaluator);
    private final PurchaserStatisticsActor actor =
            new PurchaserStatisticsActor(tenantId, userId, null);

    @BeforeEach
    void allWarehouses() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void normalizesPurchaserAndPreservesUtcWindow() {
        PageRequest pageable = PageRequest.of(0, 25);
        Instant from = Instant.parse("2026-08-01T00:00:00Z");
        Instant to = Instant.parse("2026-09-01T00:00:00Z");
        when(repository.summarize(
                tenantId, Set.of(), true,
                PurchaserStatisticsGranularity.MONTH,
                "purchaser a", from, to, pageable))
                .thenReturn(PurchaserStatisticsResult.empty());

        assertThat(service.summarize(
                actor, PurchaserStatisticsGranularity.MONTH,
                " Purchaser A ", from, to, pageable).items()).isEmpty();
    }

    @Test
    void returnsEmptyWithoutQueryWhenWarehouseScopeIsEmpty() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, Set.of()));

        assertThat(service.summarize(
                actor, PurchaserStatisticsGranularity.DAY, null,
                null, null, PageRequest.of(0, 25)).items()).isEmpty();
        verify(repository, never()).summarize(
                any(), any(), eq(false), any(), any(), any(), any(), any());
    }

    @Test
    void rejectsNonIncreasingWindow() {
        Instant value = Instant.parse("2026-08-02T00:00:00Z");

        assertThatThrownBy(() -> service.summarize(
                actor, PurchaserStatisticsGranularity.DAY, null,
                value, value, PageRequest.of(0, 25)))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).summarize(
                any(), any(), any(Boolean.class), any(), any(), any(), any(),
                any());
    }

    @Test
    void exportsTheBoundedOperationalResultWithSpreadsheetSafeCsv() {
        Instant from = Instant.parse("2026-08-01T00:00:00Z");
        Instant to = Instant.parse("2026-09-01T00:00:00Z");
        PageRequest exportPage = PageRequest.of(
                0, PurchaserStatisticsService.MAX_EXPORT_ROWS + 1);
        when(repository.summarize(
                tenantId, Set.of(), true,
                PurchaserStatisticsGranularity.MONTH,
                "=buyer", from, to, exportPage))
                .thenReturn(new PurchaserStatisticsResult(
                        List.of(new PurchaserStatisticsView(
                                LocalDate.parse("2026-08-01"),
                                "=Buyer,\"A\"", 4, 12, 7, 5, 1, 1, 1, 1)),
                        4, 12, 7, 5, 1));

        var result = service.exportCsv(
                actor, PurchaserStatisticsGranularity.MONTH,
                " =Buyer ", from, to);

        assertThat(result.filename()).isEqualTo("purchaser-statistics.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=utf-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content()).startsWith(
                "\uFEFF统计期间（UTC）,统计粒度,采购员名称快照,采购单数,"
                        + "采购数量,已收数量,待收数量,待审核,待收货,部分收货,已收货\r\n");
        assertThat(result.content()).contains(
                "2026-08-01,MONTH,\"'=Buyer,\"\"A\"\"\",4,12,7,5,1,1,1,1\r\n");
    }

    @Test
    void rejectsExportsAboveTheBoundedRowLimit() {
        PageRequest exportPage = PageRequest.of(
                0, PurchaserStatisticsService.MAX_EXPORT_ROWS + 1);
        when(repository.summarize(
                tenantId, Set.of(), true,
                PurchaserStatisticsGranularity.DAY,
                null, null, null, exportPage))
                .thenReturn(new PurchaserStatisticsResult(
                        List.of(), 0, 0, 0, 0,
                        PurchaserStatisticsService.MAX_EXPORT_ROWS + 1L));

        assertThatThrownBy(() -> service.exportCsv(
                actor, PurchaserStatisticsGranularity.DAY,
                null, null, null))
                .isInstanceOf(cn.xzkj.erp.platform.service.ConflictException.class);
    }
}
