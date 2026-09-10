package cn.xzkj.erp.warehouse.operations.service;

import cn.xzkj.erp.warehouse.operations.domain.ManualMovementDirection;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementEntryMode;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementApprovalStatus;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementReasonCode;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementSource;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementStatus;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementWmsStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class ManualMovementViews {
    private ManualMovementViews() {
    }

    public record Line(
            UUID id,
            int lineNumber,
            UUID skuId,
            String skuBusinessCode,
            String skuName,
            UUID locationId,
            String locationBusinessCode,
            String locationName,
            long quantity,
            Long actualQuantity,
            BigDecimal unitPrice,
            String currency,
            BigDecimal amount,
            Map<String, String> extensionAttributes,
            String note,
            Long currentOnHand,
            Long currentAvailable) {
    }

    public record Summary(
            UUID id,
            String movementNo,
            ManualMovementDirection direction,
            ManualMovementStatus status,
            UUID warehouseId,
            String warehouseBusinessCode,
            String warehouseName,
            UUID movementTypeId,
            String movementTypeName,
            ManualMovementReasonCode reasonCode,
            ManualMovementSource source,
            ManualMovementWmsStatus wmsStatus,
            ManualMovementApprovalStatus approvalStatus,
            ManualMovementEntryMode entryMode,
            String note,
            String sourceReference,
            Map<String, String> extensionAttributes,
            int lineCount,
            long totalQuantity,
            long totalActualQuantity,
            BigDecimal totalAmount,
            String currency,
            long version,
            String createdBy,
            String reviewedBy,
            String reviewNote,
            Instant submittedAt,
            Instant postedAt,
            Instant reversedAt,
            Instant cancelledAt,
            Instant reviewedAt,
            Instant createdAt,
            Instant updatedAt) {
    }

    public record Detail(
            Summary summary,
            List<Line> lines,
            List<Box> boxes,
            ContactInformation contactInformation) {
    }

    public record ContactInformation(
            String name,
            String phone,
            String address) {
    }

    public record Mutation(
            UUID movementId,
            ManualMovementStatus status,
            long version,
            boolean replayed) {
    }

    public record TimelineEvent(
            UUID id,
            String eventType,
            ManualMovementStatus fromStatus,
            ManualMovementStatus toStatus,
            long movementVersion,
            String requestId,
            Instant recordedAt) {
    }

    public record BoxItem(
            UUID skuId,
            String skuBusinessCode,
            String skuName,
            long quantityPerBox) {
    }

    public record Box(
            UUID id,
            UUID sourceBoxStockId,
            String customBoxNo,
            long boxCount,
            String boxNumberRule,
            BigDecimal lengthCm,
            BigDecimal widthCm,
            BigDecimal heightCm,
            BigDecimal grossWeightKg,
            List<BoxItem> items) {
    }

    public record Settings(
            ManualMovementDirection direction,
            boolean approvalRequired,
            boolean unitPriceRequired,
            boolean showCostPrice,
            String costUpdatePolicy,
            boolean contactInformationRequired,
            long version) {
    }

    public record MovementType(
            UUID id,
            ManualMovementDirection direction,
            String code,
            String name,
            String status,
            long version) {
    }

    public record BoxStock(
            UUID id,
            UUID warehouseId,
            String customBoxNo,
            String boxNumberRule,
            BigDecimal lengthCm,
            BigDecimal widthCm,
            BigDecimal heightCm,
            BigDecimal grossWeightKg,
            long availableCount,
            long version,
            List<BoxItem> items) {
    }

    public record PriceSnapshot(
            UUID warehouseId,
            BigDecimal unitPrice,
            String currency,
            long version) {
    }

    public record WarehouseOption(
            UUID id,
            String businessCode,
            String name) {
    }

    public record LocationOption(
            UUID id,
            UUID warehouseId,
            String businessCode,
            String name) {
    }

    public record SkuOption(
            UUID id,
            String businessCode,
            String name,
            String variantSummary) {
    }
}
