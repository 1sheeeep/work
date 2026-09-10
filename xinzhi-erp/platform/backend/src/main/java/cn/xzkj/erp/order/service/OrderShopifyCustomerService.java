package cn.xzkj.erp.order.service;

import static cn.xzkj.erp.order.domain.OrderAuditActions.PROTECTED_CUSTOMER_DATA_READ;

import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import org.springframework.stereotype.Service;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.CustomerCatalogPage;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.CustomerCatalogRequest;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;

@Service
public class OrderShopifyCustomerService {

    private final ChannelConnectorGateway connector;
    private final SecurityAuditRecorder auditRecorder;

    public OrderShopifyCustomerService(
            ChannelConnectorGateway connector,
            SecurityAuditRecorder auditRecorder) {
        this.connector = connector;
        this.auditRecorder = auditRecorder;
    }

    public CustomerCatalogPage customers(
            OrderActor actor,
            UUID shopId,
            int limit,
            String cursor,
            String query) {
        requireActor(actor);
        Objects.requireNonNull(shopId, "Shop is required");
        if (limit < 1 || limit > 100) {
            throw new IllegalArgumentException(
                    "Page limit must be between 1 and 100");
        }
        String normalizedCursor = bounded(cursor, 4096, "cursor");
        String normalizedQuery = bounded(query, 200, "query");
        requireCustomerScope(actor.tenantId(), shopId);
        CustomerCatalogPage page = connector.fetchShopifyCustomerCatalog(
                actor.tenantId(), shopId,
                new CustomerCatalogRequest(
                        limit, normalizedCursor, normalizedQuery));
        if (page == null || page.connectionStatus() != ConnectionStatus.CONNECTED
                || page.customers() == null || page.customers().size() > limit
                || (page.hasNextPage() && blank(page.cursor()))) {
            throw new ConflictException(
                    "Shopify customer catalog is unavailable");
        }
        auditRecorder.record(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                PROTECTED_CUSTOMER_DATA_READ,
                "shopify_customer_catalog", shopId.toString(),
                actor.requestId(), actor.sourceIp(), Map.of(
                        "surface", "customerDirectory",
                        "fieldSet", "name,email,phone,location,orderSummary",
                        "queryProvided", Boolean.toString(normalizedQuery != null),
                        "resultCount", Integer.toString(page.customers().size()))));
        return page;
    }

    private void requireCustomerScope(UUID tenantId, UUID shopId) {
        var snapshot = connector.snapshot(tenantId, shopId);
        if (snapshot == null
                || snapshot.shopify().status() != ConnectionStatus.CONNECTED) {
            throw ShopifyAuthorizationConflictException.notConnected();
        }
        var coverage = snapshot.shopifyScopes().stream()
                .filter(item -> "read_customers".equals(item.scope()))
                .findFirst()
                .orElseThrow(ShopifyAuthorizationConflictException::scopeUnavailable);
        if (coverage.status()
                == ChannelConnectorGateway.ShopifyScopeCoverageStatus.MISSING) {
            throw ShopifyAuthorizationConflictException
                    .missingScope("read_customers");
        }
    }

    private static void requireActor(OrderActor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null && actor.systemAdminId() == null)) {
            throw new IllegalArgumentException("Actor is required");
        }
    }

    private static String bounded(String value, int limit, String field) {
        if (blank(value)) {
            return null;
        }
        String normalized = value.strip();
        if (normalized.length() > limit
                || normalized.codePoints().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException(field + " is invalid");
        }
        return normalized;
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
