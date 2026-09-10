package cn.xzkj.erp.inventory.service;

import java.util.UUID;

public record InventoryCountLineView(
        UUID id,
        UUID balanceId,
        UUID skuId,
        String skuCode,
        String skuName,
        long expectedBalanceVersion,
        long snapshotOnHand,
        long snapshotReserved,
        long snapshotAvailable,
        long countedOnHand,
        long difference,
        UUID resultEventId) {
}
