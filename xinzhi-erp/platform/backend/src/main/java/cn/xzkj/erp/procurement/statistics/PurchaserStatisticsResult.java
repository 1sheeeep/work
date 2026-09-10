package cn.xzkj.erp.procurement.statistics;

import java.util.List;

public record PurchaserStatisticsResult(
        List<PurchaserStatisticsView> items,
        long totalOrders,
        long totalOrderedQuantity,
        long totalReceivedQuantity,
        long totalOutstandingQuantity,
        long totalGroups) {

    public PurchaserStatisticsResult {
        items = List.copyOf(items);
    }

    public static PurchaserStatisticsResult empty() {
        return new PurchaserStatisticsResult(List.of(), 0, 0, 0, 0, 0);
    }
}
