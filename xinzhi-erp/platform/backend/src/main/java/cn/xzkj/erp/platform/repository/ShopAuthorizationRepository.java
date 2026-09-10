package cn.xzkj.erp.platform.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.repository.Repository;

import cn.xzkj.erp.platform.domain.ShopAuthorization;

public interface ShopAuthorizationRepository extends Repository<ShopAuthorization, UUID> {

    <S extends ShopAuthorization> S save(S entity);

    Optional<ShopAuthorization> findByTenantIdAndShopId(UUID tenantId, UUID shopId);

    List<ShopAuthorization> findAllByTenantIdAndShopIdIn(UUID tenantId, Collection<UUID> shopIds);
}
