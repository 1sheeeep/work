package cn.xzkj.erp.inventory.service;

import java.util.UUID;

public record WarehouseTransferLineView(
        UUID id,
        UUID sourceBalanceId,
        UUID skuId,
        String skuCode,
        String skuName,
        long snapshotBalanceVersion,
        long snapshotOnHand,
        long snapshotReserved,
        long snapshotAvailable,
        long quantity,
        long receivedQuantity,
        long remainingQuantity,
        UUID shipmentEventId,
        UUID receiptEventId) {
}
