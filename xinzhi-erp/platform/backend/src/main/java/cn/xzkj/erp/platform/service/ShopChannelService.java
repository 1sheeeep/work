package cn.xzkj.erp.platform.service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ChannelSnapshot;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderCatalogPage;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.OrderCatalogRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ProductCatalogPage;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ProductCatalogRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyAuthorizationStart;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ShopifyScopeCoverageStatus;
import cn.xzkj.erp.platform.domain.AuthorizationStatus;
import cn.xzkj.erp.platform.domain.ShopAuthorization;
import cn.xzkj.erp.platform.domain.ShopStatus;
import cn.xzkj.erp.platform.service.ShopCenterService.ShopWithAuthorization;

@Service
public class ShopChannelService {

    private static final String SHOPIFY_AUTHORIZE = "shop.channel.shopify.authorize";
    private static final String SHOPIFY_RETRY = "shop.channel.shopify.retry";
    private static final String SHOPIFY_UNINSTALL = "shop.channel.shopify.uninstall";

    private final ShopCenterService shopCenterService;
    private final ChannelConnectorGateway connector;
    private final SecurityAuditRecorder auditRecorder;

    public ShopChannelService(
            ShopCenterService shopCenterService,
            ChannelConnectorGateway connector,
            SecurityAuditRecorder auditRecorder) {
        this.shopCenterService = shopCenterService;
        this.connector = connector;
        this.auditRecorder = auditRecorder;
    }

    @Transactional
    public ChannelSnapshot get(ShopCenterActor actor, UUID shopId) {
        ShopWithAuthorization shop = requireShopifyShop(actor, shopId, false);
        ChannelSnapshot snapshot = connector.snapshot(actor.tenantId(), shopId);
        projectShopifyAuthorization(actor, shop, snapshot);
        return snapshot;
    }

    @Transactional(readOnly = true)
    public ProductCatalogPage fetchShopifyProductCatalog(
            ShopCenterActor actor,
            UUID shopId,
            int limit,
            String cursor,
            String query) {
        requireShopifyShop(actor, shopId, false);
        return connector.fetchShopifyProductCatalog(
                actor.tenantId(),
                shopId,
                new ProductCatalogRequest(
                        boundedCatalogLimit(limit),
                        nullable(cursor),
                        nullable(query)));
    }

    @Transactional(readOnly = true)
    public OrderCatalogPage fetchShopifyOrderCatalog(
            ShopCenterActor actor,
            UUID shopId,
            int limit,
            String cursor,
            String query) {
        requireShopifyShop(actor, shopId, false);
        return connector.fetchShopifyOrderCatalog(
                actor.tenantId(),
                shopId,
                new OrderCatalogRequest(
                        boundedCatalogLimit(limit),
                        nullable(cursor),
                        nullable(query)));
    }

    @Transactional
    public ShopifyAuthorizationStart authorizeShopify(
            ShopCenterActor actor,
            UUID shopId) {
        ShopWithAuthorization shop = requireShopifyShop(actor, shopId, true);
        ShopifyAuthorizationStart result = connector.startShopifyAuthorization(
                actor.tenantId(), shopId,
                shop.shop().getExternalShopRef());
        projectShopifyAuthorization(actor, shop, result.snapshot());
        audit(actor, shopId, SHOPIFY_AUTHORIZE, "SHOPIFY",
                result.snapshot().shopify().status().name(),
                result.snapshot().mode().name());
        return result;
    }

    @Transactional
    public ChannelSnapshot retryShopify(ShopCenterActor actor, UUID shopId) {
        ShopWithAuthorization shop = requireShopifyShop(actor, shopId, true);
        ChannelSnapshot result = connector.retryShopify(actor.tenantId(), shopId);
        projectShopifyAuthorization(actor, shop, result);
        audit(actor, shopId, SHOPIFY_RETRY, "SHOPIFY",
                result.shopify().status().name(), result.mode().name());
        return result;
    }

    @Transactional
    public ChannelSnapshot recordNativeShopifyLink(
            ShopCenterActor actor, UUID shopId, ChannelSnapshot result) {
        ShopWithAuthorization shop = requireShopifyShop(actor, shopId, true);
        projectShopifyAuthorization(actor, shop, result);
        audit(actor, shopId, "shop.channel.shopify.native_link", "SHOPIFY",
                result.shopify().status().name(), result.mode().name());
        return result;
    }

    @Transactional
    public ChannelSnapshot uninstallShopify(ShopCenterActor actor, UUID shopId) {
        ShopWithAuthorization shop = requireShopifyShop(actor, shopId, true);
        ChannelSnapshot result = connector.uninstallShopify(actor.tenantId(), shopId);
        projectShopifyAuthorization(actor, shop, result);
        audit(actor, shopId, SHOPIFY_UNINSTALL, "SHOPIFY",
                result.shopify().status().name(), result.mode().name());
        return result;
    }

