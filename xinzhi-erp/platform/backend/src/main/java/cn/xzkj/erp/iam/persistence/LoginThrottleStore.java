package cn.xzkj.erp.iam.persistence;

import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Repository;

@Repository
public class LoginThrottleStore {

    private final EntityManager entityManager;

    public LoginThrottleStore(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    public Instant databaseNow() {
        Object value = entityManager.createNativeQuery(
                        "SELECT clock_timestamp()")
                .getSingleResult();
        return toInstant(value);
    }

    public Optional<Instant> findActiveLock(UUID tenantId, UUID userId) {
        List<?> results = entityManager.createNativeQuery("""
                        SELECT locked_until
                        FROM iam_login_throttles
                        WHERE tenant_id = :tenantId
                          AND user_id = :userId
                          AND locked_until > clock_timestamp()
                        """)
                .setParameter("tenantId", tenantId)
                .setParameter("userId", userId)
                .getResultList();
        if (results.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(toInstant(results.getFirst()));
    }

    public void createEmptyIfMissing(
            UUID tenantId,
            UUID userId,
            Instant now) {
        entityManager.createNativeQuery("""
                        INSERT INTO iam_login_throttles (
                            tenant_id,
                            user_id,
                            failed_count,
                            window_started_at,
                            locked_until,
                            updated_at
                        ) VALUES (
                            :tenantId,
                            :userId,
                            0,
                            :now,
                            NULL,
                            :now
                        )
                        ON CONFLICT (tenant_id, user_id) DO NOTHING
                        """)
                .setParameter("tenantId", tenantId)
                .setParameter("userId", userId)
                .setParameter("now", now)
                .executeUpdate();
    }

    public Optional<LockedState> lockState(UUID tenantId, UUID userId) {
        List<?> rows = entityManager.createNativeQuery("""
                        SELECT failed_count, window_started_at, locked_until
                        FROM iam_login_throttles
                        WHERE tenant_id = :tenantId
                          AND user_id = :userId
                        FOR UPDATE
                        """)
                .setParameter("tenantId", tenantId)
                .setParameter("userId", userId)
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
            UUID tenantId,
            UUID userId,
            int failedCount,
            Instant windowStartedAt,
            Instant lockedUntil,
            Instant updatedAt) {
        entityManager.createNativeQuery("""
                        UPDATE iam_login_throttles
                        SET failed_count = :failedCount,
                            window_started_at = :windowStartedAt,
                            locked_until = :lockedUntil,
                            updated_at = :updatedAt
                        WHERE tenant_id = :tenantId
                          AND user_id = :userId
                        """)
                .setParameter("failedCount", failedCount)
                .setParameter("windowStartedAt", windowStartedAt)
                .setParameter("lockedUntil", lockedUntil)
                .setParameter("updatedAt", updatedAt)
                .setParameter("tenantId", tenantId)
                .setParameter("userId", userId)
                .executeUpdate();
    }

    public void delete(UUID tenantId, UUID userId) {
        entityManager.createNativeQuery("""
                        DELETE FROM iam_login_throttles
                        WHERE tenant_id = :tenantId
                          AND user_id = :userId
                        """)
                .setParameter("tenantId", tenantId)
                .setParameter("userId", userId)
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
