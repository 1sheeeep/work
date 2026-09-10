package cn.xzkj.erp.analytics.inventoryaging;

import java.util.List;

public record InventoryAgingReportResult(
        List<InventoryAgingReportItem> items,
        long totalQuantity,
        long age0To30Quantity,
        long age31To60Quantity,
        long age61To90Quantity,
        long age91To365Quantity,
        long ageOver365Quantity,
        long totalElements) {

    public InventoryAgingReportResult {
        items = List.copyOf(items);
    }

    public static InventoryAgingReportResult empty() {
        return new InventoryAgingReportResult(
                List.of(), 0, 0, 0, 0, 0, 0, 0);
    }
}
