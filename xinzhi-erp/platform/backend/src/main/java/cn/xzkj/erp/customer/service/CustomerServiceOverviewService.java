package cn.xzkj.erp.customer.service;

import cn.xzkj.erp.platform.domain.AuthorizationStatus;
import cn.xzkj.erp.platform.domain.ShopStatus;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class CustomerServiceOverviewService {

    private final CustomerServiceShopProjectionProvider shopProjectionProvider;

    public CustomerServiceOverviewService(
            CustomerServiceShopProjectionProvider shopProjectionProvider) {
        this.shopProjectionProvider = shopProjectionProvider;
    }

    public Overview summarize(UUID tenantId) {
        var shops = shopProjectionProvider.shopsForTenant(tenantId);
        long enabledShops = shops.stream()
                .filter(shop -> ShopStatus.ACTIVE.name().equals(shop.status()))
                .count();
        long authorizedShops = shops.stream()
                .filter(shop -> AuthorizationStatus.AUTHORIZED.name()
                        .equals(shop.authorizationStatus()))
                .count();
        long readyShops = shops.stream()
                .filter(shop -> ShopStatus.ACTIVE.name().equals(shop.status()))
                .filter(shop -> AuthorizationStatus.NOT_REQUIRED.name()
                        .equals(shop.authorizationStatus())
                        || AuthorizationStatus.AUTHORIZED.name()
                        .equals(shop.authorizationStatus())
                        && shop.credentialConfigured())
                .count();

        return new Overview(
                shops.size(),
                enabledShops,
                authorizedShops,
                readyShops,
                shops.size() - readyShops);
    }

    public record Overview(
            long totalShops,
            long enabledShops,
            long authorizedShops,
            long readyShops,
            long pendingSetupShops) {
    }
}
