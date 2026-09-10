package cn.xzkj.erp.order.service;

import cn.xzkj.erp.order.repository.OrderListQueryRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderSkuSalesService {
    private final OrderListQueryRepository repository;
    private final Clock clock;

    public OrderSkuSalesService(
            OrderListQueryRepository repository,
            Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<SkuSalesSummaryView> listSummaries(
            UUID tenantId,
            List<UUID> skuIds) {
        if (tenantId == null
                || skuIds == null
                || skuIds.isEmpty()
                || skuIds.size() > 50
                || skuIds.stream().anyMatch(Objects::isNull)) {
            throw new IllegalArgumentException(
                    "Between 1 and 50 SKU identities are required");
        }
        Set<UUID> requiredSkuIds = Set.copyOf(skuIds);
        Instant now = clock.instant();
        return repository.listSkuSalesSummaries(
                tenantId,
                requiredSkuIds,
                now.minus(Duration.ofDays(7)),
                now.minus(Duration.ofDays(28)),
                now.minus(Duration.ofDays(42)));
    }
}
