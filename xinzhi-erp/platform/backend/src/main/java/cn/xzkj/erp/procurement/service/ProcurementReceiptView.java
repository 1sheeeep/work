package cn.xzkj.erp.procurement.service;

import java.time.Instant;
import java.util.UUID;

public record ProcurementReceiptView(
        UUID id,
        UUID purchaseOrderId,
        String purchaseNo,
        String planNo,
        UUID supplierId,
        String supplierCode,
        String supplierName,
        UUID skuId,
        String skuCode,
        String skuName,
        String skuVariant,
        UUID warehouseId,
        String warehouseCode,
        String warehouseName,
        UUID locationId,
        String locationCode,
        String locationName,
        long quantity,
        UUID inventoryEventId,
        long inventoryLedgerSequence,
        long inventoryBalanceAfter,
        String receivedByDisplayName,
        Instant receivedAt) {
}
