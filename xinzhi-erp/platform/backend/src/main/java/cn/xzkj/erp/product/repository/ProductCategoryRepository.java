package cn.xzkj.erp.product.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import cn.xzkj.erp.product.domain.ProductCategory;
import cn.xzkj.erp.product.domain.ProductMasterDataStatus;
import jakarta.persistence.LockModeType;

public interface ProductCategoryRepository
        extends Repository<ProductCategory, UUID> {

    <S extends ProductCategory> S save(S entity);

    void delete(ProductCategory entity);

    Optional<ProductCategory> findByIdAndTenantId(UUID id, UUID tenantId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select category from ProductCategory category
            where category.id = :id and category.tenantId = :tenantId
            """)
    Optional<ProductCategory> findForUpdateByIdAndTenantId(
            @Param("id") UUID id,
            @Param("tenantId") UUID tenantId);

    @Query("""
            select category from ProductCategory category
            where category.tenantId = :tenantId
              and (:status is null or category.status = :status)
              and (:queryPresent = false
                   or locate(:query, lower(category.name)) > 0)
            order by category.sortOrder asc,
                     lower(category.name) asc,
                     category.id asc
            """)
    Page<ProductCategory> search(
            @Param("tenantId") UUID tenantId,
            @Param("status") ProductMasterDataStatus status,
            @Param("queryPresent") boolean queryPresent,
            @Param("query") String query,
            Pageable pageable);

    @Query("""
            select count(category) > 0 from ProductCategory category
            where category.tenantId = :tenantId
              and lower(category.name) = :normalizedName
              and (:excludedId is null or category.id <> :excludedId)
            """)
    boolean existsNormalizedName(
            @Param("tenantId") UUID tenantId,
            @Param("normalizedName") String normalizedName,
            @Param("excludedId") UUID excludedId);
}
