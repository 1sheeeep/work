package cn.xzkj.erp.analytics.productsales;

import java.util.List;

public record ProductSalesReportResult(
        List<ProductSalesReportItem> items,
        long totalSkuCount,
        long totalSalesQuantity) {
    public ProductSalesReportResult {
        items = List.copyOf(items);
    }

    public static ProductSalesReportResult empty() {
        return new ProductSalesReportResult(List.of(), 0, 0);
    }
}
