package cn.xzkj.erp.analytics.orderstatus;

import cn.xzkj.erp.order.domain.OrderStatus;
import java.time.LocalDate;
import java.util.List;

public record OrderStatusReportView(
        LocalDate reportDate,
        long orderCount,
        List<StatusCount> statuses) {

    public record StatusCount(OrderStatus status, long orderCount) {}
}
