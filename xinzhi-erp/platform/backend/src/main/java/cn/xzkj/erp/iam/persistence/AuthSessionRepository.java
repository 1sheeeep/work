package cn.xzkj.erp.iam.persistence;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface AuthSessionRepository extends Repository<AuthSessionEntity, UUID> {

    Optional<AuthSessionEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    Optional<AuthSessionEntity> findByIdAndTenantIdAndUser_Id(
            UUID id,
            UUID tenantId,
            UUID userId);

    boolean existsByIdAndTenantIdAndUser_Id(
            UUID id,
            UUID tenantId,
            UUID userId);

    Page<AuthSessionEntity> findAllByTenantIdAndUser_Id(
            UUID tenantId,
            UUID userId,
            Pageable pageable);

    AuthSessionEntity save(AuthSessionEntity session);
    void flush();

    @Query("""
            select session from AuthSessionEntity session
            join fetch session.user user
            join fetch user.tenant tenant
            where session.tokenHash = :tokenHash
              and session.revokedAt is null
              and session.expiresAt > :now
              and user.status = cn.xzkj.erp.iam.domain.AccountStatus.ACTIVE
              and tenant.status = cn.xzkj.erp.iam.domain.TenantStatus.ACTIVE
            """)
    Optional<AuthSessionEntity> findActiveByTokenHash(
            @Param("tokenHash") String tokenHash,
            @Param("now") Instant now);

    @Modifying
    @Query("""
            update AuthSessionEntity session
            set session.revokedAt = :now
            where session.tenantId = :tenantId
              and session.user.id = :userId
              and session.revokedAt is null
            """)
    int revokeActiveForUser(
            @Param("tenantId") UUID tenantId,
            @Param("userId") UUID userId,
            @Param("now") Instant now);

    @Modifying
    @Query("""
            update AuthSessionEntity session
            set session.revokedAt = :now
            where session.tenantId = :tenantId
              and session.revokedAt is null
            """)
    int revokeActiveForTenant(
            @Param("tenantId") UUID tenantId,
            @Param("now") Instant now);

    @Modifying
    @Query("""
            update AuthSessionEntity session
            set session.revokedAt = :now
            where session.id = :sessionId
              and session.tenantId = :tenantId
              and session.user.id = :userId
              and session.revokedAt is null
            """)
    int revokeScopedSessionIfOpen(
            @Param("sessionId") UUID sessionId,
            @Param("tenantId") UUID tenantId,
            @Param("userId") UUID userId,
            @Param("now") Instant now);
}
