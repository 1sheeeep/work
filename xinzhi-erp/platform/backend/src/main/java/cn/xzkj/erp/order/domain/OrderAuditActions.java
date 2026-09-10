package cn.xzkj.erp.order.domain;

public final class OrderAuditActions {
    public static final String CREATED = "order.created";
    public static final String STATUS_CHANGED = "order.status_changed";
    public static final String LINE_SKU_MATCHED = "order.line.sku_matched";
    public static final String LINE_SKU_UNMATCHED = "order.line.sku_unmatched";
    public static final String PROFILE_UPDATED = "order.profile.updated";
    public static final String PROTECTED_CUSTOMER_DATA_READ =
            "order.protected_customer_data.read";
    public static final String SHOPIFY_SHIPPING_ADDRESS_UPDATED =
            "order.shopify.shipping_address.updated";
    public static final String SHOPIFY_LINE_QUANTITY_UPDATED =
            "order.shopify.line_quantity.updated";
    public static final String SHOPIFY_VARIANT_ADDED =
            "order.shopify.variant.added";
    public static final String SHOPIFY_CUSTOM_ITEM_ADDED =
            "order.shopify.custom_item.added";
    public static final String SHOPIFY_LINE_DISCOUNT_ADDED =
            "order.shopify.line_discount.added";
    public static final String SHOPIFY_ORDER_CANCELLED =
            "order.shopify.cancelled";
    public static final String SHOPIFY_RETURN_DECIDED =
            "order.shopify.return.decided";
    public static final String SHOPIFY_RETURN_REFUND_PROCESSED =
            "order.shopify.return.refund_processed";
    private OrderAuditActions() { }
}
