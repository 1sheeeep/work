package cn.xzkj.erp.customer.service;

import cn.xzkj.erp.platform.domain.AuthorizationStatus;
import cn.xzkj.erp.platform.domain.ShopAuthorization;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.repository.ShopAuthorizationRepository;
import cn.xzkj.erp.platform.repository.TenantShopRepository;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DefaultCustomerServiceShopProjectionProvider
        implements CustomerServiceShopProjectionProvider {

    private static final int PAGE_SIZE = 100;

    private final TenantShopRepository shopRepository;
    private final ShopAuthorizationRepository authorizationRepository;

    public DefaultCustomerServiceShopProjectionProvider(
            TenantShopRepository shopRepository,
            ShopAuthorizationRepository authorizationRepository) {
        this.shopRepository = shopRepository;
        this.authorizationRepository = authorizationRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public List<ShopProjection> shopsForTenant(UUID tenantId) {
        List<cn.xzkj.erp.platform.domain.TenantShop> shops = new ArrayList<>();
        int pageNumber = 0;
        while (true) {
            var page = shopRepository.findAllByTenantIdAndStatusNotOrderByDisplayNameAscIdAsc(
                    tenantId,
                    ShopStatus.ARCHIVED,
                    PageRequest.of(pageNumber, PAGE_SIZE));
            shops.addAll(page.getContent());
            if (!page.hasNext()) {
                break;
            }
            pageNumber++;
        }

        Map<UUID, ShopAuthorization> authorizationByShopId = new HashMap<>();
        if (!shops.isEmpty()) {
            authorizationRepository.findAllByTenantIdAndShopIdIn(
                            tenantId,
                            shops.stream().map(value -> value.getId()).toList())
                    .forEach(value -> authorizationByShopId.put(value.getShopId(), value));
        }

        return shops.stream().map(shop -> {
            ShopAuthorization authorization = authorizationByShopId.get(shop.getId());
            AuthorizationStatus authorizationStatus = authorization == null
                    ? AuthorizationStatus.NOT_AUTHORIZED
                    : authorization.getStatus();
            boolean credentialConfigured = authorization != null
                    && authorization.getCredentialReference() != null
                    && !authorization.getCredentialReference().isBlank();
            String channelMode = switch (authorizationStatus) {
                case AUTHORIZED -> "XZ_ERP_APP";
                case NOT_REQUIRED -> "INTERNAL";
                default -> "UNCONFIGURED";
            };
            return new ShopProjection(
                    shop.getId(),
                    shop.getDisplayName(),
                    shop.getExternalShopRef(),
                    shop.getStatus().name(),
                    authorizationStatus.name(),
                    credentialConfigured,
                    channelMode);
        }).toList();
    }
}
