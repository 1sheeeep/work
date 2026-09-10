package cn.xzkj.erp.procurement.recommendation;

import java.util.UUID;

public record ProcurementRecommendationItem(
        UUID skuId,
        String skuCode,
        String skuName,
        String skuVariant,
        UUID warehouseId,
        String warehouseCode,
        String warehouseName,
        long onHand,
        long reserved,
        long available,
        long last28DaysSalesQuantity,
        long openPurchaseQuantity,
        UUID supplierId,
        String supplierCode,
        String supplierName,
        String supplierSkuCode,
        Integer supplierLeadTimeDays,
        int planningLeadTimeDays,
        int safetyDays,
        int targetCoverageDays,
        long targetStockQuantity,
        long recommendedQuantity,
        int activeLocationCount) {
}
