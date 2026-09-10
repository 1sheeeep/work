package cn.xzkj.erp.iam.persistence;

import java.util.Optional;
import java.util.UUID;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

public interface TenantRepository extends Repository<TenantEntity, UUID> {

    @Query("select tenant from TenantEntity tenant where tenant.code = :code and tenant.deletedAt is null")
    Optional<TenantEntity> findByCode(@Param("code") String code);

    Optional<TenantEntity> findById(UUID id);

    Optional<TenantEntity> findByOneTenantId(UUID oneTenantId);

    boolean existsByCode(String code);

    Page<TenantEntity> findAllByDeletedAtIsNull(Pageable pageable);

    TenantEntity saveAndFlush(TenantEntity tenant);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select tenant from TenantEntity tenant where tenant.id = :id")
    Optional<TenantEntity> findByIdForUpdate(@Param("id") UUID id);
}
