package cn.xzkj.erp.analytics.inventoryperiod;

import java.util.List;

public record InventoryPeriodReportResult(
        List<InventoryPeriodReportItem> items,
        long totalOpeningQuantity,
        long totalIncreasedQuantity,
        long totalDecreasedQuantity,
        long totalClosingQuantity,
        long totalElements) {

    public InventoryPeriodReportResult {
        items = List.copyOf(items);
    }

    public static InventoryPeriodReportResult empty() {
        return new InventoryPeriodReportResult(
                List.of(), 0, 0, 0, 0, 0);
    }
}
