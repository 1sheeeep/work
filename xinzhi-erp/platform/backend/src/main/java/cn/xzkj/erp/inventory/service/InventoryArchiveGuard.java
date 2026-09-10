package cn.xzkj.erp.inventory.service;

import java.util.UUID;

public interface InventoryArchiveGuard {
    void requireSkuHasZeroBalance(UUID tenantId, UUID skuId);

    void requireWarehouseHasZeroBalance(UUID tenantId, UUID warehouseId);
}
