package cn.xzkj.erp.logistics.matchingrule;

import java.time.Instant;
import java.time.LocalTime;
import java.util.UUID;

record MatchingRuleRecord(
        UUID id, String name, int priority, String platformName,
        String shopName, String channelName, String warehouseName,
        boolean autoHandover, LocalTime noHandoverStart,
        LocalTime noHandoverEnd, String note, String status,
        String createdByDisplayName, long version,
        Instant createdAt, Instant updatedAt) {
}
