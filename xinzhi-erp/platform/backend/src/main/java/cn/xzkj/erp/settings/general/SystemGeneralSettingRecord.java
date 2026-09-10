package cn.xzkj.erp.settings.general;

import java.time.Instant;
import java.time.LocalTime;

public record SystemGeneralSettingRecord(
        boolean configured,
        String defaultCurrency,
        LocalTime orderPullBlackoutStart,
        LocalTime orderPullBlackoutEnd,
        long version,
        String updatedByDisplayName,
        Instant createdAt,
        Instant updatedAt) {
}
