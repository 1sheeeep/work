package cn.xzkj.erp.platform.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.repository.Repository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import cn.xzkj.erp.platform.domain.AuthorizationStatus;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.domain.TenantShop;
import jakarta.persistence.LockModeType;

public interface TenantShopRepository extends Repository<TenantShop, UUID> {

    <S extends TenantShop> S save(S entity);

    Optional<TenantShop> findByIdAndTenantId(UUID id, UUID tenantId);

    Optional<TenantShop> findByTenantIdAndPlatformIdAndExternalShopRef(
            UUID tenantId, UUID platformId, String externalShopRef);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select shop from TenantShop shop
            where shop.id = :id and shop.tenantId = :tenantId
            """)
    Optional<TenantShop> findForUpdateByIdAndTenantId(
            @Param("id") UUID id,
            @Param("tenantId") UUID tenantId
    );

    Page<TenantShop> findAllByTenantIdOrderByDisplayNameAscIdAsc(
            UUID tenantId,
            Pageable pageable
    );

    Page<TenantShop> findAllByTenantIdAndStatusNotOrderByDisplayNameAscIdAsc(
            UUID tenantId,
            ShopStatus excludedStatus,
            Pageable pageable
    );

    @Query("""
            select shop
            from TenantShop shop
            where shop.tenantId = :tenantId
              and (:includeArchived = true or shop.status <> :archivedStatus)
              and (:platformId is null or shop.platformId = :platformId)
              and (:shopStatus is null or shop.status = :shopStatus)
              and (
                    cast(:query as string) is null
                    or lower(shop.displayName) like lower(concat(
                        '%',
                        replace(replace(replace(
                            cast(:query as string), '\\', '\\\\'),
                            '%', '\\%'),
                            '_', '\\_'),
                        '%')) escape '\\'
                    or lower(shop.externalShopRef) like lower(concat(
                        '%',
                        replace(replace(replace(
                            cast(:query as string), '\\', '\\\\'),
                            '%', '\\%'),
                            '_', '\\_'),
                        '%')) escape '\\'
              )
              and (
                    :authorizationStatus is null
                    or exists (
                        select authorization.id
                        from ShopAuthorization authorization
                        where authorization.tenantId = :tenantId
                          and authorization.shopId = shop.id
                          and authorization.status = :authorizationStatus
                    )
              )
            order by shop.displayName asc, shop.id asc
            """)
    Page<TenantShop> findAllForTenantShopList(
            @Param("tenantId") UUID tenantId,
            @Param("includeArchived") boolean includeArchived,
            @Param("archivedStatus") ShopStatus archivedStatus,
            @Param("query") String query,
            @Param("platformId") UUID platformId,
            @Param("shopStatus") ShopStatus shopStatus,
            @Param("authorizationStatus") AuthorizationStatus authorizationStatus,
            Pageable pageable
    );

    boolean existsByTenantIdAndPlatformIdAndExternalShopRef(
            UUID tenantId,
            UUID platformId,
            String externalShopRef
    );

    boolean existsByPlatformIdAndStatusNot(
            UUID platformId,
            ShopStatus excludedStatus
    );
}
