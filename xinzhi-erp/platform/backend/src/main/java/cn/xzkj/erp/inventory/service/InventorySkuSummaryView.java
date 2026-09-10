package cn.xzkj.erp.inventory.service;

import java.util.UUID;

public record InventorySkuSummaryView(
        UUID skuId,
        long onHand,
        long reserved) {

    public InventorySkuSummaryView {
        if (skuId == null) {
            throw new IllegalArgumentException("SKU identity is required");
        }
        Math.subtractExact(onHand, reserved);
    }

    public long available() {
        return Math.subtractExact(onHand, reserved);
    }
}
