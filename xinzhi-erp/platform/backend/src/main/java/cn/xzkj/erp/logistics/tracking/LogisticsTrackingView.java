package cn.xzkj.erp.logistics.tracking;

import java.time.Instant;
import java.util.UUID;

public record LogisticsTrackingView(
        UUID orderId,
        String platformCode,
        String platformName,
        String shopName,
        String orderNo,
        String countryCode,
        String warehouseSummary,
        String logisticsChannel,
        String trackingReference,
        String secondaryTrackingReference,
        String trackingStatus,
        String fixedCategory,
        String customCategory,
        Instant shippedAt,
        Instant updatedAt) {

    public enum SearchField {
        ORDER_NO,
        TRACKING_NO
    }

    public enum PackageStatus {
        PENDING,
        NOT_FOUND,
        IN_TRANSIT,
        AVAILABLE_FOR_PICKUP,
        DELIVERY_FAILED,
        EXCEPTION,
        DELIVERED,
        TIMED_OUT,
        RETURNED,
        OUT_FOR_DELIVERY
    }
}
