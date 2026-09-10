package cn.xzkj.erp.logistics.address;

import java.time.Instant;
import java.util.UUID;

public record LogisticsAddressRecord(
        UUID id,
        String addressType,
        String name,
        String contactName,
        String contactEmail,
        String countryCode,
        String province,
        String city,
        String district,
        String addressLine1,
        String postalCode,
        String landline,
        String mobile,
        String companyName,
        String fax,
        String status,
        long version,
        Instant createdAt,
        Instant updatedAt) {
}
