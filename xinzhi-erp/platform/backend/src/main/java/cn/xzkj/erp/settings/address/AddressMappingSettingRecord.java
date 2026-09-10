package cn.xzkj.erp.settings.address;

import java.time.Instant;

public record AddressMappingSettingRecord(
        boolean configured,
        boolean enabled,
        long version,
        String updatedByDisplayName,
        Instant createdAt,
        Instant updatedAt) {
}
