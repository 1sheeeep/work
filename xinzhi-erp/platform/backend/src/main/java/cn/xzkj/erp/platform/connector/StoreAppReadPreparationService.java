package cn.xzkj.erp.platform.connector;

import java.util.UUID;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.service.ShopCenterActor;
import cn.xzkj.erp.platform.service.ShopCenterService;

// A single reviewed rehearsal shop. This is not an active-provider router and
// must not be injected as ChannelConnectorGateway or project authorization state.
@Service
@ConditionalOnProperty(name = "erp.store-app-read-preparation.enabled", havingValue = "true")
public class StoreAppReadPreparationService {
    private static final String PREFIX = "erp.store-app-read-preparation.";
    private final ShopCenterService shops;
    private final XzErpAppChannelConnectorGateway reader;
    private final UUID tenantId;
    private final UUID shopId;
    private final long bindingVersion;
    private final String shopDomain;

    public StoreAppReadPreparationService(Environment environment, ShopCenterService shops) {
        this.shops = shops;
        tenantId = UUID.fromString(environment.getRequiredProperty(PREFIX + "tenant-id"));
        shopId = UUID.fromString(environment.getRequiredProperty(PREFIX + "shop-id"));
        bindingVersion = Long.parseLong(environment.getRequiredProperty(PREFIX + "binding-version"));
        shopDomain = environment.getRequiredProperty(PREFIX + "shop-domain");
        if (!shopDomain.matches("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.myshopify\\.com$")) {
            throw new IllegalArgumentException("Store app preparation domain is invalid");
        }
        reader = XzErpAppChannelConnectorGateway.storeAppReadPreparation(
                environment.getRequiredProperty(PREFIX + "base-url"),
                environment.getRequiredProperty(PREFIX + "service-token"),
                new XzErpAppChannelConnectorGateway.StoreAppReadBinding(tenantId, shopId, bindingVersion));
    }

    @Transactional(readOnly = true)
    public StatusPreview status(ShopCenterActor actor, UUID requestedShopId) {
        requireShop(actor, requestedShopId);
        var snapshot = reader.snapshot(tenantId, shopId);
        if (!shopDomain.equals(snapshot.shopify().shopDomain())) throw new ConnectorUnavailableException();
        return new StatusPreview(true, false, bindingVersion, snapshot);
    }

    @Transactional(readOnly = true)
    public OrderPreview orders(ShopCenterActor actor, UUID requestedShopId, int limit, String cursor) {
        requireShop(actor, requestedShopId);
        if (limit < 1 || limit > 25 || (cursor != null && cursor.length() > 2048)) {
            throw new IllegalArgumentException("Store app preparation page is invalid");
        }
        var page = reader.fetchShopifyOrderCatalog(tenantId, shopId,
                new ChannelConnectorGateway.OrderCatalogRequest(limit, cursor, null));
        return new OrderPreview(true, false, bindingVersion, page);
    }

    private void requireShop(ShopCenterActor actor, UUID requestedShopId) {
        if (actor == null || actor.userId() == null || actor.systemAdminId() != null
                || !tenantId.equals(actor.tenantId()) || !shopId.equals(requestedShopId)) {
            throw new ConnectorUnavailableException();
        }
        var shop = shops.getShop(tenantId, shopId).shop();
        if (shop.getStatus() != ShopStatus.ACTIVE || !shopDomain.equals(shop.getExternalShopRef())
                || !"SHOPIFY".equals(shops.getPlatform(shop.getPlatformId()).getCode())) {
            throw new ConnectorUnavailableException();
        }
    }

    public record StatusPreview(boolean readOnly, boolean productionReady, long bindingVersion,
            ChannelConnectorGateway.ChannelSnapshot snapshot) { }
    public record OrderPreview(boolean readOnly, boolean productionReady, long bindingVersion,
            ChannelConnectorGateway.OrderCatalogPage page) { }
}
