package cn.xzkj.erp.product.repository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import cn.xzkj.erp.product.domain.ProductSku;
import cn.xzkj.erp.product.domain.ProductStatus;
import jakarta.persistence.LockModeType;

public interface ProductSkuRepository extends Repository<ProductSku, UUID> {
    <S extends ProductSku> S save(S entity);
    Optional<ProductSku> findByIdAndTenantId(UUID id, UUID tenantId);
    List<ProductSku> findByTenantIdAndIdIn(
            UUID tenantId,
            Collection<UUID> ids);
    List<ProductSku> findByTenantIdAndBusinessCodeInAndStatusNot(
            UUID tenantId,
            Collection<String> businessCodes,
            ProductStatus excludedStatus);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select sku from ProductSku sku
            where sku.id = :id and sku.tenantId = :tenantId
            """)
    Optional<ProductSku> findForUpdateByIdAndTenantId(
            @Param("id") UUID id,
            @Param("tenantId") UUID tenantId);
    boolean existsByTenantIdAndBusinessCode(UUID tenantId, String businessCode);
    boolean existsByTenantIdAndSpuIdAndStatusNot(UUID tenantId, UUID spuId, ProductStatus excludedStatus);

    @Query("""
            select s from ProductSku s where s.tenantId = :tenantId
            and (:spuId is null or s.spuId = :spuId)
            and ((:categoryId is null
                  and :developerMemberId is null
                  and :developerAssistantMemberId is null
                  and :salesMemberId is null
                  and :artMemberId is null)
                 or exists (
                    select 1 from ProductSpu p
                    where p.tenantId = s.tenantId
                      and p.id = s.spuId
                      and (:categoryId is null or p.categoryId = :categoryId)
                      and (:developerMemberId is null
                           or p.developerMemberId = :developerMemberId)
                      and (:developerAssistantMemberId is null
                           or p.developerAssistantMemberId =
                              :developerAssistantMemberId)
                      and (:salesMemberId is null
                           or p.salesMemberId = :salesMemberId)
                      and (:artMemberId is null
                           or p.artMemberId = :artMemberId)
                 ))
            and (:creatorId is null or exists (
                select 1 from ProductSkuCreationAudit audit
                where audit.tenantId = s.tenantId
                  and audit.resourceType = 'product_sku'
                  and audit.resourceId = cast(s.id as string)
                  and audit.action = 'product_sku.created'
                  and audit.actorUserId = :creatorId
            ))
            and ((:status is not null and s.status = :status)
                 or (:status is null and s.status <> :archivedStatus))
            and (:hasCreatedFrom = false or s.createdAt >= :createdFrom)
            and (:hasCreatedTo = false or s.createdAt < :createdTo)
            and (:filterPresent = false
                 or (:searchField = 'ALL'
                    and :matchMode = 'CONTAINS' and (
                    locate(:keyword, lower(s.businessCode)) > 0
                    or locate(:keyword, lower(s.name)) > 0
                    or locate(:keyword, lower(coalesce(s.nameEn, ''))) > 0
                    or locate(:keyword, lower(coalesce(s.variantSummary, ''))) > 0
                    or exists (
                        select 1 from ProductSpu p
                        where p.tenantId = s.tenantId
                          and p.id = s.spuId
                          and locate(:keyword, lower(p.businessCode)) > 0
                    )))
                 or (:searchField in ('INVENTORY_SKU', 'NAME_ZH', 'NAME_EN')
                    and (
                      (:matchMode = 'STARTS_WITH'
                        and locate(:keyword, case
                          when :searchField = 'INVENTORY_SKU' then lower(s.businessCode)
                          when :searchField = 'NAME_ZH' then lower(s.name)
                          else lower(coalesce(s.nameEn, ''))
                        end) = 1)
                      or (:matchMode = 'EQUALS'
                        and case
                          when :searchField = 'INVENTORY_SKU' then lower(s.businessCode)
                          when :searchField = 'NAME_ZH' then lower(s.name)
                          else lower(coalesce(s.nameEn, ''))
                        end = :keyword)
                      or (:matchMode = 'CONTAINS'
                        and locate(:keyword, case
                          when :searchField = 'INVENTORY_SKU' then lower(s.businessCode)
                          when :searchField = 'NAME_ZH' then lower(s.name)
                          else lower(coalesce(s.nameEn, ''))
                        end) > 0)
                      or (:matchMode = 'ENDS_WITH'
                        and locate(:keyword, case
                          when :searchField = 'INVENTORY_SKU' then lower(s.businessCode)
                          when :searchField = 'NAME_ZH' then lower(s.name)
                          else lower(coalesce(s.nameEn, ''))
                        end) > 0
                        and locate(:keyword, case
                          when :searchField = 'INVENTORY_SKU' then lower(s.businessCode)
                          when :searchField = 'NAME_ZH' then lower(s.name)
                          else lower(coalesce(s.nameEn, ''))
                        end) = length(case
                          when :searchField = 'INVENTORY_SKU' then s.businessCode
                          when :searchField = 'NAME_ZH' then s.name
                          else coalesce(s.nameEn, '')
                        end) - length(:keyword) + 1)
                      or (:matchMode = 'EMPTY'
                        and length(trim(case
                          when :searchField = 'INVENTORY_SKU' then s.businessCode
                          when :searchField = 'NAME_ZH' then s.name
                          else coalesce(s.nameEn, '')
                        end)) = 0)
                      or (:matchMode = 'NOT_EMPTY'
                        and length(trim(case
                          when :searchField = 'INVENTORY_SKU' then s.businessCode
                          when :searchField = 'NAME_ZH' then s.name
                          else coalesce(s.nameEn, '')
                        end)) > 0)
                    ))
                 or (:searchField = 'ORIGINAL_SKU' and (
                      (:matchMode = 'EMPTY' and not exists (
                        select 1 from SupplierSkuMapping mapping
                        where mapping.tenantId = s.tenantId
                          and mapping.skuId = s.id
                          and mapping.status =
                            cn.xzkj.erp.supplier.domain.SupplierSkuMappingStatus.ACTIVE
                          and mapping.preferred = true
                          and length(trim(coalesce(
                            mapping.supplierSkuCode, ''))) > 0
                      ))
                      or (:matchMode = 'NOT_EMPTY' and exists (
                        select 1 from SupplierSkuMapping mapping
                        where mapping.tenantId = s.tenantId
                          and mapping.skuId = s.id
                          and mapping.status =
                            cn.xzkj.erp.supplier.domain.SupplierSkuMappingStatus.ACTIVE
                          and mapping.preferred = true
                          and length(trim(coalesce(
                            mapping.supplierSkuCode, ''))) > 0
                      ))
                      or (:matchMode in (
                            'STARTS_WITH', 'EQUALS', 'CONTAINS', 'ENDS_WITH')
                        and exists (
                          select 1 from SupplierSkuMapping mapping
                          where mapping.tenantId = s.tenantId
                            and mapping.skuId = s.id
                            and mapping.status =
                              cn.xzkj.erp.supplier.domain.SupplierSkuMappingStatus.ACTIVE
                            and mapping.preferred = true
                            and (
                              (:matchMode = 'STARTS_WITH'
                                and locate(:keyword, lower(coalesce(
                                  mapping.supplierSkuCode, ''))) = 1)
                              or (:matchMode = 'EQUALS'
                                and lower(coalesce(
                                  mapping.supplierSkuCode, '')) = :keyword)
                              or (:matchMode = 'CONTAINS'
                                and locate(:keyword, lower(coalesce(
                                  mapping.supplierSkuCode, ''))) > 0)
                              or (:matchMode = 'ENDS_WITH'
                                and locate(:keyword, lower(coalesce(
                                  mapping.supplierSkuCode, ''))) > 0
                                and locate(:keyword, lower(coalesce(
                                  mapping.supplierSkuCode, '')))
                                  = length(coalesce(
                                    mapping.supplierSkuCode, ''))
                                    - length(:keyword) + 1)
                            )
                        ))
                    ))
                 or (:searchField = 'DEFAULT_SUPPLIER' and (
                      (:matchMode = 'EMPTY' and not exists (
                        select 1 from SupplierSkuMapping mapping
                        where mapping.tenantId = s.tenantId
                          and mapping.skuId = s.id
                          and mapping.status =
                            cn.xzkj.erp.supplier.domain.SupplierSkuMappingStatus.ACTIVE
                          and mapping.preferred = true
                      ))
                      or (:matchMode = 'NOT_EMPTY' and exists (
                        select 1 from SupplierSkuMapping mapping
                        where mapping.tenantId = s.tenantId
                          and mapping.skuId = s.id
                          and mapping.status =
                            cn.xzkj.erp.supplier.domain.SupplierSkuMappingStatus.ACTIVE
                          and mapping.preferred = true
                      ))
                      or (:matchMode in (
                            'STARTS_WITH', 'EQUALS', 'CONTAINS', 'ENDS_WITH')
                        and exists (
                          select 1 from SupplierSkuMapping mapping
                          join Supplier supplier
                            on supplier.tenantId = mapping.tenantId
                           and supplier.id = mapping.supplierId
                          where mapping.tenantId = s.tenantId
                            and mapping.skuId = s.id
                            and mapping.status =
                              cn.xzkj.erp.supplier.domain.SupplierSkuMappingStatus.ACTIVE
                            and mapping.preferred = true
                            and (
                              (:matchMode = 'STARTS_WITH' and (
                                locate(:keyword,
                                  lower(supplier.businessCode)) = 1
                                or locate(:keyword,
                                  lower(supplier.name)) = 1))
                              or (:matchMode = 'EQUALS' and (
                                lower(supplier.businessCode) = :keyword
                                or lower(supplier.name) = :keyword))
                              or (:matchMode = 'CONTAINS' and (
                                locate(:keyword,
                                  lower(supplier.businessCode)) > 0
                                or locate(:keyword,
                                  lower(supplier.name)) > 0))
                              or (:matchMode = 'ENDS_WITH' and (
                                (locate(:keyword,
                                  lower(supplier.businessCode)) > 0
                                 and locate(:keyword,
                                   lower(supplier.businessCode))
                                   = length(supplier.businessCode)
                                     - length(:keyword) + 1)
                                or (locate(:keyword,
                                  lower(supplier.name)) > 0
                                 and locate(:keyword,
                                   lower(supplier.name))
                                   = length(supplier.name)
                                     - length(:keyword) + 1)))
                            )
                        ))
                    ))
                 or (:searchField = 'MASTER_CODE' and exists (
                    select 1 from ProductSpu p
                    where p.tenantId = s.tenantId
                      and p.id = s.spuId
                      and (
                        (:matchMode = 'STARTS_WITH'
                          and locate(:keyword, lower(p.businessCode)) = 1)
                        or (:matchMode = 'EQUALS'
                          and lower(p.businessCode) = :keyword)
                        or (:matchMode = 'CONTAINS'
                          and locate(:keyword, lower(p.businessCode)) > 0)
                        or (:matchMode = 'ENDS_WITH'
                          and locate(:keyword, lower(p.businessCode)) > 0
                          and locate(:keyword, lower(p.businessCode))
                            = length(p.businessCode) - length(:keyword) + 1)
                        or (:matchMode = 'EMPTY'
                          and length(trim(p.businessCode)) = 0)
                        or (:matchMode = 'NOT_EMPTY'
                          and length(trim(p.businessCode)) > 0)
                      )
                 )))
            order by
              case when :sortKey = 'BUSINESS_CODE_ASC'
                then lower(s.businessCode) end asc,
              case when :sortKey = 'BUSINESS_CODE_DESC'
                then lower(s.businessCode) end desc,
              case when :sortKey = 'CREATED_AT_ASC'
                then s.createdAt end asc,
              case when :sortKey = 'CREATED_AT_DESC'
                then s.createdAt end desc,
              s.id asc
            """)
    Page<ProductSku> searchByTenantId(
            @Param("tenantId") UUID tenantId,
            @Param("spuId") UUID spuId,
            @Param("categoryId") UUID categoryId,
            @Param("developerMemberId") UUID developerMemberId,
            @Param("developerAssistantMemberId")
            UUID developerAssistantMemberId,
            @Param("salesMemberId") UUID salesMemberId,
            @Param("artMemberId") UUID artMemberId,
            @Param("creatorId") UUID creatorId,
            @Param("hasCreatedFrom") boolean hasCreatedFrom,
            @Param("createdFrom") Instant createdFrom,
            @Param("hasCreatedTo") boolean hasCreatedTo,
            @Param("createdTo") Instant createdTo,
            @Param("status") ProductStatus status,
            @Param("archivedStatus") ProductStatus archivedStatus,
            @Param("filterPresent") boolean filterPresent,
            @Param("keyword") String keyword,
            @Param("searchField") String searchField,
            @Param("matchMode") String matchMode,
            @Param("sortKey") String sortKey,
            Pageable pageable
    );

    @Query("""
            select s.spuId as spuId, count(s.id) as skuCount,
                   sum(case when s.status = :activeStatus then 1 else 0 end) as activeSkuCount
            from ProductSku s
            where s.tenantId = :tenantId and s.spuId in :spuIds
            group by s.spuId
            """)
    List<SkuCountProjection> summarizeByTenantIdAndSpuIdIn(
            @Param("tenantId") UUID tenantId,
            @Param("spuIds") Collection<UUID> spuIds,
            @Param("activeStatus") ProductStatus activeStatus
    );

    interface SkuCountProjection {
        UUID getSpuId();
        long getSkuCount();
        long getActiveSkuCount();
    }

    @Query(value = """
            select sku.id as skuId,
              (select coalesce(user_row.display_name, '系统管理员')
                 from audit_logs audit_row
                 left join users user_row
                   on user_row.tenant_id = audit_row.tenant_id
                  and user_row.id = audit_row.actor_user_id
                where audit_row.tenant_id = :tenantId
                  and audit_row.resource_type = 'product_sku'
                  and audit_row.resource_id = cast(sku.id as text)
                  and audit_row.action = 'product_sku.created'
                order by audit_row.created_at asc, audit_row.id asc
                limit 1) as creatorName
            from tenant_product_skus sku
            where sku.tenant_id = :tenantId and sku.id in (:skuIds)
            """, nativeQuery = true)
    List<SkuCreatorProjection> creatorsByTenantIdAndSkuIdIn(
            @Param("tenantId") UUID tenantId,
            @Param("skuIds") Collection<UUID> skuIds);

    interface SkuCreatorProjection {
        UUID getSkuId();
        String getCreatorName();
    }
}
