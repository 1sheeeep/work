package cn.xzkj.erp.platformadmin.persistence;

import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Repository;

@Repository
public class PlatformAdminLoginThrottleStore {

    private final EntityManager entityManager;

    public PlatformAdminLoginThrottleStore(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    public Instant databaseNow() {
        return toInstant(entityManager
                .createNativeQuery("SELECT clock_timestamp()")
                .getSingleResult());
    }

    public Optional<Instant> findActiveLock(UUID adminId) {
        List<?> results = entityManager.createNativeQuery("""
                        SELECT locked_until
                        FROM platform_admin_login_throttles
                        WHERE system_admin_id = :adminId
                          AND locked_until > clock_timestamp()
                        """)
                .setParameter("adminId", adminId)
                .getResultList();
        return results.isEmpty()
                ? Optional.empty()
                : Optional.of(toInstant(results.getFirst()));
    }

    public void createEmptyIfMissing(UUID adminId, Instant now) {
        entityManager.createNativeQuery("""
                        INSERT INTO platform_admin_login_throttles (
                            system_admin_id, failed_count, window_started_at,
                            locked_until, updated_at
                        ) VALUES (:adminId, 0, :now, NULL, :now)
                        ON CONFLICT (system_admin_id) DO NOTHING
                        """)
                .setParameter("adminId", adminId)
                .setParameter("now", now)
                .executeUpdate();
    }

    public Optional<LockedState> lockState(UUID adminId) {
        List<?> rows = entityManager.createNativeQuery("""
                        SELECT failed_count, window_started_at, locked_until
                        FROM platform_admin_login_throttles
                        WHERE system_admin_id = :adminId
                        FOR UPDATE
                        """)
                .setParameter("adminId", adminId)
                .getResultList();
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        Object[] row = (Object[]) rows.getFirst();
        return Optional.of(new LockedState(
                ((Number) row[0]).intValue(),
                toInstant(row[1]),
                row[2] == null ? null : toInstant(row[2])));
    }

    public void update(
            UUID adminId,
            int failedCount,
            Instant windowStartedAt,
            Instant lockedUntil,
            Instant updatedAt) {
        entityManager.createNativeQuery("""
                        UPDATE platform_admin_login_throttles
                        SET failed_count = :failedCount,
                            window_started_at = :windowStartedAt,
                            locked_until = :lockedUntil,
                            updated_at = :updatedAt
                        WHERE system_admin_id = :adminId
                        """)
                .setParameter("failedCount", failedCount)
                .setParameter("windowStartedAt", windowStartedAt)
                .setParameter("lockedUntil", lockedUntil)
                .setParameter("updatedAt", updatedAt)
                .setParameter("adminId", adminId)
                .executeUpdate();
    }

    public void delete(UUID adminId) {
        entityManager.createNativeQuery("""
                        DELETE FROM platform_admin_login_throttles
                        WHERE system_admin_id = :adminId
                        """)
                .setParameter("adminId", adminId)
                .executeUpdate();
    }

    private static Instant toInstant(Object value) {
        if (value instanceof Instant instant) {
            return instant;
        }
        if (value instanceof OffsetDateTime offsetDateTime) {
            return offsetDateTime.toInstant();
        }
        throw new IllegalStateException("Unsupported database timestamp type");
    }

    public record LockedState(
            int failedCount,
            Instant windowStartedAt,
            Instant lockedUntil) {
    }
}
