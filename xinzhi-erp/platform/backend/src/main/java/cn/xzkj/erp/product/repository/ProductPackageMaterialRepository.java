package cn.xzkj.erp.product.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import cn.xzkj.erp.product.domain.ProductMasterDataStatus;
import cn.xzkj.erp.product.domain.ProductPackageMaterial;
import jakarta.persistence.LockModeType;

public interface ProductPackageMaterialRepository
        extends Repository<ProductPackageMaterial, UUID> {

    <S extends ProductPackageMaterial> S save(S entity);

    void delete(ProductPackageMaterial entity);

    Optional<ProductPackageMaterial> findByIdAndTenantId(
            UUID id,
            UUID tenantId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select material from ProductPackageMaterial material
            where material.id = :id and material.tenantId = :tenantId
            """)
    Optional<ProductPackageMaterial> findForUpdateByIdAndTenantId(
            @Param("id") UUID id,
            @Param("tenantId") UUID tenantId);

    @Query("""
            select material from ProductPackageMaterial material
            where material.tenantId = :tenantId
              and (:status is null or material.status = :status)
              and (:queryPresent = false
                   or locate(:query, lower(material.name)) > 0
                   or locate(:query, lower(coalesce(
                       material.currencyCode, ''))) > 0)
            order by lower(material.name) asc, material.id asc
            """)
    Page<ProductPackageMaterial> search(
            @Param("tenantId") UUID tenantId,
            @Param("status") ProductMasterDataStatus status,
            @Param("queryPresent") boolean queryPresent,
            @Param("query") String query,
            Pageable pageable);

    @Query("""
            select count(material) > 0
            from ProductPackageMaterial material
            where material.tenantId = :tenantId
              and lower(material.name) = :normalizedName
              and (:excludedId is null or material.id <> :excludedId)
            """)
    boolean existsNormalizedName(
            @Param("tenantId") UUID tenantId,
            @Param("normalizedName") String normalizedName,
            @Param("excludedId") UUID excludedId);
}
