package cn.xzkj.erp.logistics.statistics;

import java.util.List;

public record LogisticsStatisticsResult(
        List<LogisticsStatisticsView> items,
        List<LogisticsStatisticsView.StatusCount> totalStatuses,
        long totalRecords,
        long totalGroups) {

    public LogisticsStatisticsResult {
        items = List.copyOf(items);
        totalStatuses = List.copyOf(totalStatuses);
    }

    public static LogisticsStatisticsResult empty() {
        return new LogisticsStatisticsResult(List.of(), List.of(), 0, 0);
    }
}
