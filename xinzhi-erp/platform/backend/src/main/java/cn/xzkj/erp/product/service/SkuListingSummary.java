package cn.xzkj.erp.product.service;

import java.util.UUID;

public record SkuListingSummary(
        UUID skuId,
        long activeListingCount) {
}