    private ShopWithAuthorization requireActiveShop(
            ShopCenterActor actor,
            UUID shopId,
            boolean mutation) {
        if (actor == null || actor.tenantId() == null) {
            throw new IllegalArgumentException("Actor and tenant are required");
        }
        if ((actor.userId() == null) == (actor.systemAdminId() == null)) {
            throw new IllegalArgumentException("Exactly one actor identity is required");
        }
        ShopWithAuthorization shop = shopCenterService.getShop(
                actor.tenantId(), shopId);
        if (mutation && shop.shop().getStatus() != ShopStatus.ACTIVE) {
            throw new ConflictException("Channel actions require an active shop");
        }
        return shop;
    }

    private ShopWithAuthorization requireShopifyShop(
            ShopCenterActor actor,
            UUID shopId,
            boolean mutation) {
        ShopWithAuthorization shop = requireActiveShop(
                actor, shopId, mutation);
        if (shop.authorization().getStatus()
                == AuthorizationStatus.NOT_REQUIRED) {
            throw new ConflictException(
                    "Shopify channel actions require a Shopify shop");
        }
        return shop;
    }

    private void projectShopifyAuthorization(
            ShopCenterActor actor,
            ShopWithAuthorization shop,
            ChannelSnapshot snapshot) {
        if (snapshot.mode()
                != ChannelConnectorGateway.ConnectorMode.XZ_ERP_APP) {
            return;
        }
        ShopAuthorization current = shop.authorization();
        Set<String> grantedScopes = snapshot.shopifyScopes().stream()
                .filter(scope -> scope.status()
                        == ShopifyScopeCoverageStatus.GRANTED)
                .map(ChannelConnectorGateway.ShopifyPermissionScope::scope)
                .collect(Collectors.toUnmodifiableSet());
        AuthorizationStatus status;
        String credentialReference = null;
        String errorSummary = null;
        switch (snapshot.shopify().status()) {
            case CONNECTED -> {
                status = AuthorizationStatus.AUTHORIZED;
                credentialReference = "credential://shopify-connector/"
                        + shop.shop().getId();
                if (snapshot.shopify().shopName() != null
                        && snapshot.shopify().shopDomain() != null) {
                    shopCenterService.applyConnectorShopIdentity(
                            actor,
                            shop.shop().getId(),
                            snapshot.shopify().shopDomain(),
                            snapshot.shopify().shopName());
                }
            }
            case PENDING -> status = AuthorizationStatus.PENDING;
            case REVOKED -> status = AuthorizationStatus.REVOKED;
            case FAILED -> {
                status = AuthorizationStatus.ERROR;
                credentialReference = current.getCredentialReference();
                errorSummary = snapshot.shopify().safeErrorSummary() == null
                        ? "Shopify connector authorization failed"
                        : snapshot.shopify().safeErrorSummary();
            }
            case NOT_CONNECTED -> status = AuthorizationStatus.NOT_AUTHORIZED;
            default -> throw new IllegalStateException(
                    "Unsupported Shopify connector state");
        }
        String providerAccountRef = shop.shop().getExternalShopRef();
        if (matchesProjection(
                current,
                status,
                credentialReference,
                providerAccountRef,
                grantedScopes,
                errorSummary)) {
            return;
        }
        var verifiedAt = snapshot.shopify().updatedAt();
        shopCenterService.updateAuthorization(
                actor,
                shop.shop().getId(),
                status,
                credentialReference,
                providerAccountRef,
                grantedScopes,
                status == AuthorizationStatus.AUTHORIZED
                        ? current.getAuthorizedAt() == null
                                ? verifiedAt
                                : current.getAuthorizedAt()
                        : null,
                null,
                verifiedAt,
                errorSummary);
    }

    private static boolean matchesProjection(
            ShopAuthorization current,
            AuthorizationStatus status,
            String credentialReference,
            String providerAccountRef,
            Set<String> grantedScopes,
            String errorSummary) {
        return current.getStatus() == status
                && Objects.equals(
                        current.getCredentialReference(),
                        credentialReference)
                && Objects.equals(
                        current.getProviderAccountRef(),
                        providerAccountRef)
                && ShopCenterService.splitScopes(current.getScopeSummary())
                        .equals(grantedScopes)
                && Objects.equals(current.getErrorSummary(), errorSummary);
    }

    private void audit(
            ShopCenterActor actor,
            UUID shopId,
            String action,
            String target,
            String result,
            String mode) {
        Map<String, String> details = new LinkedHashMap<>();
        details.put("target", target);
        details.put("result", result);
        details.put("mode", mode);
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                action,
                "shop",
                shopId.toString(),
                actor.requestId(),
                actor.sourceIp(),
                details));
    }

    private static int boundedCatalogLimit(int limit) {
        if (limit < 1 || limit > 100) {
            throw new IllegalArgumentException(
                    "Shopify product catalog limit must be between 1 and 100");
        }
        return limit;
    }

    private static String nullable(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }
}
