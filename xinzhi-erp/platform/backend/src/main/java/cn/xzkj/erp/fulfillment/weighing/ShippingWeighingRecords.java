package cn.xzkj.erp.fulfillment.weighing;

import java.time.Instant;
import java.util.UUID;

public final class ShippingWeighingRecords {

    public record PackageWeighing(
            UUID planId,
            UUID packageId,
            UUID warehouseId,
            String packageNumber,
            String packageStatus,
            long packageVersion,
            UUID packagingTemplateId,
            String packagingCode,
            String packagingName,
            Long packagingWeightGrams,
            Long expectedWeightGrams,
            Long actualWeightGrams,
            Long allowedToleranceGrams,
            Long weightDifferenceGrams,
            String weighingStatus,
            String weighingSource,
            UUID shippingScaleId,
            Instant weighedAt) {
    }

    public record WeighingEvent(
            UUID id,
            UUID planId,
            UUID packageId,
            UUID commandId,
            UUID scaleId,
            String source,
            Long expectedWeightGrams,
            long actualWeightGrams,
            Long allowedToleranceGrams,
            Long weightDifferenceGrams,
            String result,
            String overrideReason,
            Instant occurredAt,
            Instant recordedAt) {
    }

    private ShippingWeighingRecords() {
    }
}
