package cn.xzkj.erp.order.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.repository.Repository;

import cn.xzkj.erp.product.domain.ListingStatus;
import cn.xzkj.erp.product.domain.ProductListing;

public interface OrderListingLookupRepository extends Repository<ProductListing, UUID> {
    List<ProductListing> findAllByTenantIdAndShopIdAndStatusAndExternalListingRefIn(
            UUID tenantId, UUID shopId, ListingStatus status, Collection<String> externalListingRefs);

    Optional<ProductListing> findByIdAndTenantIdAndShopIdAndStatus(
            UUID id, UUID tenantId, UUID shopId, ListingStatus status);
}
