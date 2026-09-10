package cn.xzkj.erp.settings.address;

import java.time.Instant;
import java.util.UUID;

public record AddressMappingRecord(
        UUID id,
        AddressMappingService.Platform platform,
        String countryCode,
        AddressMappingService.AddressType addressType,
        String sourceValue,
        String mappedValue,
        boolean enabled,
        long version,
        String updatedByDisplayName,
        Instant createdAt,
        Instant updatedAt) {
}
