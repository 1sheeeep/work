package cn.xzkj.erp.order.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.order.repository.OrderListQueryRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class OrderSkuSalesServiceTest {
    private static final Instant NOW =
            Instant.parse("2026-07-31T12:00:00Z");

    @Mock
    private OrderListQueryRepository repository;

    private OrderSkuSalesService service;

    @BeforeEach
    void setUp() {
        service = new OrderSkuSalesService(
                repository,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void usesFixedUtcWindowsAndTenantScopedRequestedSkuSet() {
        UUID tenantId = UUID.randomUUID();
        UUID skuA = UUID.randomUUID();
        UUID skuB = UUID.randomUUID();
        SkuSalesSummaryView expected =
                new SkuSalesSummaryView(skuA, 2, 5, 8);
        when(repository.listSkuSalesSummaries(
                eq(tenantId),
                eq(Set.of(skuA, skuB)),
                eq(Instant.parse("2026-07-24T12:00:00Z")),
                eq(Instant.parse("2026-07-03T12:00:00Z")),
                eq(Instant.parse("2026-06-19T12:00:00Z"))))
                .thenReturn(List.of(expected));

        assertThat(service.listSummaries(
                tenantId,
                List.of(skuA, skuB))).containsExactly(expected);
    }

    @Test
    void deduplicatesRequestedSkuIdentitiesBeforeQuerying() {
        UUID tenantId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        when(repository.listSkuSalesSummaries(
                eq(tenantId),
                eq(Set.of(skuId)),
                eq(Instant.parse("2026-07-24T12:00:00Z")),
                eq(Instant.parse("2026-07-03T12:00:00Z")),
                eq(Instant.parse("2026-06-19T12:00:00Z"))))
                .thenReturn(List.of());

        assertThat(service.listSummaries(
                tenantId,
                List.of(skuId, skuId))).isEmpty();
    }

    @Test
    void rejectsMissingOrUnboundedIdentityRequestsWithoutQuerying() {
        UUID tenantId = UUID.randomUUID();

        assertThatThrownBy(() -> service.listSummaries(tenantId, List.of()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.listSummaries(
                tenantId,
                java.util.Collections.nCopies(51, UUID.randomUUID())))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.listSummaries(null, List.of(
                UUID.randomUUID())))
                .isInstanceOf(IllegalArgumentException.class);

        verify(repository, never()).listSkuSalesSummaries(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());
    }
}
