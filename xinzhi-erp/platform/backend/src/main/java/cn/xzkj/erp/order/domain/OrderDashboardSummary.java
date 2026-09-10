package cn.xzkj.erp.order.domain;

import java.time.Instant;

public record OrderDashboardSummary(
        long totalOrders,
        long unpaidOrders,
        long receivedOrders,
        long reviewPendingOrders,
        long mergePendingOrders,
        long holdOrders,
        long readyToFulfillOrders,
        long fulfillingOrders,
        long shippedOrders,
        long deliveredOrders,
        long cancelledOrders,
        long editableOrders,
        long unmatchedLines,
        Instant oldestUnmatchedPlacedAt) {

    public OrderDashboardSummary(
            long totalOrders,
            long receivedOrders,
            long reviewPendingOrders,
            long holdOrders,
            long readyToFulfillOrders,
            long cancelledOrders,
            long editableOrders,
            long unmatchedLines,
            Instant oldestUnmatchedPlacedAt) {
        this(
                totalOrders, 0, receivedOrders, reviewPendingOrders, 0,
                holdOrders, readyToFulfillOrders, 0, 0, 0,
                cancelledOrders, editableOrders, unmatchedLines,
                oldestUnmatchedPlacedAt);
    }
}
