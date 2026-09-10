package cn.xzkj.erp.platform.service;

import java.util.Map;

public class ShopifyAuthorizationConflictException extends ConflictException {

    private final String reason;
    private final String scope;

    private ShopifyAuthorizationConflictException(
            String message,
            String reason,
            String scope) {
        super(message);
        this.reason = reason;
        this.scope = scope;
    }

    public static ShopifyAuthorizationConflictException notConnected() {
        return new ShopifyAuthorizationConflictException(
                "Shopify connection is not connected",
                "shopify_connection_not_connected",
                null);
    }

    public static ShopifyAuthorizationConflictException scopeUnavailable() {
        return new ShopifyAuthorizationConflictException(
                "Shopify scope coverage is unavailable",
                "shopify_scope_unavailable",
                null);
    }

    public static ShopifyAuthorizationConflictException missingScope(String scope) {
        return new ShopifyAuthorizationConflictException(
                "Shopify authorization is missing " + scope,
                "shopify_scope_missing",
                scope);
    }

    public static ShopifyAuthorizationConflictException protectedCustomerDataRequired() {
        return new ShopifyAuthorizationConflictException(
                "Shopify protected customer data access is required",
                "shopify_protected_customer_data_required",
                null);
    }

    public Map<String, String> details() {
        if (scope == null || scope.isBlank()) {
            return Map.of("reason", reason);
        }
        return Map.of("reason", reason, "scope", scope);
    }
}
