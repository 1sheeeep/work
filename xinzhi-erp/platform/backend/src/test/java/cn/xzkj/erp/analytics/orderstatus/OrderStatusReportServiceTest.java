package cn.xzkj.erp.analytics.orderstatus;

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
import cn.xzkj.erp.order.domain.OrderStatus;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;

class OrderStatusReportServiceTest {
    private final UUID tenantId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final OrderStatusReportRepository repository =
            mock(OrderStatusReportRepository.class);
    private final WarehouseScopeEvaluator scopeEvaluator =
            mock(WarehouseScopeEvaluator.class);
    private final OrderStatusReportService service =
            new OrderStatusReportService(repository, scopeEvaluator);
    private final OrderStatusReportActor actor =
            new OrderStatusReportActor(tenantId, userId, null);

    @BeforeEach
    void allWarehouses() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void normalizesShopFilterAndPreservesUtcWindow() {
        PageRequest pageable = PageRequest.of(0, 25);
        Instant from = Instant.parse("2026-08-01T00:00:00Z");
        Instant to = Instant.parse("2026-08-03T00:00:00Z");
        when(repository.summarize(
                tenantId, Set.of(), true, "shop a", from, to, pageable))
                .thenReturn(OrderStatusReportResult.empty());

        assertThat(service.summarize(
                actor, " Shop A ", from, to, pageable).items()).isEmpty();
    }

    @Test
    void returnsEmptyWithoutQueryingWhenWarehouseScopeIsEmpty() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, Set.of()));

        assertThat(service.summarize(
                actor, null, null, null,
                PageRequest.of(0, 25)).items()).isEmpty();
        verify(repository, never()).summarize(
                any(), any(), eq(false), any(), any(), any(), any());
    }

    @Test
    void rejectsNonIncreasingOrderWindow() {
        Instant value = Instant.parse("2026-08-02T00:00:00Z");

        assertThatThrownBy(() -> service.summarize(
                actor, null, value, value, PageRequest.of(0, 25)))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).summarize(
                any(), any(), any(Boolean.class), any(), any(), any(), any());
    }

    @Test
    void exportsTheBoundedScopedResultWithExactStatusColumns() {
        Instant from = Instant.parse("2026-08-01T00:00:00Z");
        Instant to = Instant.parse("2026-08-03T00:00:00Z");
        PageRequest exportPage = PageRequest.of(
                0, OrderStatusReportService.MAX_EXPORT_ROWS + 1);
        when(repository.summarize(
                tenantId, Set.of(), true, "shop a", from, to, exportPage))
                .thenReturn(new OrderStatusReportResult(
                        List.of(new OrderStatusReportView(
                                LocalDate.parse("2026-08-01"), 3,
                                List.of(
                                        new OrderStatusReportView.StatusCount(
                                                OrderStatus.DELIVERED, 2),
                                        new OrderStatusReportView.StatusCount(
                                                OrderStatus.CANCELLED, 1)))),
                        3, 1));

        var result = service.exportCsv(actor, " Shop A ", from, to);

        assertThat(result.filename()).isEqualTo("order-status-report.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=utf-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content()).startsWith(
                "\uFEFF日期（UTC）,订单总数,待付款,已接收,待审核,待合并,"
                        + "已搁置,待履约,履约中,已发货,已送达,已取消\r\n");
        assertThat(result.content()).contains(
                "2026-08-01,3,0,0,0,0,0,0,0,0,2,1\r\n");
    }

    @Test
    void rejectsExportsAboveTheBoundedRowLimit() {
        PageRequest exportPage = PageRequest.of(
                0, OrderStatusReportService.MAX_EXPORT_ROWS + 1);
        when(repository.summarize(
                tenantId, Set.of(), true, null, null, null, exportPage))
                .thenReturn(new OrderStatusReportResult(
                        List.of(), 0,
                        OrderStatusReportService.MAX_EXPORT_ROWS + 1L));

        assertThatThrownBy(() -> service.exportCsv(actor, null, null, null))
                .isInstanceOf(cn.xzkj.erp.platform.service.ConflictException.class);
    }
}
