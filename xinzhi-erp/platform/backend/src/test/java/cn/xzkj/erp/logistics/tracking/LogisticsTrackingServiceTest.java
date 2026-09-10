package cn.xzkj.erp.logistics.tracking;

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
import cn.xzkj.erp.logistics.tracking.LogisticsTrackingView.PackageStatus;
import cn.xzkj.erp.logistics.tracking.LogisticsTrackingView.SearchField;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

class LogisticsTrackingServiceTest {
    private final UUID tenantId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final LogisticsTrackingRepository repository =
            mock(LogisticsTrackingRepository.class);
    private final WarehouseScopeEvaluator scopeEvaluator =
            mock(WarehouseScopeEvaluator.class);
    private final LogisticsTrackingService service =
            new LogisticsTrackingService(repository, scopeEvaluator);
    private final LogisticsTrackingActor actor =
            new LogisticsTrackingActor(tenantId, userId, null);

    @BeforeEach
    void allWarehouses() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void normalizesFiltersAndPreservesKnownTrackingStatus() {
        PageRequest pageable = PageRequest.of(0, 25);
        when(repository.list(
                eq(tenantId), eq(Set.of()), eq(true), eq("shop a"),
                eq("carrier"), eq("US"), eq("main"), eq("priority"),
                eq(SearchField.TRACKING_NO), eq("tn-1"),
                eq(PackageStatus.IN_TRANSIT), eq(null), eq(null),
                eq(pageable)))
                .thenReturn(Page.empty(pageable));

        Page<LogisticsTrackingView> result = service.list(
                actor, " Shop A ", " Carrier ", " us ", " Main ",
                " Priority ", SearchField.TRACKING_NO, " TN-1 ",
                PackageStatus.IN_TRANSIT, null, null, pageable);

        assertThat(result).isEmpty();
    }

    @Test
    void returnsEmptyWithoutQueryingWhenWarehouseScopeIsEmpty() {
        PageRequest pageable = PageRequest.of(2, 25);
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, Set.of()));

        Page<LogisticsTrackingView> result = service.list(
                actor, null, null, null, null, null, null, null,
                null, null, null, pageable);

        assertThat(result.getNumber()).isEqualTo(2);
        assertThat(result).isEmpty();
        verify(repository, never()).list(
                any(), any(), eq(false), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any(), any());
    }

    @Test
    void rejectsInvertedShipmentDatesBeforeQuerying() {
        Instant later = Instant.parse("2026-08-02T10:00:00Z");
        Instant earlier = Instant.parse("2026-08-01T10:00:00Z");

        assertThatThrownBy(() -> service.list(
                actor, null, null, null, null, null,
                SearchField.ORDER_NO, null, null, later, earlier,
                PageRequest.of(0, 25)))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).list(
                any(), any(), any(Boolean.class), any(), any(), any(), any(),
                any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void exportsBoundedFilteredTrackingRowsWithSpreadsheetSafeCsv() {
        Instant from = Instant.parse("2026-08-01T00:00:00Z");
        Instant to = Instant.parse("2026-08-02T23:59:59.999Z");
        PageRequest exportPage = PageRequest.of(
                0, LogisticsTrackingService.MAX_EXPORT_ROWS + 1);
        LogisticsTrackingView item = new LogisticsTrackingView(
                UUID.randomUUID(), "SHOPIFY", "Shopify", "=Demo,\"A\"",
                "ORDER-1", "US", "WH-1 · Main", "UPS", "+TN-1", null,
                "IN_TRANSIT", null, "Priority", from, to);
        when(repository.list(
                tenantId, Set.of(), true, "shop a", "ups", "US", "main",
                "priority", SearchField.TRACKING_NO, "tn-1",
                PackageStatus.IN_TRANSIT, from, to, exportPage))
                .thenReturn(new PageImpl<>(List.of(item), exportPage, 1));

        var result = service.exportCsv(
                actor, " Shop A ", " UPS ", " us ", " Main ",
                " Priority ", SearchField.TRACKING_NO, " TN-1 ",
                PackageStatus.IN_TRANSIT, from, to);

        assertThat(result.filename()).isEqualTo("logistics-tracking.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=utf-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content()).startsWith(
                "\uFEFF平台编码,平台名称,店铺名称,订单号,目的国家,仓库,物流渠道,"
                        + "主运单号,备用运单号,跟踪状态,固定分类,自定义分类,发货时间,"
                        + "更新时间\r\n");
        assertThat(result.content()).contains("\"'=Demo,\"\"A\"\"\"");
        assertThat(result.content()).contains(",'+TN-1,");
    }

    @Test
    void rejectsTrackingExportsAboveTheBoundedRowLimit() {
        PageRequest exportPage = PageRequest.of(
                0, LogisticsTrackingService.MAX_EXPORT_ROWS + 1);
        when(repository.list(
                tenantId, Set.of(), true, null, null, null, null, null,
                SearchField.ORDER_NO, null, null, null, null, exportPage))
                .thenReturn(new PageImpl<>(
                        List.of(), exportPage,
                        LogisticsTrackingService.MAX_EXPORT_ROWS + 1L));

        assertThatThrownBy(() -> service.exportCsv(
                actor, null, null, null, null, null,
                SearchField.ORDER_NO, null, null, null, null))
                .isInstanceOf(cn.xzkj.erp.platform.service.ConflictException.class);
    }
}
