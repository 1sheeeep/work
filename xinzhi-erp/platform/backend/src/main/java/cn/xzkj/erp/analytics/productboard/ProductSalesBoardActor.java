package cn.xzkj.erp.analytics.productboard;

import java.util.UUID;

public record ProductSalesBoardActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId) {
}
