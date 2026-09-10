package cn.xzkj.erp.supplier.repository;

import java.util.Optional;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import cn.xzkj.erp.supplier.domain.Supplier;
import cn.xzkj.erp.supplier.domain.SupplierStatus;
import jakarta.persistence.LockModeType;

public interface SupplierRepository extends Repository<Supplier, UUID> {
    <S extends Supplier> S save(S entity);

    Optional<Supplier> findByIdAndTenantId(UUID id, UUID tenantId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select supplier from Supplier supplier
            where supplier.id = :id and supplier.tenantId = :tenantId
            """)
    Optional<Supplier> findForUpdateByIdAndTenantId(
            @Param("id") UUID id,
            @Param("tenantId") UUID tenantId);

    boolean existsByTenantIdAndBusinessCode(UUID tenantId, String businessCode);

    boolean existsByTenantIdAndBusinessCodeAndIdNot(
            UUID tenantId,
            String businessCode,
            UUID id);

    @Query("""
            select supplier.businessCode from Supplier supplier
            where supplier.tenantId = :tenantId
              and supplier.businessCode in :businessCodes
            """)
    List<String> findExistingBusinessCodes(
            @Param("tenantId") UUID tenantId,
            @Param("businessCodes") Collection<String> businessCodes);

    @Query("""
            select supplier from Supplier supplier
            where supplier.tenantId = :tenantId
            and (:status is null or supplier.status = :status)
            and (:queryPresent = false
                 or locate(:query, lower(supplier.businessCode)) > 0
                 or locate(:query, lower(supplier.name)) > 0)
            order by supplier.businessCode asc, supplier.id asc
            """)
    Page<Supplier> searchByTenantId(
            @Param("tenantId") UUID tenantId,
            @Param("status") SupplierStatus status,
            @Param("queryPresent") boolean queryPresent,
            @Param("query") String query,
            Pageable pageable);
}
