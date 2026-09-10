package cn.xzkj.erp.iam.entry;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface FirstPartyApplicationEntryGrantRepository
        extends Repository<FirstPartyApplicationEntryGrantEntity, UUID> {

    FirstPartyApplicationEntryGrantEntity save(FirstPartyApplicationEntryGrantEntity grant);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select grant from FirstPartyApplicationEntryGrantEntity grant
            left join fetch grant.authSession authSession
            left join fetch authSession.user user
            left join fetch user.tenant userTenant
            left join fetch grant.platformTenantSession platformTenantSession
            left join fetch platformTenantSession.systemAdmin systemAdmin
            left join fetch platformTenantSession.tenant platformTenant
            left join fetch platformTenantSession.platformSession platformSession
            where grant.tokenHash = :tokenHash
            """)
    Optional<FirstPartyApplicationEntryGrantEntity> findForConsumptionByTokenHash(
            @Param("tokenHash") String tokenHash);
}
