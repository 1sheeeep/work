package cn.xzkj.erp.iam.bootstrap;

import java.util.List;

/**
 * Explicit, reviewed bootstrap grant contract for the protected tenant
 * administrator role. The permission consistency gate requires this list to
 * match the current tenant-assignable permission catalog. New permissions are
 * never granted implicitly at runtime; this contract must be updated in code
 * and pass review first.
 */
public final class TenantAdminPermissionCodes {

    public static final List<String> EXACT_CODES = List.of(
            "platform:read",
            "platform:write",
            "shop:read",
            "shop:write",
            "shop:authorization:write",
            "shop:sync:read",
            "shop:sync:write",
            "iam:user:read",
            "iam:user:write",
            "iam:role:read",
            "iam:role:write",
            "iam:permission:read",
            "iam:permission:assign",
            "iam:audit:read",
            "iam:warehouse:scope:read",
            "iam:warehouse:scope:write",
            "products.read",
            "products.write",
            "products.listing.read",
            "products.listing.write",
            "products.master_data.read",
            "products.master_data.write",
            "products.weight.write",
            "inventory.shopify.publish",
            "inventory.read",
            "inventory.adjust",
            "inventory.manual.configure",
            "inventory.manual.write",
            "inventory.manual.approve",
            "inventory.manual.post",
            "inventory.reverse",
            "orders.read",
            "orders.write",
            "orders.shopify_edit.write",
            "customer_service.read",
            "customer_service.conversation.claim",
            "customer_service.conversation.reply",
            "customer_service.conversation.transfer",
            "customer_service.conversation.close",
            "customer_service.ticket.manage",
            "fulfillments.read",
            "fulfillments.allocate.write",
            "fulfillments.pick.write",
            "fulfillments.pack.write",
            "fulfillments.ship.write",
            "fulfillments.ship.correct.write",
            "fulfillments.weigh.override",
            "fulfillments.cancel.write",
            "fulfillments.exception.write",
            "orders.transfer.read",
            "orders.transfer.write",
            "logistics.read",
            "logistics.address.write",
            "logistics.declaration_entity.write",
            "logistics.tracking_number.write",
            "logistics.shipping_fee.write",
            "logistics.label_template.write",
            "logistics.matching_rule.write",
            "logistics.authorization.write",
            "logistics.forecast.write",
            "logistics.fee.write",
            "logistics.inquiry.write",
            "suppliers.read",
            "suppliers.write",
            "procurement.read",
            "procurement.write",
            "finance.read",
            "analytics.read",
            "warehouses.read",
            "warehouses.write",
            "warehouses.shipping_config.write",
            "settings.read",
            "settings.task.write",
            "settings.notice.write",
            "settings.enterprise.write",
            "settings.parameter.write");

    private TenantAdminPermissionCodes() {
    }
}
