package cn.xzkj.erp.analytics.productboard;

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
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ProductSalesBoardServiceTest {
    private final UUID tenantId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final ProductSalesBoardRepository repository =
            mock(ProductSalesBoardRepository.class);
    private final WarehouseScopeEvaluator scopeEvaluator =
            mock(WarehouseScopeEvaluator.class);
    private final ProductSalesBoardService service =
            new ProductSalesBoardService(repository, scopeEvaluator);
    private final ProductSalesBoardActor actor =
            new ProductSalesBoardActor(tenantId, userId, null);

    @BeforeEach
    void allWarehouses() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.ALL, Set.of()));
    }

    @Test
    void usesFixedSevenDayUtcWindow() {
        Instant observedAt = Instant.parse("2026-08-08T00:00:00Z");
        Instant rangeFrom = Instant.parse("2026-08-01T00:00:00Z");
        when(repository.summarize(
                tenantId, Set.of(), true, rangeFrom, observedAt, 5))
                .thenReturn(ProductSalesBoardResult.empty());

        assertThat(service.summarize(actor, observedAt, 5).hotItems()).isEmpty();

        verify(repository).summarize(
                tenantId, Set.of(), true, rangeFrom, observedAt, 5);
    }

    @Test
    void returnsEmptyWithoutQueryingWhenWarehouseScopeIsEmpty() {
        when(scopeEvaluator.evaluate(tenantId, userId, null))
                .thenReturn(new WarehouseScopeAccess(
                        WarehouseScopeMode.SELECTED, Set.of()));

        assertThat(service.summarize(
                actor, Instant.parse("2026-08-08T00:00:00Z"), 5)
                .activeSkuCount()).isZero();
        verify(repository, never()).summarize(
                any(), any(), eq(false), any(), any(), any(Integer.class));
    }

    @Test
    void rejectsInvalidLimitBeforeResolvingScope() {
        assertThatThrownBy(() -> service.summarize(
                actor, Instant.parse("2026-08-08T00:00:00Z"), 11))
                .isInstanceOf(IllegalArgumentException.class);
        verify(scopeEvaluator, never()).evaluate(any(), any(), any());
    }
}
