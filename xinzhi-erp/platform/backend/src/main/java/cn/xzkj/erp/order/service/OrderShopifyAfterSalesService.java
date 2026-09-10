package cn.xzkj.erp.order.service;

import static cn.xzkj.erp.order.domain.OrderAuditActions.SHOPIFY_RETURN_DECIDED;
import static cn.xzkj.erp.order.domain.OrderAuditActions.SHOPIFY_RETURN_REFUND_PROCESSED;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.order.service.OrderCenterService.OrderActor;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ConnectionStatus;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.DisputeCatalogPage;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.DisputeCatalogRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnCatalogPage;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnCatalogRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnDecisionRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnDecisionResult;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnRefundPreview;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnRefundPreviewRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnRefundProcessRequest;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.ReturnRefundProcessResult;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;

@Service
public class OrderShopifyAfterSalesService {

    private static final Pattern KEY =
            Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$");
    private static final Pattern RETURN_GID =
            Pattern.compile("^gid://shopify/Return/[0-9]+$");
    private static final Pattern RETURN_LINE_GID =
            Pattern.compile("^gid://shopify/ReturnLineItem/[0-9]+$");
    private static final List<String> RETURN_READ_SCOPES =
            List.of("read_orders", "read_returns");
    private static final List<String> RETURN_WRITE_SCOPES =
            List.of("read_orders", "read_returns", "write_returns");
    private static final List<String> DISPUTE_READ_SCOPES =
            List.of("read_shopify_payments_disputes");

    private final ChannelConnectorGateway connector;
    private final SecurityAuditRecorder auditRecorder;

    public OrderShopifyAfterSalesService(
            ChannelConnectorGateway connector,
            SecurityAuditRecorder auditRecorder) {
        this.connector = connector;
        this.auditRecorder = auditRecorder;
    }

    public ReturnCatalogPage returns(
            UUID tenantId,
            UUID shopId,
            int limit,
            String cursor,
            String query) {
        requireIdentity(tenantId, shopId);
        requirePage(limit, cursor, query);
        requireScopes(tenantId, shopId, RETURN_READ_SCOPES);
        ReturnCatalogPage page = connector.fetchShopifyReturnCatalog(
                tenantId, shopId, new ReturnCatalogRequest(
                        limit, bounded(cursor, 4096, "cursor"),
                        bounded(query, 500, "query")));
        if (page == null || page.connectionStatus() != ConnectionStatus.CONNECTED
                || page.returns() == null || page.returns().size() > limit
                || (page.hasNextPage() && blank(page.cursor()))) {
            throw unavailable("Shopify return catalog is unavailable");
        }
        return page;
    }

    public ReturnDecisionResult decideReturn(
            OrderActor actor,
            UUID shopId,
            ReturnDecisionRequest request) {
        requireActor(actor);
        requireIdentity(actor.tenantId(), shopId);
        Objects.requireNonNull(request, "Return decision is required");
        requireGid(RETURN_GID, request.externalReturnRef(), "Return reference");
        requireKey(request.idempotencyKey());
        requireScopes(actor.tenantId(), shopId, RETURN_WRITE_SCOPES);
        ReturnDecisionResult result = connector.decideShopifyReturn(
                actor.tenantId(), shopId, request);
        if (result == null || !request.externalReturnRef().equals(result.externalReturnRef())
                || blank(result.status()) || result.updatedAt() == null) {
            throw unavailable("Shopify return decision is unavailable");
        }
        audit(actor, SHOPIFY_RETURN_DECIDED, "shopify_return",
                result.externalReturnRef(), Map.of(
                        "decision", request.decision().name(),
                        "status", result.status(),
                        "recovered", Boolean.toString(result.recoveredFromShopify())));
        return result;
    }

    public ReturnRefundPreview previewRefund(
            UUID tenantId,
            UUID shopId,
            ReturnRefundPreviewRequest request) {
        requireIdentity(tenantId, shopId);
        validateRefundSelection(request == null ? null : request.externalReturnRef(),
                request == null ? null : request.lineItems());
        requireScopes(tenantId, shopId, RETURN_WRITE_SCOPES);
        ReturnRefundPreview preview = connector.previewShopifyReturnRefund(
                tenantId, shopId, request);
        if (preview == null
                || !request.externalReturnRef().equals(preview.externalReturnRef())
                || preview.state() == null || preview.refundAmount() == null
                || preview.maximumRefundable() == null || preview.fetchedAt() == null) {
            throw unavailable("Shopify refund preview is unavailable");
        }
        return preview;
    }

