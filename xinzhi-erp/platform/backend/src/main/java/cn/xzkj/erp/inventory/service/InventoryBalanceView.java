package cn.xzkj.erp.inventory.service;

import java.time.Instant;
import java.util.UUID;

public record InventoryBalanceView(
        UUID id,
        UUID skuId,
        String skuBusinessCode,
        String skuName,
        UUID warehouseId,
        String warehouseBusinessCode,
        String warehouseName,
        long onHand,
        long reserved,
        long version,
        Instant updatedAt) {

    public InventoryBalanceView(
            UUID id,
            UUID skuId,
            String skuBusinessCode,
            String skuName,
            UUID warehouseId,
            String warehouseBusinessCode,
            String warehouseName,
            long onHand,
            long version,
            Instant updatedAt) {
        this(
                id, skuId, skuBusinessCode, skuName, warehouseId,
                warehouseBusinessCode, warehouseName,
                onHand, 0, version, updatedAt);
    }

    public long available() {
        return Math.subtractExact(onHand, reserved);
    }
}
