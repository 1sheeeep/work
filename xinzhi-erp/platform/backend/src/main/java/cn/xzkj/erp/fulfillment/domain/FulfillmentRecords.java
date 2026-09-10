package cn.xzkj.erp.fulfillment.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class FulfillmentRecords {

    public enum Status {
        PENDING_ALLOCATION, ALLOCATED, PICKING, PACKING, READY_TO_SHIP,
        PARTIALLY_SHIPPED, SHIPPED, PARTIALLY_FULFILLED, CANCELLED, EXCEPTION
    }

    public enum PauseState { ACTIVE, PAUSED }
    public enum ShortageState { NONE, PARTIAL, FULL, UNKNOWN }
    public enum PackageStatus {
        DRAFT, SEALED, HANDED_OVER, HANDOVER_CORRECTED, VOIDED
    }
    public enum ShopifyPublicationStatus {
        NOT_PUBLISHED, PUBLISHING, PUBLISHED, UNCERTAIN
    }
    public enum WeighingStatus {
        PENDING, MISSING_WEIGHT, PASSED, BLOCKED, OVERRIDDEN
    }

    public record Plan(
            UUID id,
            UUID tenantId,
            UUID orderId,
            UUID shopId,
            long sourceOrderVersion,
            String externalOrderRef,
            Status status,
            PauseState pauseState,
            String pauseReasonCode,
            ShortageState shortageState,
            Status resumeStatus,
            int plannedQuantity,
            int pickedQuantity,
            int packedQuantity,
            int shippedQuantity,
            int cancelledQuantity,
            long version,
            Instant createdAt,
            Instant updatedAt,
            Instant completedAt,
            List<Line> lines,
            List<Package> packages) {
    }

    public record Line(
            UUID id,
            UUID orderLineId,
            short splitSequence,
            UUID skuId,
            UUID warehouseId,
            UUID locationId,
            int plannedQuantity,
            int pickedQuantity,
            int packedQuantity,
            int shippedQuantity,
            int cancelledQuantity,
            String externalLineRef,
            String skuBusinessCode,
            String skuName,
            String inventoryOperationRef,
            String exceptionCode) {
    }

    public record Package(
            UUID id,
            UUID warehouseId,
            String packageNumber,
            PackageStatus status,
            BigDecimal weightGrams,
            UUID packagingTemplateId,
            String packagingCode,
            String packagingName,
            Long packagingWeightGrams,
            Long expectedWeightGrams,
            Long allowedToleranceGrams,
            Long weightDifferenceGrams,
            WeighingStatus weighingStatus,
            String weighingSource,
            UUID shippingScaleId,
            Instant weighedAt,
            long version,
            Instant sealedAt,
            Instant handedOverAt,
            String carrierCode,
            String serviceCode,
            String trackingReference,
            UUID logisticsAuthorizationId,
            UUID logisticsChannelId,
            String logisticsProviderCode,
            String logisticsProviderName,
            String logisticsAccountLabel,
            String logisticsChannelName,
            String logisticsClientReference,
            String logisticsProviderOrderReference,
            String logisticsLabelUrl,
            String logisticsBookingStatus,
            String logisticsTrackingStatus,
            String logisticsTrackingSummary,
            Instant logisticsLastSyncedAt,
            String logisticsSafeErrorCode,
            boolean logisticsProviderHandoverPending,
            ShopifyPublicationStatus shopifyPublicationStatus,
            Boolean shopifyNotifyCustomer,
            String shopifyTrackingUrl,
            String externalShopifyFulfillmentRef,
            Instant shopifyPublishedAt,
            List<PackageItem> items) {
        public Package(
                UUID id, UUID warehouseId, String packageNumber,
                PackageStatus status, BigDecimal weightGrams, long version,
                Instant sealedAt, Instant handedOverAt, String carrierCode,
                String serviceCode, String trackingReference,
                ShopifyPublicationStatus shopifyPublicationStatus,
                Boolean shopifyNotifyCustomer, String shopifyTrackingUrl,
                String externalShopifyFulfillmentRef, Instant shopifyPublishedAt,
                List<PackageItem> items) {
            this(id, warehouseId, packageNumber, status, weightGrams,
                    null, null, null, null, null, null, null,
                    weightGrams == null ? WeighingStatus.PENDING : WeighingStatus.PASSED,
                    weightGrams == null ? null : "SCALE", null, null,
                    version, sealedAt, handedOverAt, carrierCode, serviceCode,
                    trackingReference, null, null, null, null, null, null,
                    null, null, null, "NOT_REQUESTED", null, null, null, null,
                    false, shopifyPublicationStatus, shopifyNotifyCustomer,
                    shopifyTrackingUrl, externalShopifyFulfillmentRef,
                    shopifyPublishedAt, items);
        }
    }

    public record PackageItem(UUID fulfillmentLineId, int quantity) {
    }

    public record EligibleOrder(
            UUID id,
            UUID shopId,
            String externalOrderRef,
            long version,
            List<EligibleLine> lines) {
    }

    public record EligibleLine(
            UUID orderLineId,
            UUID skuId,
            String externalLineRef,
            int quantity,
            String skuBusinessCode,
            String skuName) {
    }

    public record PlanSummary(
            UUID id,
            UUID orderId,
            UUID shopId,
            String externalOrderRef,
            Status status,
            PauseState pauseState,
            String pauseReasonCode,
            ShortageState shortageState,
            int plannedQuantity,
            int shippedQuantity,
            int cancelledQuantity,
            long version,
            Instant updatedAt) {
    }

    private FulfillmentRecords() {
    }
}
