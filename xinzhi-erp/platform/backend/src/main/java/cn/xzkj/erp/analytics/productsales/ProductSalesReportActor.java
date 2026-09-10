package cn.xzkj.erp.analytics.productsales;

import java.util.UUID;

public record ProductSalesReportActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId) {
}
