package cn.xzkj.erp.product.repository;

import java.util.Optional;
import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import cn.xzkj.erp.product.domain.ListingStatus;
import cn.xzkj.erp.product.domain.ProductListing;
import cn.xzkj.erp.product.service.SkuListingSummary;

public interface ProductListingRepository extends Repository<ProductListing, UUID> {
    <S extends ProductListing> S save(S entity);
    Optional<ProductListing> findByIdAndTenantId(UUID id, UUID tenantId);
    Optional<ProductListing> findByTenantIdAndShopIdAndExternalListingRefAndExternalVariantRef(
            UUID tenantId, UUID shopId, String externalListingRef, String externalVariantRef);
    boolean existsByTenantIdAndSkuIdAndStatusNot(UUID tenantId, UUID skuId, ListingStatus excludedStatus);
    List<ProductListing> findAllByTenantIdAndShopIdAndSkuIdAndStatusAndExternalInventoryItemRefIsNotNull(
            UUID tenantId, UUID shopId, UUID skuId, ListingStatus status);

    @Query("""
            select l from ProductListing l where l.tenantId = :tenantId
            and (:shopId is null or l.shopId = :shopId)
            and (:skuId is null or l.skuId = :skuId)
            and ((:status is not null and l.status = :status)
                 or (:status is null and l.status <> :archivedStatus))
            and (:keywordPresent = false
                 or (:searchField = 'ALL' and (
                    locate(:keyword, lower(l.externalListingRef)) > 0
                    or locate(:keyword, lower(coalesce(l.externalVariantRef, ''))) > 0
                    or locate(:keyword, lower(coalesce(l.externalStatus, ''))) > 0))
                 or (:searchField = 'PLATFORM_PRODUCT'
                    and locate(:keyword, lower(l.externalListingRef)) > 0)
                 or (:searchField = 'PLATFORM_VARIANT'
                    and locate(:keyword, lower(coalesce(l.externalVariantRef, ''))) > 0)
                 or (:searchField = 'EXTERNAL_STATUS'
                    and locate(:keyword, lower(coalesce(l.externalStatus, ''))) > 0)
                 or ((:searchField = 'ALL' or :searchField = 'INVENTORY_SKU')
                    and exists (
                    select 1 from ProductSku sku
                    where sku.tenantId = l.tenantId
                      and sku.id = l.skuId
                      and (locate(:keyword, lower(sku.businessCode)) > 0
                           or locate(:keyword, lower(sku.name)) > 0))))
            order by l.externalListingRef asc, l.id asc
            """)
    Page<ProductListing> searchByTenantId(
            @Param("tenantId") UUID tenantId,
            @Param("shopId") UUID shopId,
            @Param("skuId") UUID skuId,
            @Param("status") ListingStatus status,
            @Param("archivedStatus") ListingStatus archivedStatus,
            @Param("keywordPresent") boolean keywordPresent,
            @Param("keyword") String keyword,
            @Param("searchField") String searchField,
            Pageable pageable
    );

    @Query("""
            select new cn.xzkj.erp.product.service.SkuListingSummary(
                listing.skuId,
                count(listing)
            )
            from ProductListing listing
            where listing.tenantId = :tenantId
              and listing.skuId in :skuIds
              and listing.status = :status
            group by listing.skuId
            order by listing.skuId
            """)
    java.util.List<SkuListingSummary> summarizeByTenantIdAndSkuIdIn(
            @Param("tenantId") UUID tenantId,
            @Param("skuIds") java.util.Collection<UUID> skuIds,
            @Param("status") ListingStatus status);
}
