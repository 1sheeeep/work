package cn.xzkj.erp.inventory.service;

import cn.xzkj.erp.inventory.domain.InventoryCountStatus;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record InventoryCountSummary(
        UUID id,
        String countNo,
        UUID warehouseId,
        String warehouseCode,
        String warehouseName,
        InventoryCountStatus status,
        LocalDate countDate,
        String note,
        int lineCount,
        long totalDifference,
        long version,
        String operatorDisplayName,
        String approverDisplayName,
        Instant createdAt,
        Instant updatedAt) {
}
