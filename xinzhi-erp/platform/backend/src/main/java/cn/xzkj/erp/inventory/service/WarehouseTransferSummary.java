package cn.xzkj.erp.inventory.service;

import cn.xzkj.erp.inventory.domain.WarehouseTransferAllocationMethod;
import cn.xzkj.erp.inventory.domain.WarehouseTransferStatus;
import cn.xzkj.erp.inventory.domain.WarehouseTransferTransportMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record WarehouseTransferSummary(
        UUID id,
        String transferNo,
        WarehouseTransferStatus status,
        LocalDate transferDate,
        UUID sourceWarehouseId,
        String sourceWarehouseCode,
        String sourceWarehouseName,
        UUID targetWarehouseId,
        String targetWarehouseCode,
        String targetWarehouseName,
        WarehouseTransferTransportMode transportMode,
        Long freightAmountMinor,
        String currencyCode,
        String logisticsChannel,
        String trackingNo,
        WarehouseTransferAllocationMethod allocationMethod,
        Instant expectedShipAt,
        Instant expectedArrivalAt,
        String note,
        int lineCount,
        long totalQuantity,
        long version,
        String operatorDisplayName,
        String approverDisplayName,
        String shipperDisplayName,
        String receiverDisplayName,
        Instant createdAt,
        Instant updatedAt) {
}
