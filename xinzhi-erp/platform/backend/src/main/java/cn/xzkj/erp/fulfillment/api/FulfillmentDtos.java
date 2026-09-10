package cn.xzkj.erp.fulfillment.api;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Line;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Package;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PackageItem;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PackageStatus;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PauseState;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Plan;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.PlanSummary;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.ShortageState;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.ShopifyPublicationStatus;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.Status;
import cn.xzkj.erp.fulfillment.domain.FulfillmentRecords.WeighingStatus;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class FulfillmentDtos {

    public record CreatePlanRequest(
            @NotNull UUID orderId,
            @NotBlank @Pattern(regexp = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")
            String idempotencyKey) {
    }

    public record AllocationRequest(
            @NotNull UUID orderLineId,
            @Min(1) int quantity,
            @NotNull UUID warehouseId,
            UUID locationId) {
    }

    public record AllocateRequest(
            @Min(0) long version,
            @NotNull UUID commandId,
            @NotEmpty @Size(max = 400) List<@Valid AllocationRequest> assignments) {
    }

    public record QuantityRequest(@NotNull UUID lineId, @Min(0) int quantity) {
    }

    public record PickRequest(
            @Min(0) long version,
            @NotNull UUID commandId,
            @NotEmpty @Size(max = 400) List<@Valid QuantityRequest> quantities) {
    }

    public record PackageItemRequest(
            @NotNull UUID fulfillmentLineId,
            @Min(1) int quantity) {
    }

    public record CreatePackageRequest(
            @Min(0) long version,
            @NotNull UUID commandId,
            @NotNull UUID warehouseId,
            @NotBlank @Size(max = 80) String packageNumber,
            @NotEmpty @Size(max = 400) List<@Valid PackageItemRequest> items) {
    }

    public record SealPackageRequest(
            @Min(0) long version,
            @Min(0) long packageVersion,
            @NotNull UUID commandId) {
    }

    public record HandoverPackageRequest(
            @Min(0) long version,
            @Min(0) long packageVersion,
            @NotNull UUID commandId,
            @NotNull Instant occurredAt,
            @NotBlank @Pattern(regexp = "^[A-Za-z][A-Za-z0-9_]{0,63}$") String carrierCode,
            @Pattern(regexp = "^[A-Za-z][A-Za-z0-9_]{0,63}$") String serviceCode,
            @Size(max = 160) String trackingReference) {
    }

    public record BookLogisticsShipmentRequest(
            @Min(0) long packageVersion,
            @NotNull UUID authorizationId,
            @NotNull UUID channelId,
            @NotBlank
            @Pattern(regexp = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")
            String idempotencyKey) {
    }

    public record HandoverBookedLogisticsRequest(
            @Min(0) long version,
            @Min(0) long packageVersion,
            @NotNull UUID commandId,
            @NotNull Instant occurredAt) {
    }

    public record ShopifyFulfillmentPublishRequest(
            @NotBlank
            @Pattern(regexp = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")
            String idempotencyKey,
            boolean notifyCustomer,
            @Size(max = 2048) String trackingUrl) {
    }

    public record CorrectHandoverRequest(
            @Min(0) long version,
            @Min(0) long packageVersion,
            @NotNull UUID commandId,
            @NotNull Instant occurredAt,
            @NotBlank
            @Pattern(regexp = "^[A-Za-z][A-Za-z0-9_]{0,63}$")
            String reasonCode) {
    }

    public record VersionedCommandRequest(
            @Min(0) long version,
            @NotNull UUID commandId) {
    }

    public record ReasonedCommandRequest(
            @Min(0) long version,
            @NotNull UUID commandId,
            @NotBlank @Pattern(regexp = "^[A-Za-z][A-Za-z0-9_]{0,63}$") String reasonCode) {
    }

    public record LineResponse(
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
        static LineResponse from(Line line) {
            return new LineResponse(
                    line.id(), line.orderLineId(), line.splitSequence(), line.skuId(),
                    line.warehouseId(), line.locationId(), line.plannedQuantity(),
                    line.pickedQuantity(), line.packedQuantity(), line.shippedQuantity(),
                    line.cancelledQuantity(), line.externalLineRef(), line.skuBusinessCode(),
                    line.skuName(), line.inventoryOperationRef(), line.exceptionCode());
        }
    }

    public record PackageItemResponse(UUID fulfillmentLineId, int quantity) {
        static PackageItemResponse from(PackageItem item) {
            return new PackageItemResponse(item.fulfillmentLineId(), item.quantity());
        }
    }

    public record PackageResponse(
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
            List<PackageItemResponse> items) {
        static PackageResponse from(Package item) {
            return new PackageResponse(
                    item.id(), item.warehouseId(), item.packageNumber(), item.status(),
                    item.weightGrams(), item.packagingTemplateId(), item.packagingCode(),
                    item.packagingName(), item.packagingWeightGrams(),
                    item.expectedWeightGrams(), item.allowedToleranceGrams(),
                    item.weightDifferenceGrams(), item.weighingStatus(),
                    item.weighingSource(), item.shippingScaleId(), item.weighedAt(),
                    item.version(), item.sealedAt(), item.handedOverAt(),
                    item.carrierCode(), item.serviceCode(),
                    item.trackingReference(),
                    item.logisticsAuthorizationId(), item.logisticsChannelId(),
                    item.logisticsProviderCode(), item.logisticsProviderName(),
                    item.logisticsAccountLabel(), item.logisticsChannelName(),
                    item.logisticsClientReference(),
                    item.logisticsProviderOrderReference(),
                    item.logisticsLabelUrl(), item.logisticsBookingStatus(),
                    item.logisticsTrackingStatus(), item.logisticsTrackingSummary(),
                    item.logisticsLastSyncedAt(), item.logisticsSafeErrorCode(),
                    item.logisticsProviderHandoverPending(),
                    item.shopifyPublicationStatus(),
                    item.shopifyNotifyCustomer(),
                    item.shopifyTrackingUrl(),
                    item.externalShopifyFulfillmentRef(),
                    item.shopifyPublishedAt(),
                    item.items().stream().map(PackageItemResponse::from).toList());
        }
    }

    public record PlanResponse(
            UUID id,
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
            List<LineResponse> lines,
            List<PackageResponse> packages) {
        public static PlanResponse from(Plan plan) {
            return new PlanResponse(
                    plan.id(), plan.orderId(), plan.shopId(), plan.sourceOrderVersion(),
                    plan.externalOrderRef(), plan.status(), plan.pauseState(),
                    plan.pauseReasonCode(), plan.shortageState(), plan.resumeStatus(),
                    plan.plannedQuantity(), plan.pickedQuantity(), plan.packedQuantity(),
                    plan.shippedQuantity(), plan.cancelledQuantity(), plan.version(),
                    plan.createdAt(), plan.updatedAt(), plan.completedAt(),
                    plan.lines().stream().map(LineResponse::from).toList(),
                    plan.packages().stream().map(PackageResponse::from).toList());
        }
    }

    public record ShopifyFulfillmentPublishResponse(
            PlanResponse plan,
            String externalFulfillmentRef,
            boolean recoveredFromShopify,
            Instant publishedAt,
            boolean replayed) {
    }

    public record PlanSummaryResponse(
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
        public static PlanSummaryResponse from(PlanSummary item) {
            return new PlanSummaryResponse(
                    item.id(), item.orderId(), item.shopId(), item.externalOrderRef(),
                    item.status(), item.pauseState(), item.pauseReasonCode(), item.shortageState(),
                    item.plannedQuantity(), item.shippedQuantity(), item.cancelledQuantity(),
                    item.version(), item.updatedAt());
        }
    }

    private FulfillmentDtos() {
    }
}
