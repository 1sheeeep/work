package cn.xzkj.erp.analytics.inventorysales;

import java.util.List;

public record InventoryRealtimeSalesResult(
        List<InventoryRealtimeSalesItem> items,
        long totalBalanceCount,
        long totalOnHand,
        long totalReserved,
        long totalAvailable,
        long totalRangeSalesQuantity) {
    public InventoryRealtimeSalesResult {
        items = List.copyOf(items);
    }

    public static InventoryRealtimeSalesResult empty() {
        return new InventoryRealtimeSalesResult(
                List.of(), 0, 0, 0, 0, 0);
    }
}
