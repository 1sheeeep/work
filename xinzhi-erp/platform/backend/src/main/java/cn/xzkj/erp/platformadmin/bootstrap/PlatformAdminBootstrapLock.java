package cn.xzkj.erp.platformadmin.bootstrap;

import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

@Repository
public class PlatformAdminBootstrapLock {

    private static final long LOCK_KEY = 0x5041444DL;

    private final EntityManager entityManager;

    public PlatformAdminBootstrapLock(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    public void acquire() {
        entityManager.createNativeQuery(
                        "SELECT pg_advisory_xact_lock(:lockKey)")
                .setParameter("lockKey", LOCK_KEY)
                .getSingleResult();
    }
}
