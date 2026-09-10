package cn.xzkj.erp.analytics.inventoryaging;

import java.time.LocalDate;
import java.util.UUID;

public record InventoryAgingReportItem(
        UUID skuId,
        String skuBusinessCode,
        String skuName,
        UUID warehouseId,
        String warehouseBusinessCode,
        String warehouseName,
        LocalDate oldestInventoryDate,
        int maximumAgeDays,
        long totalQuantity,
        long age0To30Quantity,
        long age31To60Quantity,
        long age61To90Quantity,
        long age91To365Quantity,
        long ageOver365Quantity) {
}
