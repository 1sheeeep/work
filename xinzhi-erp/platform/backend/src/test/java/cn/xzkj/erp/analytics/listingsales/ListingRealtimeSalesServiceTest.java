package cn.xzkj.erp.analytics.listingsales;

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

class ListingRealtimeSalesServiceTest {
    private final UUID tenantId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final ListingRealtimeSalesRepository repository =
            mock(ListingRealtimeSalesRepository.class);
    private final WarehouseScopeEvaluator scopeEvaluator =
            mock(WarehouseScopeEvaluator.class);
    private final ListingRealtimeSalesService service =
            new ListingRealtimeSalesService(repository, scopeEvaluator);
    private final ListingRealtimeSalesActor actor =
            new ListingRealtimeSalesActor(tenantId, userId, null);
    private final Instant asOf = Instant.parse("2026-08-10T12:00:00Z");

    @BeforeEach
    void allWarehouses() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void normalizesKeywordAndDelegatesWarehouseScope() {
        PageRequest pageable = PageRequest.of(0, 25);
        when(repository.summarize(
                tenantId, Set.of(), true, "sku-a", null, asOf, pageable))
                .thenReturn(ListingRealtimeSalesResult.empty());

        assertThat(service.summarize(
                actor, " SKU-A ", null, asOf, pageable).items()).isEmpty();
    }

    @Test
    void returnsEmptyWithoutQueryingWhenWarehouseScopeIsEmpty() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, Set.of()));

        assertThat(service.summarize(
                actor, null, null, asOf,
                PageRequest.of(0, 25)).items()).isEmpty();
        verify(repository, never()).summarize(
                any(), any(), eq(false), any(), any(), any(), any());
    }

    @Test
    void rejectsMissingOrNonIncreasingObservationTime() {
        assertThatThrownBy(() -> service.summarize(
                actor, null, null, null, PageRequest.of(0, 25)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.summarize(
                actor, null, asOf, asOf, PageRequest.of(0, 25)))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).summarize(
                any(), any(), any(Boolean.class), any(), any(), any(), any());
    }

    @Test
    void exportsTheBoundedAttributedResultWithSpreadsheetSafeCsv() {
        Instant from = Instant.parse("2026-08-01T00:00:00Z");
        UUID listingId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        PageRequest exportPage = PageRequest.of(
                0, ListingRealtimeSalesService.MAX_EXPORT_ROWS + 1);
        when(repository.summarize(
                tenantId, Set.of(), true, "=listing", from, asOf, exportPage))
                .thenReturn(new ListingRealtimeSalesResult(
                        List.of(new ListingRealtimeSalesItem(
                                listingId, "SHOPIFY", "Shopify", shopId,
                                "店铺,\"A\"", "=item-1", null, skuId,
                                "SKU-A", "商品 A", "黑色", 5, 2, 2, 1,
                                5, 5, 5,
                                Instant.parse("2026-08-10T10:00:00Z"))),
                        1, 5));

        var result = service.exportCsv(actor, " =LISTING ", from, asOf);

        assertThat(result.filename()).isEqualTo("listing-realtime-sales.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=utf-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content()).startsWith(
                "\uFEFF平台编码,平台名称,店铺,Listing,Listing变体,库存SKU,");
        assertThat(result.content()).contains(
                "SHOPIFY,Shopify,\"店铺,\"\"A\"\"\",'=item-1,,SKU-A,商品 A,黑色,");
        assertThat(result.content()).endsWith(
                "2026-08-10T10:00:00Z,2026-08-10T12:00:00Z\r\n");
    }

    @Test
    void rejectsExportsAboveTheBoundedRowLimit() {
        PageRequest exportPage = PageRequest.of(
                0, ListingRealtimeSalesService.MAX_EXPORT_ROWS + 1);
        when(repository.summarize(
                tenantId, Set.of(), true, null, null, asOf, exportPage))
                .thenReturn(new ListingRealtimeSalesResult(
                        List.of(),
                        ListingRealtimeSalesService.MAX_EXPORT_ROWS + 1L,
                        0));

        assertThatThrownBy(() -> service.exportCsv(actor, null, null, asOf))
                .isInstanceOf(cn.xzkj.erp.platform.service.ConflictException.class);
    }
}
