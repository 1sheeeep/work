package cn.xzkj.erp.fulfillment.weighing;

import java.time.Instant;
import java.util.UUID;

public final class ShippingConfigurationRecords {
    public record PackagingTemplate(
            UUID id,
            String businessCode,
            String name,
            String packagingType,
            int standardWeightGrams,
            Integer lengthMm,
            Integer widthMm,
            Integer heightMm,
            String status,
            long version,
            Instant updatedAt) {
    }

    public record PackagingRule(
            UUID id,
            UUID skuId,
            int minQuantity,
            int maxQuantity,
            UUID packagingTemplateId,
            String packagingCode,
            String packagingName,
            String status,
            long version,
            Instant updatedAt) {
    }

    public record ShippingScale(
            UUID id,
            UUID warehouseId,
            String deviceNumber,
            String displayName,
            String status,
            long version,
            Instant updatedAt) {
    }

    public record WarehousePackaging(
            PackagingTemplate template,
            boolean enabled) {
    }

    public record WeightTolerance(
            int toleranceGrams,
            int toleranceBasisPoints,
            boolean warehouseOverride) {
    }

    private ShippingConfigurationRecords() {
    }
}
