package cn.xzkj.erp.order.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.repository.Repository;

import cn.xzkj.erp.product.domain.ProductSku;
import cn.xzkj.erp.product.domain.ProductStatus;

public interface OrderSkuLookupRepository extends Repository<ProductSku, UUID> {
    List<ProductSku> findAllByTenantIdAndIdIn(UUID tenantId, Collection<UUID> ids);
    Optional<ProductSku> findByIdAndTenantId(UUID id, UUID tenantId);
    List<ProductSku> findByTenantIdAndBusinessCodeInAndStatusNot(
            UUID tenantId,
            Collection<String> businessCodes,
            ProductStatus excludedStatus);
}
