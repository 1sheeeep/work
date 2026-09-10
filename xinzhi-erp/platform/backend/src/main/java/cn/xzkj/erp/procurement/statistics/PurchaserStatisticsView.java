package cn.xzkj.erp.procurement.statistics;

import java.time.LocalDate;

public record PurchaserStatisticsView(
        LocalDate periodStart,
        String purchaserDisplayName,
        long orderCount,
        long orderedQuantity,
        long receivedQuantity,
        long outstandingQuantity,
        long newOrderCount,
        long approvedOrderCount,
        long partiallyReceivedOrderCount,
        long receivedOrderCount) {}
