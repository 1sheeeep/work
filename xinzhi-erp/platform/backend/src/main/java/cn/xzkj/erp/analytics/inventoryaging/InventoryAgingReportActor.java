package cn.xzkj.erp.analytics.inventoryaging;

import java.util.UUID;

public record InventoryAgingReportActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId) {
}
