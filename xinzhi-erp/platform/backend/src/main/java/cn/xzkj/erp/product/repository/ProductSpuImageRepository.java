package cn.xzkj.erp.product.repository;

import java.util.List;
import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import cn.xzkj.erp.product.domain.ProductSpuImage;
import jakarta.persistence.LockModeType;

public interface ProductSpuImageRepository
        extends Repository<ProductSpuImage, UUID> {

    <S extends ProductSpuImage> S save(S entity);

    void delete(ProductSpuImage entity);

    void flush();

    long countByTenantIdAndSpuId(UUID tenantId, UUID spuId);

    @Query("""
            select image from ProductSpuImage image
            where image.tenantId = :tenantId and image.spuId = :spuId
            order by image.primaryImage desc,
                     image.sortOrder asc,
                     image.id asc
            """)
    List<ProductSpuImage> findAllByTenantIdAndSpuId(
            @Param("tenantId") UUID tenantId,
            @Param("spuId") UUID spuId);

    @Query("""
            select image from ProductSpuImage image
            where image.tenantId = :tenantId
              and image.spuId in :spuIds
            order by image.spuId asc,
                     image.primaryImage desc,
                     image.sortOrder asc,
                     image.id asc
            """)
    List<ProductSpuImage> findAllByTenantIdAndSpuIdIn(
            @Param("tenantId") UUID tenantId,
            @Param("spuIds") Collection<UUID> spuIds);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select image from ProductSpuImage image
            where image.tenantId = :tenantId and image.spuId = :spuId
            order by image.id asc
            """)
    List<ProductSpuImage> findAllForUpdateByTenantIdAndSpuId(
            @Param("tenantId") UUID tenantId,
            @Param("spuId") UUID spuId);

    Optional<ProductSpuImage> findByIdAndTenantIdAndSpuId(
            UUID id,
            UUID tenantId,
            UUID spuId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select image from ProductSpuImage image
            where image.id = :id
              and image.tenantId = :tenantId
              and image.spuId = :spuId
            """)
    Optional<ProductSpuImage> findForUpdate(
            @Param("id") UUID id,
            @Param("tenantId") UUID tenantId,
            @Param("spuId") UUID spuId);

    boolean existsByObjectKey(String objectKey);

    @Query("select image.objectKey from ProductSpuImage image")
    List<String> findAllObjectKeys();
}
