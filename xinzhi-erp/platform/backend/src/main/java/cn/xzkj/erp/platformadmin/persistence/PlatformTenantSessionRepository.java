package cn.xzkj.erp.platformadmin.persistence;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface PlatformTenantSessionRepository
        extends Repository<PlatformTenantSessionEntity, UUID> {

    PlatformTenantSessionEntity save(PlatformTenantSessionEntity session);

    @Query("""
            select tenantSession from PlatformTenantSessionEntity tenantSession
            join fetch tenantSession.systemAdmin admin
            join fetch tenantSession.tenant tenant
            join fetch tenantSession.platformSession platformSession
            where tenantSession.tokenHash = :tokenHash
              and tenantSession.revokedAt is null
              and tenantSession.expiresAt > :now
              and platformSession.revokedAt is null
              and platformSession.expiresAt > :now
              and tenantSession.systemAdmin.id = platformSession.systemAdmin.id
              and admin.status = cn.xzkj.erp.platformadmin.domain.SystemAdminStatus.ACTIVE
              and tenant.status = cn.xzkj.erp.iam.domain.TenantStatus.ACTIVE
            """)
    Optional<PlatformTenantSessionEntity> findActiveByTokenHash(
            @Param("tokenHash") String tokenHash,
            @Param("now") Instant now);

    @Query("""
            select tenantSession from PlatformTenantSessionEntity tenantSession
            join fetch tenantSession.systemAdmin admin
            join fetch tenantSession.tenant tenant
            join fetch tenantSession.platformSession platformSession
            where tenantSession.id = :sessionId
              and tenantSession.tenant.id = :tenantId
              and tenantSession.systemAdmin.id = :adminId
              and tenantSession.revokedAt is null
              and tenantSession.expiresAt > :now
              and platformSession.revokedAt is null
              and platformSession.expiresAt > :now
              and tenantSession.systemAdmin.id = platformSession.systemAdmin.id
              and admin.status = cn.xzkj.erp.platformadmin.domain.SystemAdminStatus.ACTIVE
              and tenant.status = cn.xzkj.erp.iam.domain.TenantStatus.ACTIVE
            """)
    Optional<PlatformTenantSessionEntity> findActiveByIdAndTenantIdAndSystemAdminId(
            @Param("sessionId") UUID sessionId,
            @Param("tenantId") UUID tenantId,
            @Param("adminId") UUID adminId,
            @Param("now") Instant now);

    @Modifying
    @Query("""
            update PlatformTenantSessionEntity session
            set session.revokedAt = :now
            where session.systemAdmin.id = :adminId
              and session.revokedAt is null
            """)
    int revokeAllForAdmin(
            @Param("adminId") UUID adminId,
            @Param("now") Instant now);

    @Modifying
    @Query("""
            update PlatformTenantSessionEntity session
            set session.revokedAt = :now
            where session.tenant.id = :tenantId
              and session.revokedAt is null
            """)
    int revokeAllForTenant(
            @Param("tenantId") UUID tenantId,
            @Param("now") Instant now);

    @Modifying
    @Query("""
            update PlatformTenantSessionEntity session
            set session.revokedAt = :now
            where session.platformSession.id = :platformSessionId
              and session.revokedAt is null
            """)
    int revokeAllForPlatformSession(
            @Param("platformSessionId") UUID platformSessionId,
            @Param("now") Instant now);

    @Modifying
    @Query("""
            update PlatformTenantSessionEntity session
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
