package cn.xzkj.erp.procurement.service;

import cn.xzkj.erp.procurement.domain.ProcurementPurchaseOrderStatus;
import java.time.Instant;
import java.util.UUID;

public record ProcurementPurchaseOrderView(
        UUID id,
        String purchaseNo,
        ProcurementPurchaseOrderStatus status,
        UUID planId,
        String planNo,
        UUID supplierId,
        String supplierCode,
        String supplierName,
        String supplierSkuCode,
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
        long receivedQuantity,
        String orderNote,
        String orderedByDisplayName,
        String reviewDecision,
        String reviewNote,
        String reviewedByDisplayName,
        Instant reviewedAt,
        long version,
        Instant lastReceivedAt,
        Instant createdAt,
        Instant updatedAt) {
}
