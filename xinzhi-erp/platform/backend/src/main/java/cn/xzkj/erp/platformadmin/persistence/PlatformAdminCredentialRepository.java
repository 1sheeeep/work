package cn.xzkj.erp.platformadmin.persistence;

import cn.xzkj.erp.platformadmin.domain.PlatformAdminCredentialPurpose;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface PlatformAdminCredentialRepository
        extends Repository<PlatformAdminCredentialEntity, UUID> {

    PlatformAdminCredentialEntity saveAndFlush(
            PlatformAdminCredentialEntity credential);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select credential from PlatformAdminCredentialEntity credential
            join fetch credential.systemAdmin
            where credential.tokenHash = :tokenHash
            """)
    Optional<PlatformAdminCredentialEntity> findByTokenHashForUpdate(
            @Param("tokenHash") String tokenHash);

    @Modifying
    @Query("""
            update PlatformAdminCredentialEntity credential
            set credential.revokedAt = :now
            where credential.systemAdmin.id = :adminId
              and credential.purpose = :purpose
              and credential.consumedAt is null
              and credential.revokedAt is null
            """)
    int revokeOpenForPurpose(
            @Param("adminId") UUID adminId,
            @Param("purpose") PlatformAdminCredentialPurpose purpose,
            @Param("now") Instant now);

    @Modifying
    @Query("""
            update PlatformAdminCredentialEntity credential
            set credential.revokedAt = :now
            where credential.systemAdmin.id = :adminId
              and credential.id <> :exceptId
              and credential.consumedAt is null
              and credential.revokedAt is null
            """)
    int revokeOtherOpen(
            @Param("adminId") UUID adminId,
            @Param("exceptId") UUID exceptId,
            @Param("now") Instant now);

    @Modifying
    @Query("""
            update PlatformAdminCredentialEntity credential
            set credential.revokedAt = :now
            where credential.systemAdmin.id = :adminId
              and credential.consumedAt is null
              and credential.revokedAt is null
            """)
    int revokeAllOpen(
            @Param("adminId") UUID adminId,
            @Param("now") Instant now);
}
