package cn.xzkj.erp.analytics.inventoryperiod;

import java.util.UUID;

public record InventoryPeriodReportActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId) {}
