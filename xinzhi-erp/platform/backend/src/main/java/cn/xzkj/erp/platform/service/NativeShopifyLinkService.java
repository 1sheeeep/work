package cn.xzkj.erp.platform.service;

import cn.xzkj.erp.iam.persistence.IamAssignmentStore;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.NativeShopifyLinkPreview;
import cn.xzkj.erp.platform.domain.PlatformCatalogEntry;
import cn.xzkj.erp.platform.domain.PlatformStatus;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.domain.TenantShop;
import cn.xzkj.erp.platform.repository.PlatformCatalogRepository;
import cn.xzkj.erp.platform.repository.TenantShopRepository;
import java.util.Objects;
import java.util.UUID;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class NativeShopifyLinkService {
    private final ChannelConnectorGateway connector;
    private final PlatformCatalogRepository platforms;
    private final TenantShopRepository shops;
    private final ShopCenterService shopCenter;
    private final ShopChannelService channels;
    private final IamAssignmentStore assignments;
    private final PermissionRepository permissions;
    private final TransactionTemplate prepareTransaction;

    public NativeShopifyLinkService(ChannelConnectorGateway connector,
            PlatformCatalogRepository platforms, TenantShopRepository shops,
            ShopCenterService shopCenter, ShopChannelService channels,
            IamAssignmentStore assignments, PermissionRepository permissions,
            PlatformTransactionManager transactions) {
        this.connector = connector;
        this.platforms = platforms;
        this.shops = shops;
        this.shopCenter = shopCenter;
        this.channels = channels;
        this.assignments = assignments;
        this.permissions = permissions;
        prepareTransaction = new TransactionTemplate(transactions);
        prepareTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public Preview preview(ShopCenterActor actor, String proof) {
        boolean canCreate = requireNativeAdministrator(actor);
        var pending = connector.previewNativeShopifyLink(proof);
        var platform = requirePlatform();
        var existing = shops.findByTenantIdAndPlatformIdAndExternalShopRef(
                actor.tenantId(), platform.getId(), pending.shopDomain());
        existing.ifPresent(NativeShopifyLinkService::requireActive);
        return new Preview(pending, existing.map(NativeShopifyLinkService::summary).orElse(null), canCreate);
    }

    public PreparedShop prepare(ShopCenterActor actor, String proof) {
        requireNativeAdministrator(actor);
        var pending = connector.previewNativeShopifyLink(proof);
        // Commit the canonical shop before any remote ownership change. A lost response
        // can then be retried using the same verified domain and returns the same shop.
        return Objects.requireNonNull(prepareTransaction.execute(status -> {
            boolean canCreate = requireNativeAdministrator(actor);
            var platform = platforms.findForUpdateById(requirePlatform().getId())
                    .orElseThrow(() -> new ConflictException("Shopify platform is unavailable"));
            requireSupported(platform);
            var existing = shops.findByTenantIdAndPlatformIdAndExternalShopRef(
                    actor.tenantId(), platform.getId(), pending.shopDomain());
            if (existing.isPresent()) {
                requireActive(existing.get());
                return summary(existing.get());
            }
            if (!canCreate) throw new AccessDeniedException("Shop creation permission required");
            return summary(shopCenter.createShopWithDisplayName(actor, platform.getId(),
                    pending.shopDomain(), pending.shopName()).shop());
        }));
    }

    @Transactional
    public PreparedShop confirm(ShopCenterActor actor, UUID shopId, String proof) {
        requireNativeAdministrator(actor);
        var shop = shops.findForUpdateByIdAndTenantId(shopId, actor.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException("Shop was not found"));
        requireActive(shop);
        if (!shop.getPlatformId().equals(requirePlatform().getId())) {
            throw new ConflictException("An active Shopify shop is required");
        }
        // Do not preview a consumed proof: the Connector's exact-identity receipt is
        // the authority for retries after a timeout or local projection failure.
        var result = connector.confirmNativeShopifyLink(actor.tenantId(), shopId,
                actor.userId(), shop.getExternalShopRef(), proof);
        channels.recordNativeShopifyLink(actor, shopId, result);
        return summary(shop);
    }

    private boolean requireNativeAdministrator(ShopCenterActor actor) {
        if (actor == null || actor.tenantId() == null || actor.userId() == null
                || actor.systemAdminId() != null
                || !assignments.existsUserWithSystemRoleCode(actor.tenantId(), actor.userId(), "tenant_admin")) {
            throw new AccessDeniedException("Native enterprise administrator required");
        }
        var current = permissions.findCodesByTenantIdAndUserId(actor.tenantId(), actor.userId());
        if (!current.contains("shop:authorization:write")) {
            throw new AccessDeniedException("Shop authorization permission required");
        }
        return current.contains("shop:write");
    }

    private PlatformCatalogEntry requirePlatform() {
        var platform = platforms.findByCode("SHOPIFY")
                .orElseThrow(() -> new ConflictException("Shopify platform is unavailable"));
        requireSupported(platform);
        return platform;
    }

    private static void requireSupported(PlatformCatalogEntry platform) {
        if (!"SHOPIFY".equals(platform.getCode()) || platform.getStatus() != PlatformStatus.ACTIVE) {
            throw new ConflictException("Shopify platform is unavailable");
        }
    }

    private static void requireActive(TenantShop shop) {
        if (shop.getStatus() != ShopStatus.ACTIVE) throw new ConflictException("Shop is not active");
    }

    private static PreparedShop summary(TenantShop shop) {
        return new PreparedShop(shop.getId(), shop.getExternalShopRef(), shop.getDisplayName());
    }

    public record Preview(NativeShopifyLinkPreview pending, PreparedShop existingShop, boolean canCreateShop) { }
    public record PreparedShop(UUID shopId, String shopDomain, String shopName) { }
}
