package cn.xzkj.erp.order.repository;

import org.springframework.stereotype.Repository;

import cn.xzkj.erp.order.domain.TenantOrder;
import jakarta.persistence.EntityManager;
import jakarta.persistence.OptimisticLockException;

@Repository
public class OrderAggregateVersionLock {
    private final EntityManager entityManager;

    public OrderAggregateVersionLock(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    public void forceIncrement(TenantOrder order) {
        int updated = entityManager.createNativeQuery("""
                UPDATE tenant_orders
                SET version = version + 1,
                    updated_at = now()
                WHERE tenant_id = :tenantId
                  AND id = :orderId
                  AND version = :version
                """)
                .setParameter("tenantId", order.getTenantId())
                .setParameter("orderId", order.getId())
                .setParameter("version", order.getVersion())
                .executeUpdate();
        if (updated != 1) {
            throw new OptimisticLockException("Order version changed concurrently");
        }
        entityManager.refresh(order);
    }
}
