package cn.xzkj.erp.analytics.inventorysales;

import java.time.Instant;
import java.util.UUID;

public record InventoryRealtimeSalesItem(
        UUID balanceId,
        UUID skuId,
        String skuCode,
        String skuName,
        String variantSummary,
        UUID warehouseId,
        String warehouseCode,
        String warehouseName,
        long onHand,
        long reserved,
        long available,
        long rangeSalesQuantity,
        long rangeOrderCount,
        long todaySalesQuantity,
        long yesterdaySalesQuantity,
        long last7DaysSalesQuantity,
        long last28DaysSalesQuantity,
        long last42DaysSalesQuantity,
        Instant updatedAt) {
}
