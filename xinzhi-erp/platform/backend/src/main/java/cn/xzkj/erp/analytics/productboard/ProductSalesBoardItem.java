package cn.xzkj.erp.analytics.productboard;

import java.time.Instant;
import java.util.UUID;

public record ProductSalesBoardItem(
        UUID skuId,
        String skuCode,
        String skuName,
        String variantSummary,
        long orderCount,
        long salesQuantity,
        Instant lastPlacedAt) {
}
