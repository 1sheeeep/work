package cn.xzkj.erp.logistics.statistics;

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
import cn.xzkj.erp.logistics.statistics.LogisticsStatisticsView.Dimension;
import cn.xzkj.erp.logistics.tracking.LogisticsTrackingActor;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;

class LogisticsStatisticsServiceTest {
    private final UUID tenantId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final LogisticsStatisticsRepository repository =
            mock(LogisticsStatisticsRepository.class);
    private final WarehouseScopeEvaluator scopeEvaluator =
            mock(WarehouseScopeEvaluator.class);
    private final LogisticsStatisticsService service =
            new LogisticsStatisticsService(repository, scopeEvaluator);
    private final LogisticsTrackingActor actor =
            new LogisticsTrackingActor(tenantId, userId, null);

    @BeforeEach
    void allWarehouses() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void normalizesFilterAndDefaultsDimension() {
        PageRequest pageable = PageRequest.of(0, 25);
        when(repository.summarize(
                tenantId, Set.of(), true, Dimension.COUNTRY, "united",
                null, null, pageable))
                .thenReturn(LogisticsStatisticsResult.empty());

        assertThat(service.summarize(
                actor, null, " United ", null, null, pageable).items())
                .isEmpty();
    }

    @Test
    void returnsEmptyWithoutQueryingWhenWarehouseScopeIsEmpty() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, Set.of()));

        assertThat(service.summarize(
                actor, Dimension.CHANNEL, null, null, null,
                PageRequest.of(0, 25)).items()).isEmpty();
        verify(repository, never()).summarize(
                any(), any(), eq(false), any(), any(), any(), any(), any());
    }

    @Test
    void rejectsNonIncreasingShipmentWindow() {
        Instant start = Instant.parse("2026-08-02T00:00:00Z");

        assertThatThrownBy(() -> service.summarize(
                actor, Dimension.COUNTRY, null, start, start,
                PageRequest.of(0, 25)))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).summarize(
                any(), any(), any(Boolean.class), any(), any(), any(), any(),
                any());
    }

    @Test
    void exportsTheBoundedScopedResultWithSpreadsheetSafeCsv() {
        Instant from = Instant.parse("2026-08-01T00:00:00Z");
        Instant to = Instant.parse("2026-08-03T00:00:00Z");
        PageRequest exportPage = PageRequest.of(
                0, LogisticsStatisticsService.MAX_EXPORT_ROWS + 1);
        when(repository.summarize(
                tenantId, Set.of(), true, Dimension.CHANNEL, "ups",
                from, to, exportPage))
                .thenReturn(new LogisticsStatisticsResult(
                        List.of(new LogisticsStatisticsView(
                                "=UPS,Express", 3,
                                List.of(
                                        new LogisticsStatisticsView.StatusCount(
                                                "DELIVERED", 2),
                                        new LogisticsStatisticsView.StatusCount(
                                                null, 1)))),
                        List.of(), 3, 1));

        var result = service.exportCsv(
                actor, Dimension.CHANNEL, " UPS ", from, to);

        assertThat(result.filename()).isEqualTo("logistics-statistics.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=utf-8");
        assertThat(result.rowCount()).isEqualTo(2);
        assertThat(result.content()).startsWith(
                "\uFEFF统计维度,分组值,跟踪状态,状态记录数,分组记录数\r\n");
        assertThat(result.content()).contains(
                "物流渠道,\"'=UPS,Express\",DELIVERED,2,3\r\n");
        assertThat(result.content()).contains(
                "物流渠道,\"'=UPS,Express\",,1,3\r\n");
    }

    @Test
    void rejectsExportsAboveTheBoundedRowLimit() {
        PageRequest exportPage = PageRequest.of(
                0, LogisticsStatisticsService.MAX_EXPORT_ROWS + 1);
        when(repository.summarize(
                tenantId, Set.of(), true, Dimension.COUNTRY, null,
                null, null, exportPage))
                .thenReturn(new LogisticsStatisticsResult(
                        List.of(), List.of(), 0,
                        LogisticsStatisticsService.MAX_EXPORT_ROWS + 1L));

        assertThatThrownBy(() -> service.exportCsv(
                actor, Dimension.COUNTRY, null, null, null))
                .isInstanceOf(cn.xzkj.erp.platform.service.ConflictException.class);
    }
}