    public ReturnRefundProcessResult processRefund(
            OrderActor actor,
            UUID shopId,
            ReturnRefundProcessRequest request) {
        requireActor(actor);
        requireIdentity(actor.tenantId(), shopId);
        validateRefundSelection(request == null ? null : request.externalReturnRef(),
                request == null ? null : request.lineItems());
        if (blank(request.previewToken()) || request.previewToken().length() > 4096) {
            throw new IllegalArgumentException("Refund preview token is invalid");
        }
        requireKey(request.idempotencyKey());
        requireScopes(actor.tenantId(), shopId, RETURN_WRITE_SCOPES);
        ReturnRefundProcessResult result = connector.processShopifyReturnRefund(
                actor.tenantId(), shopId, request);
        if (result == null
                || !request.externalReturnRef().equals(result.externalReturnRef())
                || blank(result.returnStatus()) || result.outcome() == null
                || result.refundAmount() == null
                || result.updatedAt() == null) {
            throw unavailable("Shopify refund result is unavailable");
        }
        audit(actor, SHOPIFY_RETURN_REFUND_PROCESSED, "shopify_return",
                result.externalReturnRef(), Map.of(
                        "outcome", result.outcome().name(),
                        "returnStatus", result.returnStatus(),
                        "recovered", Boolean.toString(result.recoveredFromShopify())));
        return result;
    }

    public DisputeCatalogPage disputes(
            UUID tenantId,
            UUID shopId,
            int limit,
            String cursor) {
        requireIdentity(tenantId, shopId);
        requirePage(limit, cursor, null);
        requireScopes(tenantId, shopId, DISPUTE_READ_SCOPES);
        DisputeCatalogPage page = connector.fetchShopifyDisputes(
                tenantId, shopId,
                new DisputeCatalogRequest(limit, bounded(cursor, 4096, "cursor")));
        if (page == null || page.connectionStatus() != ConnectionStatus.CONNECTED
                || page.disputes() == null || page.disputes().size() > limit
                || (page.hasNextPage() && blank(page.cursor()))) {
            throw unavailable("Shopify dispute catalog is unavailable");
        }
        return page;
    }

    private void requireScopes(UUID tenantId, UUID shopId, List<String> required) {
        var snapshot = connector.snapshot(tenantId, shopId);
        if (snapshot == null || snapshot.shopify().status() != ConnectionStatus.CONNECTED) {
            throw ShopifyAuthorizationConflictException.notConnected();
        }
        for (String scope : required) {
            var coverage = ChannelConnectorGateway.shopifyScopeCoverage(
                    snapshot.shopifyScopes(), scope);
            if (coverage == null) {
                throw ShopifyAuthorizationConflictException.scopeUnavailable();
            }
            if (coverage
                    == ChannelConnectorGateway.ShopifyScopeCoverageStatus.MISSING) {
                throw ShopifyAuthorizationConflictException.missingScope(scope);
            }
        }
    }

    private void audit(
            OrderActor actor,
            String action,
            String resourceType,
            String resourceId,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                action, resourceType, resourceId,
                actor.requestId(), actor.sourceIp(), details));
    }

    private static void validateRefundSelection(
            String returnRef,
            List<ChannelConnectorGateway.ReturnRefundLineSelection> lines) {
        requireGid(RETURN_GID, returnRef, "Return reference");
        if (lines == null || lines.isEmpty() || lines.size() > 100) {
            throw new IllegalArgumentException("At least one refund line is required");
        }
        var ids = new java.util.HashSet<String>();
        for (var line : lines) {
            if (line == null || line.quantity() < 1 || line.quantity() > 1_000_000) {
                throw new IllegalArgumentException("Refund quantity is invalid");
            }
            requireGid(RETURN_LINE_GID, line.externalReturnLineRef(),
                    "Return line reference");
            if (!ids.add(line.externalReturnLineRef())) {
                throw new IllegalArgumentException("Refund line is duplicated");
            }
        }
    }

    private static void requirePage(int limit, String cursor, String query) {
        if (limit < 1 || limit > 100) {
            throw new IllegalArgumentException("Page limit must be between 1 and 100");
        }
        bounded(cursor, 4096, "cursor");
        bounded(query, 500, "query");
    }

    private static void requireActor(OrderActor actor) {
        if (actor == null || actor.tenantId() == null
                || (actor.userId() == null && actor.systemAdminId() == null)) {
            throw new IllegalArgumentException("Actor is required");
        }
    }

    private static void requireIdentity(UUID tenantId, UUID shopId) {
        Objects.requireNonNull(tenantId, "Tenant is required");
        Objects.requireNonNull(shopId, "Shop is required");
    }

    private static void requireKey(String value) {
        if (value == null || !KEY.matcher(value).matches()) {
            throw new IllegalArgumentException("Idempotency key is invalid");
        }
    }

    private static void requireGid(Pattern pattern, String value, String field) {
        if (value == null || !pattern.matcher(value).matches()) {
            throw new IllegalArgumentException(field + " is invalid");
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

    private static ConflictException unavailable(String message) {
        return new ConflictException(message);
    }
}
