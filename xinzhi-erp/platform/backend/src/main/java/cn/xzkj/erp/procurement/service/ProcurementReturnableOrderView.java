package cn.xzkj.erp.procurement.service;

import java.util.UUID;

public record ProcurementReturnableOrderView(
        UUID purchaseOrderId,
        String purchaseNo,
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
        long receivedQuantity,
        long returnedQuantity,
        long returnableQuantity,
        long version) {
}
