package cn.xzkj.erp.analytics.productsales;

import java.time.Instant;
import java.util.UUID;

public record ProductSalesReportItem(
        UUID skuId,
        String skuCode,
        String skuName,
        String variantSummary,
        long orderCount,
        long salesQuantity,
        Instant firstPlacedAt,
        Instant lastPlacedAt) {
}
