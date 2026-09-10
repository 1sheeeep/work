package cn.xzkj.erp.customer.service;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface CustomerServiceEntryGrantRepository
        extends Repository<CustomerServiceEntryGrantEntity, UUID> {

    CustomerServiceEntryGrantEntity save(CustomerServiceEntryGrantEntity grant);

    Optional<CustomerServiceEntryGrantEntity> findByTokenHash(String tokenHash);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select grant from CustomerServiceEntryGrantEntity grant
            left join fetch grant.authSession session
            left join fetch session.user user
            left join fetch user.tenant tenant
            left join fetch grant.platformTenantSession platformTenantSession
            left join fetch platformTenantSession.systemAdmin systemAdmin
            left join fetch platformTenantSession.tenant platformTenant
            left join fetch platformTenantSession.platformSession platformSession
            where grant.tokenHash = :tokenHash
            """)
    Optional<CustomerServiceEntryGrantEntity> findForConsumptionByTokenHash(
            @Param("tokenHash") String tokenHash);
}
