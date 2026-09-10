package cn.xzkj.erp.product.repository;

import java.util.Optional;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import cn.xzkj.erp.product.domain.ProductSpu;
import cn.xzkj.erp.product.domain.ProductStatus;
import jakarta.persistence.LockModeType;

public interface ProductSpuRepository extends Repository<ProductSpu, UUID> {
    <S extends ProductSpu> S save(S entity);
    void flush();
    Optional<ProductSpu> findByIdAndTenantId(UUID id, UUID tenantId);
    List<ProductSpu> findByTenantIdAndIdIn(
            UUID tenantId,
            Collection<UUID> ids);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select p from ProductSpu p
            where p.id = :id and p.tenantId = :tenantId
            """)
    Optional<ProductSpu> findForUpdateByIdAndTenantId(
            @Param("id") UUID id,
            @Param("tenantId") UUID tenantId);

    boolean existsByTenantIdAndBusinessCode(UUID tenantId, String businessCode);

    boolean existsByTenantIdAndCategoryId(UUID tenantId, UUID categoryId);

    boolean existsByTenantIdAndPackageMaterialId(
            UUID tenantId,
            UUID packageMaterialId);

    @Query("""
            select p from ProductSpu p where p.tenantId = :tenantId
            and ((:status is not null and p.status = :status)
                 or (:status is null and p.status <> :archivedStatus))
            and (:keywordPresent = false
                 or locate(:keyword, lower(p.businessCode)) > 0
                 or locate(:keyword, lower(p.name)) > 0
                 or locate(:keyword, lower(coalesce(p.nameEn, ''))) > 0
                 or locate(:keyword, lower(coalesce(p.brandName, ''))) > 0
                 or locate(:keyword, lower(coalesce(
                     p.categoryNameSnapshot, ''))) > 0)
            order by p.businessCode asc, p.id asc
            """)
    Page<ProductSpu> searchByTenantId(
            @Param("tenantId") UUID tenantId,
            @Param("status") ProductStatus status,
            @Param("archivedStatus") ProductStatus archivedStatus,
            @Param("keywordPresent") boolean keywordPresent,
            @Param("keyword") String keyword,
            Pageable pageable
    );

    @Query(value = """
            select p.* from tenant_product_spus p where p.tenant_id = :tenantId
            and ((cast(:status as text) is not null and p.status = cast(:status as text))
                 or (cast(:status as text) is null and p.status <> cast(:archivedStatus as text)))
            and (cast(:categoryId as uuid) is null or p.category_id = cast(:categoryId as uuid))
            and (cast(:developerMemberId as uuid) is null or p.developer_member_id = cast(:developerMemberId as uuid))
            and (cast(:createdFrom as timestamptz) is null or p.created_at >= cast(:createdFrom as timestamptz))
            and (cast(:createdTo as timestamptz) is null or p.created_at < cast(:createdTo as timestamptz))
            and (cast(:creatorId as uuid) is null or exists (select 1 from audit_logs a
                 where a.tenant_id = p.tenant_id and a.resource_type = 'product_spu'
                 and a.resource_id = cast(p.id as text) and a.action = 'product_spu.created'
                 and a.actor_user_id = cast(:creatorId as uuid)))
            and (:keywordPresent = false or
                 (:searchField = 'ALL' and (lower(p.business_code) like concat('%', :keyword, '%')
                    or lower(p.name) like concat('%', :keyword, '%')
                    or lower(coalesce(p.name_en, '')) like concat('%', :keyword, '%')
                    or exists (select 1 from tenant_product_skus sku where sku.tenant_id = p.tenant_id
                        and sku.spu_id = p.id and lower(sku.business_code) like concat('%', :keyword, '%'))))
                 or (:searchField = 'MASTER_CODE' and lower(p.business_code) like concat('%', :keyword, '%'))
                 or (:searchField = 'NAME_ZH' and lower(p.name) like concat('%', :keyword, '%'))
                 or (:searchField = 'NAME_EN' and lower(coalesce(p.name_en, '')) like concat('%', :keyword, '%'))
                 or (:searchField = 'INVENTORY_SKU' and exists (select 1 from tenant_product_skus sku
                    where sku.tenant_id = p.tenant_id and sku.spu_id = p.id
                    and lower(sku.business_code) like concat('%', :keyword, '%'))))
            order by
              case when :sortBy = 'CATEGORY' and :descending = false then coalesce(p.category_name_snapshot, '') end asc,
              case when :sortBy = 'CATEGORY' and :descending = true then coalesce(p.category_name_snapshot, '') end desc,
              case when :sortBy = 'SALES_42' and :descending = false then coalesce((select sum(line.quantity)
                from tenant_product_skus sku join tenant_order_lines line
                  on line.tenant_id = sku.tenant_id and line.sku_id = sku.id
                join tenant_orders o on o.tenant_id = line.tenant_id and o.id = line.order_id
                where sku.tenant_id = p.tenant_id and sku.spu_id = p.id
                  and o.status <> 'CANCELLED' and o.placed_at >= now() - interval '42 days'), 0) end asc,
              case when :sortBy = 'SALES_42' and :descending = true then coalesce((select sum(line.quantity)
                from tenant_product_skus sku join tenant_order_lines line
                  on line.tenant_id = sku.tenant_id and line.sku_id = sku.id
                join tenant_orders o on o.tenant_id = line.tenant_id and o.id = line.order_id
                where sku.tenant_id = p.tenant_id and sku.spu_id = p.id
                  and o.status <> 'CANCELLED' and o.placed_at >= now() - interval '42 days'), 0) end desc,
              case when :sortBy = 'FORECAST_DAILY_SALES' and :descending = false then coalesce((select sum(line.quantity)
                from tenant_product_skus sku join tenant_order_lines line
                  on line.tenant_id = sku.tenant_id and line.sku_id = sku.id
                join tenant_orders o on o.tenant_id = line.tenant_id and o.id = line.order_id
                where sku.tenant_id = p.tenant_id and sku.spu_id = p.id
                  and o.status <> 'CANCELLED' and o.placed_at >= now() - interval '28 days'), 0)::numeric / 28 end asc,
              case when :sortBy = 'FORECAST_DAILY_SALES' and :descending = true then coalesce((select sum(line.quantity)
                from tenant_product_skus sku join tenant_order_lines line
                  on line.tenant_id = sku.tenant_id and line.sku_id = sku.id
                join tenant_orders o on o.tenant_id = line.tenant_id and o.id = line.order_id
                where sku.tenant_id = p.tenant_id and sku.spu_id = p.id
                  and o.status <> 'CANCELLED' and o.placed_at >= now() - interval '28 days'), 0)::numeric / 28 end desc,
              case when :sortBy = 'CREATED_AT' and :descending = false then p.created_at end asc,
              case when :sortBy = 'CREATED_AT' and :descending = true then p.created_at end desc,
              case when :sortBy = 'BUSINESS_CODE' and :descending = false then p.business_code end asc,
              case when :sortBy = 'BUSINESS_CODE' and :descending = true then p.business_code end desc,
              p.business_code asc, p.id asc
            """, countQuery = """
            select count(*) from tenant_product_spus p where p.tenant_id = :tenantId
            and ((cast(:status as text) is not null and p.status = cast(:status as text))
                 or (cast(:status as text) is null and p.status <> cast(:archivedStatus as text)))
            and (cast(:categoryId as uuid) is null or p.category_id = cast(:categoryId as uuid))
            and (cast(:developerMemberId as uuid) is null or p.developer_member_id = cast(:developerMemberId as uuid))
            and (cast(:createdFrom as timestamptz) is null or p.created_at >= cast(:createdFrom as timestamptz))
            and (cast(:createdTo as timestamptz) is null or p.created_at < cast(:createdTo as timestamptz))
            and (cast(:creatorId as uuid) is null or exists (select 1 from audit_logs a
                 where a.tenant_id = p.tenant_id and a.resource_type = 'product_spu'
                 and a.resource_id = cast(p.id as text) and a.action = 'product_spu.created'
                 and a.actor_user_id = cast(:creatorId as uuid)))
            and (:keywordPresent = false or
                 (:searchField = 'ALL' and (lower(p.business_code) like concat('%', :keyword, '%')
                    or lower(p.name) like concat('%', :keyword, '%')
                    or lower(coalesce(p.name_en, '')) like concat('%', :keyword, '%')
                    or exists (select 1 from tenant_product_skus sku where sku.tenant_id = p.tenant_id
                        and sku.spu_id = p.id and lower(sku.business_code) like concat('%', :keyword, '%'))))
                 or (:searchField = 'MASTER_CODE' and lower(p.business_code) like concat('%', :keyword, '%'))
                 or (:searchField = 'NAME_ZH' and lower(p.name) like concat('%', :keyword, '%'))
                 or (:searchField = 'NAME_EN' and lower(coalesce(p.name_en, '')) like concat('%', :keyword, '%'))
                 or (:searchField = 'INVENTORY_SKU' and exists (select 1 from tenant_product_skus sku
                    where sku.tenant_id = p.tenant_id and sku.spu_id = p.id
                    and lower(sku.business_code) like concat('%', :keyword, '%'))))
            and (:sortBy is not null) and (:descending = true or :descending = false)
            """, nativeQuery = true)
    Page<ProductSpu> searchMasterByTenantId(
            @Param("tenantId") UUID tenantId,
            @Param("status") String status,
            @Param("archivedStatus") String archivedStatus,
            @Param("keywordPresent") boolean keywordPresent,
            @Param("keyword") String keyword,
            @Param("searchField") String searchField,
            @Param("categoryId") UUID categoryId,
            @Param("developerMemberId") UUID developerMemberId,
            @Param("creatorId") UUID creatorId,
            @Param("createdFrom") Instant createdFrom,
            @Param("createdTo") Instant createdTo,
            @Param("sortBy") String sortBy,
            @Param("descending") boolean descending,
            Pageable pageable);

    @Query(value = """
            select p.id as spuId,
              coalesce((select sum(b.on_hand)
                from tenant_product_skus sku join inventory_balances b
                  on b.tenant_id = sku.tenant_id and b.sku_id = sku.id
                where sku.tenant_id = :tenantId and sku.spu_id = p.id), 0) as totalInventory,
              coalesce((select sum(case when o.placed_at >= :since7 then line.quantity else 0 end)
                from tenant_product_skus sku join tenant_order_lines line
                  on line.tenant_id = sku.tenant_id and line.sku_id = sku.id
                join tenant_orders o on o.tenant_id = line.tenant_id and o.id = line.order_id
                where sku.tenant_id = :tenantId and sku.spu_id = p.id and o.status <> 'CANCELLED'
                  and o.placed_at >= :since42), 0) as sales7,
              coalesce((select sum(case when o.placed_at >= :since28 then line.quantity else 0 end)
                from tenant_product_skus sku join tenant_order_lines line
                  on line.tenant_id = sku.tenant_id and line.sku_id = sku.id
                join tenant_orders o on o.tenant_id = line.tenant_id and o.id = line.order_id
                where sku.tenant_id = :tenantId and sku.spu_id = p.id and o.status <> 'CANCELLED'
                  and o.placed_at >= :since42), 0) as sales28,
              coalesce((select sum(line.quantity)
                from tenant_product_skus sku join tenant_order_lines line
                  on line.tenant_id = sku.tenant_id and line.sku_id = sku.id
                join tenant_orders o on o.tenant_id = line.tenant_id and o.id = line.order_id
                where sku.tenant_id = :tenantId and sku.spu_id = p.id and o.status <> 'CANCELLED'
                  and o.placed_at >= :since42), 0) as sales42,
              (select coalesce(u.display_name, '系统管理员')
                from audit_logs a left join users u on u.tenant_id = a.tenant_id and u.id = a.actor_user_id
                where a.tenant_id = :tenantId and a.resource_type = 'product_spu'
                  and a.resource_id = cast(p.id as text) and a.action = 'product_spu.created'
                order by a.created_at asc, a.id asc limit 1) as creatorName
            from tenant_product_spus p
            where p.tenant_id = :tenantId and p.id in (:spuIds)
            """, nativeQuery = true)
    List<MasterSpuMetricsProjection> masterMetricsByTenantIdAndSpuIdIn(
            @Param("tenantId") UUID tenantId,
            @Param("spuIds") Collection<UUID> spuIds,
            @Param("since7") Instant since7,
            @Param("since28") Instant since28,
            @Param("since42") Instant since42);

    interface MasterSpuMetricsProjection {
        UUID getSpuId();
        long getTotalInventory();
        long getSales7();
        long getSales28();
        long getSales42();
        String getCreatorName();
    }
}
