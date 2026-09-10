package cn.xzkj.erp.inventory.domain;

public enum WarehouseTransferStatus {
    DRAFT,
    APPROVAL,
    READY_TO_SHIP,
    IN_TRANSIT,
    PARTIALLY_RECEIVED,
    RECEIVED,
    REJECTED,
    CANCELLED
}
