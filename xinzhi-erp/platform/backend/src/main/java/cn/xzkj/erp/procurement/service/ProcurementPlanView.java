package cn.xzkj.erp.procurement.service;

import cn.xzkj.erp.procurement.domain.ProcurementPlanSource;
import cn.xzkj.erp.procurement.domain.ProcurementPlanStatus;
import java.time.Instant;
import java.util.UUID;

public record ProcurementPlanView(
        UUID id,
        String planNo,
        ProcurementPlanStatus status,
        ProcurementPlanSource source,
        UUID skuId,
        String skuCode,
        String skuName,
        String skuVariant,
        UUID warehouseId,
        String warehouseCode,
        String warehouseName,
        UUID locationId,
        String locationCode,
        String locationName,
        long quantity,
        String note,
        String applicantDisplayName,
        Instant createdAt,
        String voidReason,
        String voidedByDisplayName,
        Instant voidedAt,
        long version,
        Instant updatedAt) {
}
