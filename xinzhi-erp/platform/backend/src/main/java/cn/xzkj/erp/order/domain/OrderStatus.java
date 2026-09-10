package cn.xzkj.erp.order.domain;

public enum OrderStatus {
    UNPAID,
    RECEIVED,
    REVIEW_PENDING,
    MERGE_PENDING,
    HOLD,
    READY_TO_FULFILL,
    FULFILLING,
    SHIPPED,
    DELIVERED,
    CANCELLED
}
