package cn.xzkj.erp.analytics.inventorysales;

import java.util.UUID;

public record InventoryRealtimeSalesActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId) {
}
