package cn.xzkj.erp.platformadmin.persistence;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface PlatformAdminSessionRepository
        extends Repository<PlatformAdminSessionEntity, UUID> {

    PlatformAdminSessionEntity save(PlatformAdminSessionEntity session);

    @Query("""
            select session from PlatformAdminSessionEntity session
            join fetch session.systemAdmin admin
            where session.tokenHash = :tokenHash
              and session.revokedAt is null
              and session.expiresAt > :now
              and admin.status = cn.xzkj.erp.platformadmin.domain.SystemAdminStatus.ACTIVE
            """)
    Optional<PlatformAdminSessionEntity> findActiveByTokenHash(
            @Param("tokenHash") String tokenHash,
            @Param("now") Instant now);

    @Query("""
            select session from PlatformAdminSessionEntity session
            join fetch session.systemAdmin admin
            where session.id = :sessionId
              and session.systemAdmin.id = :adminId
              and session.revokedAt is null
              and session.expiresAt > :now
              and admin.status = cn.xzkj.erp.platformadmin.domain.SystemAdminStatus.ACTIVE
            """)
    Optional<PlatformAdminSessionEntity> findActiveById(
            @Param("sessionId") UUID sessionId,
            @Param("adminId") UUID adminId,
            @Param("now") Instant now);

    @Modifying
    @Query("""
            update PlatformAdminSessionEntity session
            set session.revokedAt = :now
            where session.systemAdmin.id = :adminId
              and session.revokedAt is null
            """)
    int revokeAllForAdmin(
            @Param("adminId") UUID adminId,
            @Param("now") Instant now);

    @Modifying
    @Query("""
            update PlatformAdminSessionEntity session
            set session.revokedAt = :now
            where session.id = :sessionId
              and session.systemAdmin.id = :adminId
              and session.revokedAt is null
            """)
    int revokeOne(
            @Param("sessionId") UUID sessionId,
            @Param("adminId") UUID adminId,
            @Param("now") Instant now);
}
