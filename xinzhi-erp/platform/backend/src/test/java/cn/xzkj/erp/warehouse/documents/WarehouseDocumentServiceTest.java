package cn.xzkj.erp.warehouse.documents;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeMode;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.ApprovalStatus;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.Direction;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.SearchField;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.Source;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.Status;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

class WarehouseDocumentServiceTest {
    private final UUID tenantId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID warehouseId = UUID.randomUUID();
    private final WarehouseDocumentRepository repository =
            mock(WarehouseDocumentRepository.class);
    private final WarehouseScopeEvaluator scopeEvaluator =
            mock(WarehouseScopeEvaluator.class);
    private final WarehouseDocumentService service =
            new WarehouseDocumentService(repository, scopeEvaluator);
    private final WarehouseDocumentActor actor =
            new WarehouseDocumentActor(tenantId, userId, null);

    @BeforeEach
    void resetScope() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void normalizesKeywordAndPreservesWarehouseScope() {
        PageRequest pageable = PageRequest.of(0, 25);
        when(repository.list(
                eq(tenantId), eq(Set.of()), eq(true), eq(warehouseId),
                eq(Direction.INBOUND), eq(null), eq(null), eq(null),
                eq(SearchField.DOCUMENT_NO), eq("po-100"),
                eq(null), eq(null), eq(pageable)))
                .thenReturn(Page.empty(pageable));

        Page<WarehouseDocumentView> result = service.list(
                actor, warehouseId, Direction.INBOUND, null, null, null,
                null, "  PO-100  ", null, null, pageable);

        assertThat(result).isEmpty();
        verify(scopeEvaluator).requireVisible(any(), eq(warehouseId));
    }

    @Test
    void returnsAnEmptyPageWithoutQueryingWhenScopeHasNoWarehouses() {
        PageRequest pageable = PageRequest.of(2, 25);
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, Set.of()));

        Page<WarehouseDocumentView> result = service.list(
                actor, null, Direction.OUTBOUND, null, null, null,
                SearchField.SKU, null, null, null, pageable);

        assertThat(result.getNumber()).isEqualTo(2);
        assertThat(result).isEmpty();
        verify(repository, never()).list(
                any(), any(), eq(false), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any());
    }

    @Test
    void rejectsAnInvertedDateRangeBeforeQuerying() {
        Instant later = Instant.parse("2026-08-02T10:00:00Z");
        Instant earlier = Instant.parse("2026-08-01T10:00:00Z");

        assertThatThrownBy(() -> service.list(
                actor, null, Direction.INBOUND, null, null, null,
                SearchField.DOCUMENT_NO, null, later, earlier,
                PageRequest.of(0, 25)))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).list(
                any(), any(), any(Boolean.class), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any());
    }

    @Test
    void exportsTheScopedFilterAsSafeUtf8Csv() {
        Instant occurredFrom = Instant.parse("2026-08-01T00:00:00Z");
        Instant occurredTo = Instant.parse("2026-08-02T23:59:59Z");
        PageRequest exportPage = PageRequest.of(
                0, WarehouseDocumentService.MAX_EXPORT_ROWS + 1);
        WarehouseDocumentView document = new WarehouseDocumentView(
                UUID.randomUUID(), UUID.randomUUID(), Source.INVENTORY_COUNT,
                Direction.INBOUND, "=COUNT-1", "-SOURCE-1",
                "盘点,\"差异\"", warehouseId, "+WH-A", " =主仓",
                Status.PARTIALLY_REVERSED, ApprovalStatus.APPROVED,
                2, 8, new BigDecimal("12.50"), "CNY", "@operator",
                Instant.parse("2026-08-02T08:00:00Z"),
                Instant.parse("2026-08-02T08:01:00Z"));
        when(repository.list(
                eq(tenantId), eq(Set.of()), eq(true), eq(warehouseId),
                eq(Direction.INBOUND), eq(Source.INVENTORY_COUNT),
                eq(Status.PARTIALLY_REVERSED), eq(ApprovalStatus.APPROVED),
                eq(SearchField.SKU), eq("=needle"), eq(occurredFrom),
                eq(occurredTo), eq(exportPage)))
                .thenReturn(new PageImpl<>(List.of(document), exportPage, 1));

        var result = service.exportCsv(
                actor, warehouseId, Direction.INBOUND, Source.INVENTORY_COUNT,
                Status.PARTIALLY_REVERSED, ApprovalStatus.APPROVED,
                SearchField.SKU, "  =NEEDLE  ", occurredFrom, occurredTo);

        assertThat(result.filename()).isEqualTo("warehouse-documents-inbound.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=utf-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content()).startsWith("\uFEFF单号,单据方向");
        assertThat(result.content()).contains("'=COUNT-1");
        assertThat(result.content()).contains("\"盘点,\"\"差异\"\"\"");
        assertThat(result.content()).contains("'+WH-A");
        assertThat(result.content()).contains("' =主仓");
        assertThat(result.content()).contains("'@operator");
        assertThat(result.content()).contains("'-SOURCE-1");
        verify(scopeEvaluator).requireVisible(any(), eq(warehouseId));
    }

    @Test
    void rejectsAnExportAboveTheBoundedRowLimit() {
        PageRequest exportPage = PageRequest.of(
                0, WarehouseDocumentService.MAX_EXPORT_ROWS + 1);
        when(repository.list(
                eq(tenantId), eq(Set.of()), eq(true), eq(null),
                eq(Direction.OUTBOUND), eq(null), eq(null), eq(null),
                eq(SearchField.DOCUMENT_NO), eq(null), eq(null), eq(null),
                eq(exportPage)))
                .thenReturn(new PageImpl<>(
                        List.of(), exportPage,
                        WarehouseDocumentService.MAX_EXPORT_ROWS + 1L));

        assertThatThrownBy(() -> service.exportCsv(
                actor, null, Direction.OUTBOUND, null, null, null,
                SearchField.DOCUMENT_NO, null, null, null))
                .isInstanceOf(ConflictException.class);
        verify(repository).list(
                any(), any(), anyBoolean(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any());
    }

    @Test
    void exportsOnlyTheHeaderWhenTheActorHasNoWarehouseScope() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, Set.of()));

        var result = service.exportCsv(
                actor, null, Direction.INBOUND, null, null, null,
                SearchField.DOCUMENT_NO, null, null, null);

        assertThat(result.rowCount()).isZero();
        assertThat(result.content()).startsWith("\uFEFF单号,单据方向");
        assertThat(result.content().lines()).hasSize(1);
        verify(repository, never()).list(
                any(), any(), anyBoolean(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), any());
    }
}
