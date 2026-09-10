package cn.xzkj.erp.iam.bootstrap;

import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

@Repository
public class InitialAdminBootstrapLock {

    private static final long LOCK_NAMESPACE = 0x49414D42L;

    private final EntityManager entityManager;

    public InitialAdminBootstrapLock(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    public void acquire(String tenantCode) {
        entityManager.createNativeQuery("""
                        SELECT pg_advisory_xact_lock(
                            hashtextextended(:lockKey, :namespace)
                        )
                        """)
                .setParameter("lockKey", "initial-admin:" + tenantCode)
                .setParameter("namespace", LOCK_NAMESPACE)
                .getSingleResult();
    }
}
