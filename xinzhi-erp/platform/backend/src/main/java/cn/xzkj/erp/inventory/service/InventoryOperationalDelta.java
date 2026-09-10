package cn.xzkj.erp.inventory.service;

import java.util.UUID;

public record InventoryOperationalDelta(
        UUID sourceLineId,
        UUID skuId,
        UUID warehouseId,
        long signedDelta) {
}
