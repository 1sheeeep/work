package cn.xzkj.erp.analytics.productboard;

import java.util.List;

public record ProductSalesBoardResult(
        List<ProductSalesBoardItem> hotItems,
        List<ProductSalesBoardItem> lowItems,
        long activeSkuCount,
        long soldSkuCount,
        long salesQuantity) {
    public ProductSalesBoardResult {
        hotItems = List.copyOf(hotItems);
        lowItems = List.copyOf(lowItems);
    }

    public static ProductSalesBoardResult empty() {
        return new ProductSalesBoardResult(List.of(), List.of(), 0, 0, 0);
    }
}
