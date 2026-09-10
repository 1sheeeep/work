package cn.xzkj.erp.settings.deadline;

import java.time.Instant;

public record ShippingDeadlineSettingRecord(
        boolean configured,
        int deadlineDays,
        long version,
        String updatedByDisplayName,
        Instant createdAt,
        Instant updatedAt) {
}
