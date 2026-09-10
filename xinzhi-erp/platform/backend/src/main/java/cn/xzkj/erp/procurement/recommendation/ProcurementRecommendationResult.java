package cn.xzkj.erp.procurement.recommendation;

import java.util.List;

public record ProcurementRecommendationResult(
        List<ProcurementRecommendationItem> items,
        List<ProcurementRecommendationLocation> locations,
        long totalElements,
        long actionableCount,
        long totalRecommendedQuantity) {

    public static ProcurementRecommendationResult empty() {
        return new ProcurementRecommendationResult(
                List.of(), List.of(), 0, 0, 0);
    }
}
