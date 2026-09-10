package cn.xzkj.erp.warehouse.service;

import java.util.UUID;

public interface WarehouseOperationArchiveGuard {
    void requireNoOpenWarehouseDocuments(
            UUID tenantId, UUID warehouseId);

    void requireNoOpenLocationDocuments(
            UUID tenantId, UUID warehouseId, UUID locationId);
}
