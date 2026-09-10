package cn.xzkj.erp.logistics.shippingfee;

import java.time.Instant;
import java.util.UUID;

final class ShippingFeeRecords {
    private ShippingFeeRecords() {
    }

    record Region(
            UUID id, String name, String countryCode, String city,
            String postalCodePrefix, String note, String status,
            String createdByDisplayName, long version,
            Instant createdAt, Instant updatedAt) {
    }

    record Rule(
            UUID id, UUID regionId, String regionName, String countryCode,
            String name, long minimumWeightGrams, Long maximumWeightGrams,
            long baseFeeMinor, long perKilogramFeeMinor, long otherFeeMinor,
            String currencyCode, String note, String status,
            String createdByDisplayName, long version,
            Instant createdAt, Instant updatedAt) {
    }
}
