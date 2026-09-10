package cn.xzkj.erp.procurement.recommendation;

import java.util.UUID;

public record ProcurementRecommendationLocation(
        UUID id,
        UUID warehouseId,
        String businessCode,
        String name) {
}
