package cn.xzkj.erp.logistics.trackingnumber;

import java.time.Instant;
import java.util.UUID;

public record TrackingNumberRecord(
        UUID id,
        UUID importBatchId,
        String trackingType,
        String logisticsChannel,
        String trackingReference,
        String status,
        String orderReference,
        String packageNumber,
        Instant usedAt,
        long version,
        Instant createdAt) {
}
