package cn.xzkj.erp.logistics.statistics;

import java.util.List;

public record LogisticsStatisticsView(
        String groupValue,
        long recordCount,
        List<StatusCount> statuses) {

    public record StatusCount(String status, long recordCount) {}

    public enum Dimension {
        COUNTRY,
        CHANNEL
    }
}
