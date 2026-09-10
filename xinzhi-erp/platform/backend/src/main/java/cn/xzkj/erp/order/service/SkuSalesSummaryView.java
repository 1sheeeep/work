package cn.xzkj.erp.order.service;

import java.util.UUID;

public record SkuSalesSummaryView(
        UUID skuId,
        long sales7,
        long sales28,
        long sales42) {

    public SkuSalesSummaryView {
        if (skuId == null
                || sales7 < 0
                || sales28 < sales7
                || sales42 < sales28) {
            throw new IllegalArgumentException(
                    "SKU sales summary is invalid");
        }
    }
}
