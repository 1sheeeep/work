package cn.xzkj.erp.iam.persistence;

import cn.xzkj.erp.iam.domain.PasswordCredentialPurpose;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface PasswordCredentialRepository
        extends Repository<PasswordCredentialEntity, UUID> {

    PasswordCredentialEntity saveAndFlush(PasswordCredentialEntity credential);

    Optional<PasswordCredentialEntity> findByIdAndTenantIdAndUser_Id(
            UUID id,
            UUID tenantId,
            UUID userId);

    Page<PasswordCredentialEntity> findAllByTenantIdAndUser_Id(
            UUID tenantId,
            UUID userId,
            Pageable pageable);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select credential from PasswordCredentialEntity credential
            join fetch credential.user user
            join fetch user.tenant
            where credential.tokenHash = :tokenHash
            """)
    Optional<PasswordCredentialEntity> findByTokenHashForUpdate(
            @Param("tokenHash") String tokenHash);

    @Modifying
    @Query("""
            update PasswordCredentialEntity credential
            set credential.revokedAt = :now
            where credential.tenantId = :tenantId
              and credential.user.id = :userId
              and credential.purpose = :purpose
              and credential.consumedAt is null
              and credential.revokedAt is null
            """)
    int revokeOpenForPurpose(
            @Param("tenantId") UUID tenantId,
            @Param("userId") UUID userId,
            @Param("purpose") PasswordCredentialPurpose purpose,
            @Param("now") Instant now);

    @Modifying
    @Query("""
            update PasswordCredentialEntity credential
            set credential.revokedAt = :now
            where credential.tenantId = :tenantId
              and credential.user.id = :userId
              and credential.id <> :exceptId
              and credential.consumedAt is null
              and credential.revokedAt is null
            """)
    int revokeOtherOpenForUser(
            @Param("tenantId") UUID tenantId,
            @Param("userId") UUID userId,
            @Param("exceptId") UUID exceptId,
            @Param("now") Instant now);

    @Modifying
    @Query("""
            update PasswordCredentialEntity credential
            set credential.revokedAt = :now
            where credential.tenantId = :tenantId
              and credential.user.id = :userId
              and credential.consumedAt is null
              and credential.revokedAt is null
            """)
    int revokeAllOpenForUser(
            @Param("tenantId") UUID tenantId,
            @Param("userId") UUID userId,
            @Param("now") Instant now);
}
