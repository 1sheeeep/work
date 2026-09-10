package cn.xzkj.erp.customer.service;

import java.util.List;
import java.util.UUID;

public interface CustomerServiceShopProjectionProvider {

    List<ShopProjection> shopsForTenant(UUID tenantId);

    record ShopProjection(
            UUID id,
            String displayName,
            String externalShopRef,
            String status,
            String authorizationStatus,
            boolean credentialConfigured,
            String channelMode) {
    }
}
