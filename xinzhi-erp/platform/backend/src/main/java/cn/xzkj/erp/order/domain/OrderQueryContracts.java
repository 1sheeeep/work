package cn.xzkj.erp.order.domain;

public final class OrderQueryContracts {

    public enum ListStage {
        ALL,
        UNPAID,
        REVIEW_PENDING,
        MERGE_PENDING,
        PROCESSING,
        FULFILLING,
        SHIPPED,
        DELIVERED,
        CANCELLED
    }

    public enum ConditionField {
        ORDER_NUMBER,
        SALES_RECORD_NUMBER,
        SHOPPING_CART_REFERENCE,
        CUSTOMER_ID,
        CUSTOMER_CODE,
        RECIPIENT_NAME,
        RECIPIENT_EMAIL,
        RECIPIENT_PHONE,
        POSTAL_CODE,
        PROVINCE,
        CITY,
        TRACKING_REFERENCE,
        PLATFORM_STATUS,
        PLATFORM_SKU,
        INVENTORY_SKU,
        PRODUCT_NAME,
        SUPPLIER_REFERENCE,
        ORDER_REMARK,
        EXTENDED_ATTRIBUTE
    }

    public enum ConditionOperator {
        EQUALS,
        NOT_EQUALS,
        CONTAINS,
        NOT_CONTAINS,
        IS_EMPTY,
        IS_NOT_EMPTY
    }

    public enum ConditionLogic { AND, OR }

    public enum TimeField {
        PLACED,
        PAID,
        SHIPPED,
        PRINTED,
        CREATED,
        PLATFORM_RETURNED,
        EXCEPTION_REVIEWED,
        CANCELLED,
        HANDED_OVER,
        PLATFORM_SPECIFIED_HANDOVER,
        PLATFORM_LABEL_REQUESTED,
        DELIVERY_DEADLINE,
        DELIVERED
    }

    public enum SortField {
        PLACED_AT,
        PAID_AT,
        CREATED_AT,
        UPDATED_AT,
        SHIP_BY_AT,
        TOTAL_AMOUNT,
        EXTERNAL_ORDER_REF
    }

    public enum SortDirection { ASC, DESC }

    private OrderQueryContracts() {
    }
}
