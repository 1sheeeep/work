package cn.xzkj.erp.analytics.productboard;

import cn.xzkj.erp.iam.warehousescope.WarehouseScopeAccess;
import cn.xzkj.erp.iam.warehousescope.WarehouseScopeEvaluator;
import java.time.Duration;
import java.time.Instant;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProductSalesBoardService {
    private static final Duration WINDOW = Duration.ofDays(7);
    private final ProductSalesBoardRepository repository;
    private final WarehouseScopeEvaluator scopeEvaluator;

    public ProductSalesBoardService(
            ProductSalesBoardRepository repository,
            WarehouseScopeEvaluator scopeEvaluator) {
        this.repository = repository;
        this.scopeEvaluator = scopeEvaluator;
    }

    @Transactional(readOnly = true)
    public ProductSalesBoardResult summarize(
            ProductSalesBoardActor actor, Instant observedAt, int limit) {
        requireActor(actor);
        if (observedAt == null || limit < 1 || limit > 10) {
            throw new IllegalArgumentException("Invalid product sales board request");
        }
        WarehouseScopeAccess scope = scopeEvaluator.evaluate(
                actor.tenantId(), actor.userId(), actor.systemAdminId());
        if (!scope.allowsAll() && scope.warehouseIds().isEmpty()) {
            return ProductSalesBoardResult.empty();
        }
        return repository.summarize(
                actor.tenantId(), scope.warehouseIds(), scope.allowsAll(),
                observedAt.minus(WINDOW), observedAt, limit);
    }

    private static void requireActor(ProductSalesBoardActor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null) == (actor.systemAdminId() == null)) {
            throw new AccessDeniedException("A tenant actor is required");
        }
    }
}
