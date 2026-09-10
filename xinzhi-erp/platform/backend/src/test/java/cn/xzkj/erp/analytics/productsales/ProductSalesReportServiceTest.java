package cn.xzkj.erp.analytics.productsales;

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

class ProductSalesReportServiceTest {
    private final UUID tenantId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final ProductSalesReportRepository repository =
            mock(ProductSalesReportRepository.class);
    private final WarehouseScopeEvaluator scopeEvaluator =
            mock(WarehouseScopeEvaluator.class);
    private final ProductSalesReportService service =
            new ProductSalesReportService(repository, scopeEvaluator);
    private final ProductSalesReportActor actor =
            new ProductSalesReportActor(tenantId, userId, null);

    @BeforeEach
    void allWarehouses() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void normalizesSkuKeywordAndPreservesUtcWindow() {
        Instant from = Instant.parse("2026-08-01T00:00:00Z");
        Instant to = Instant.parse("2026-08-03T00:00:00Z");
        PageRequest pageable = PageRequest.of(0, 25);
        when(repository.summarize(
                tenantId, Set.of(), true, "sku a", from, to, pageable))
                .thenReturn(ProductSalesReportResult.empty());

        assertThat(service.summarize(
                actor, " SKU A ", from, to, pageable).items()).isEmpty();

        verify(repository).summarize(
                tenantId, Set.of(), true, "sku a", from, to, pageable);
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
    void exportsTheBoundedScopedResultWithSpreadsheetSafeCsv() {
        Instant from = Instant.parse("2026-08-01T00:00:00Z");
        Instant to = Instant.parse("2026-08-03T00:00:00Z");
        UUID skuId = UUID.randomUUID();
        PageRequest exportPage = PageRequest.of(
                0, ProductSalesReportService.MAX_EXPORT_ROWS + 1);
        when(repository.summarize(
                tenantId, Set.of(), true, "=sku", from, to, exportPage))
                .thenReturn(new ProductSalesReportResult(
                        List.of(new ProductSalesReportItem(
                                skuId, "=SKU-A", "商品,\"A\"", null,
                                2, 5,
                                Instant.parse("2026-08-01T01:00:00Z"),
                                Instant.parse("2026-08-02T01:00:00Z"))),
                        1, 5));

        var result = service.exportCsv(actor, " =SKU ", from, to);

        assertThat(result.filename()).isEqualTo("product-sales-report.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=utf-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content()).startsWith(
                "\uFEFF库存SKU,SKU名称,规格,关联订单数,销售数量,首次下单,最近下单\r\n");
        assertThat(result.content()).contains(
                "'=SKU-A,\"商品,\"\"A\"\"\",,2,5,");
    }

    @Test
    void rejectsExportsAboveTheBoundedRowLimit() {
        PageRequest exportPage = PageRequest.of(
                0, ProductSalesReportService.MAX_EXPORT_ROWS + 1);
        when(repository.summarize(
                tenantId, Set.of(), true, null, null, null, exportPage))
                .thenReturn(new ProductSalesReportResult(
                        List.of(),
                        ProductSalesReportService.MAX_EXPORT_ROWS + 1L,
                        0));

        assertThatThrownBy(() -> service.exportCsv(actor, null, null, null))
                .isInstanceOf(cn.xzkj.erp.platform.service.ConflictException.class);
    }
}
