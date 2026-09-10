package cn.xzkj.erp.inventory.service;

import cn.xzkj.erp.inventory.domain.InventoryEventType;
import java.time.Instant;
import java.util.UUID;

public record InventoryEventView(
        UUID id,
        long ledgerSequence,
        InventoryEventType eventType,
        UUID skuId,
        String skuBusinessCode,
        String skuName,
        UUID warehouseId,
        String warehouseBusinessCode,
        String warehouseName,
        long signedDelta,
        long balanceAfter,
        long balanceVersionAfter,
        String reason,
        UUID reversalOfEventId,
        String requestId,
        Instant recordedAt) {
}
