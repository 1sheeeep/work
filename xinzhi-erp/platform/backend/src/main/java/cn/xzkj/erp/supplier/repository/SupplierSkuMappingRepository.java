package cn.xzkj.erp.supplier.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import cn.xzkj.erp.supplier.domain.SupplierSkuMapping;
import cn.xzkj.erp.supplier.domain.SupplierSkuMappingStatus;
import cn.xzkj.erp.supplier.service.PreferredSupplierSkuSummary;
import cn.xzkj.erp.supplier.service.SupplierSkuMappingSummary;
import jakarta.persistence.LockModeType;

public interface SupplierSkuMappingRepository
        extends Repository<SupplierSkuMapping, UUID> {

    <S extends SupplierSkuMapping> S save(S entity);

    boolean existsByTenantIdAndSupplierIdAndSkuId(
            UUID tenantId, UUID supplierId, UUID skuId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select mapping from SupplierSkuMapping mapping
            where mapping.id = :mappingId
              and mapping.tenantId = :tenantId
              and mapping.supplierId = :supplierId
            """)
    Optional<SupplierSkuMapping> findForUpdate(
            @Param("tenantId") UUID tenantId,
            @Param("supplierId") UUID supplierId,
            @Param("mappingId") UUID mappingId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select mapping from SupplierSkuMapping mapping
            where mapping.tenantId = :tenantId
              and mapping.skuId = :skuId
              and mapping.status = cn.xzkj.erp.supplier.domain.SupplierSkuMappingStatus.ACTIVE
              and mapping.preferred = true
            """)
    Optional<SupplierSkuMapping> findPreferredForUpdate(
            @Param("tenantId") UUID tenantId,
            @Param("skuId") UUID skuId);

    @Query(
            value = """
                    select new cn.xzkj.erp.supplier.service.SupplierSkuMappingSummary(
                        mapping, sku.businessCode, sku.name
                    )
                    from SupplierSkuMapping mapping
                    join ProductSku sku
                      on sku.tenantId = mapping.tenantId
                     and sku.id = mapping.skuId
                    where mapping.tenantId = :tenantId
                      and mapping.supplierId = :supplierId
                      and (:status is null or mapping.status = :status)
                      and (
                        :queryPresent = false
                        or locate(:query, lower(coalesce(mapping.supplierSkuCode, ''))) > 0
                        or locate(:query, lower(sku.businessCode)) > 0
                        or locate(:query, lower(sku.name)) > 0
                      )
                    order by mapping.preferred desc,
                             sku.businessCode asc,
                             mapping.id asc
                    """,
            countQuery = """
                    select count(mapping)
                    from SupplierSkuMapping mapping
                    join ProductSku sku
                      on sku.tenantId = mapping.tenantId
                     and sku.id = mapping.skuId
                    where mapping.tenantId = :tenantId
                      and mapping.supplierId = :supplierId
                      and (:status is null or mapping.status = :status)
                      and (
                        :queryPresent = false
                        or locate(:query, lower(coalesce(mapping.supplierSkuCode, ''))) > 0
                        or locate(:query, lower(sku.businessCode)) > 0
                        or locate(:query, lower(sku.name)) > 0
                      )
                    """)
    Page<SupplierSkuMappingSummary> search(
            @Param("tenantId") UUID tenantId,
            @Param("supplierId") UUID supplierId,
            @Param("status") SupplierSkuMappingStatus status,
            @Param("queryPresent") boolean queryPresent,
            @Param("query") String query,
            Pageable pageable);

    @Query("""
            select new cn.xzkj.erp.supplier.service.PreferredSupplierSkuSummary(
                mapping.skuId,
                mapping.supplierSkuCode,
                supplier.id,
                supplier.businessCode,
                supplier.name
            )
            from SupplierSkuMapping mapping
            join Supplier supplier
              on supplier.tenantId = mapping.tenantId
             and supplier.id = mapping.supplierId
            where mapping.tenantId = :tenantId
              and mapping.skuId in :skuIds
              and mapping.status = cn.xzkj.erp.supplier.domain.SupplierSkuMappingStatus.ACTIVE
              and mapping.preferred = true
              and supplier.status = cn.xzkj.erp.supplier.domain.SupplierStatus.ACTIVE
            order by mapping.skuId
            """)
    List<PreferredSupplierSkuSummary> findPreferredByTenantIdAndSkuIdIn(
            @Param("tenantId") UUID tenantId,
            @Param("skuIds") Collection<UUID> skuIds);
}
