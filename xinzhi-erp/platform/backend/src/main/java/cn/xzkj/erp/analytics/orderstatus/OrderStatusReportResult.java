package cn.xzkj.erp.analytics.orderstatus;

import java.util.List;

public record OrderStatusReportResult(
        List<OrderStatusReportView> items,
        long totalOrders,
        long totalDays) {

    public OrderStatusReportResult {
        items = List.copyOf(items);
    }

    public static OrderStatusReportResult empty() {
        return new OrderStatusReportResult(List.of(), 0, 0);
    }
}
