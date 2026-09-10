package cn.xzkj.erp.order.repository;

import java.util.UUID;

import org.springframework.stereotype.Repository;

import jakarta.persistence.EntityManager;

@Repository
public class OrderIdempotencyLock {
    private final EntityManager entityManager;

    public OrderIdempotencyLock(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    public void acquire(UUID tenantId, String idempotencyKey) {
        entityManager.createNativeQuery("""
                        SELECT pg_advisory_xact_lock(
                            hashtextextended(CAST(:tenantId AS text) || ':' || :idempotencyKey, 0)
                        )
                        """)
                .setParameter("tenantId", tenantId)
                .setParameter("idempotencyKey", idempotencyKey)
                .getSingleResult();
    }
}
