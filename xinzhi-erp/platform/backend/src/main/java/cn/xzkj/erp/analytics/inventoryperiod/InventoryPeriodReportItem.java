package cn.xzkj.erp.analytics.inventoryperiod;

import java.util.UUID;

public record InventoryPeriodReportItem(
        UUID skuId,
        String skuBusinessCode,
        String skuName,
        UUID warehouseId,
        String warehouseBusinessCode,
        String warehouseName,
        long openingQuantity,
        long increasedQuantity,
        long decreasedQuantity,
        long closingQuantity) {}
