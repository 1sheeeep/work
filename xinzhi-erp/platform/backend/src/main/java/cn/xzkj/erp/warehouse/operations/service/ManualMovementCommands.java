package cn.xzkj.erp.warehouse.operations.service;

import cn.xzkj.erp.warehouse.operations.domain.ManualMovementDirection;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementEntryMode;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementReasonCode;
import cn.xzkj.erp.warehouse.operations.domain.ManualMovementSource;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class ManualMovementCommands {
    private ManualMovementCommands() {
    }

    public record LineInput(
            UUID skuId,
            UUID locationId,
            long quantity,
            BigDecimal unitPrice,
            String currency,
            Map<String, String> extensionAttributes,
            String note) {
    }

    public record BoxItemInput(
            UUID skuId,
            long quantityPerBox) {
    }

    public record BoxInput(
            UUID sourceBoxStockId,
            String customBoxNo,
            long boxCount,
            String boxNumberRule,
            BigDecimal lengthCm,
            BigDecimal widthCm,
            BigDecimal heightCm,
            BigDecimal grossWeightKg,
            List<BoxItemInput> items) {
    }

    public record Save(
            UUID warehouseId,
            ManualMovementDirection direction,
            UUID movementTypeId,
            ManualMovementReasonCode reasonCode,
            ManualMovementSource source,
            ManualMovementEntryMode entryMode,
            String note,
            String sourceReference,
            String contactName,
            String contactPhone,
            String contactAddress,
            Map<String, String> extensionAttributes,
            List<LineInput> lines,
            List<BoxInput> boxes,
            long expectedVersion,
            UUID commandId) {
    }

    public record Transition(
            long expectedVersion,
            UUID commandId) {
    }

    public record Review(
            long expectedVersion,
            UUID commandId,
            boolean approved,
            String note) {
    }

    public record BatchItem(
            UUID movementId,
            long expectedVersion) {
    }

    public record Batch(
            List<BatchItem> items,
            UUID commandId,
            String note) {
    }
}
