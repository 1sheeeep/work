package cn.xzkj.erp.procurement.service;

import java.util.UUID;

public final class ProcurementReferenceViews {
    private ProcurementReferenceViews() {
    }

    public record SkuOption(
            UUID id,
            String businessCode,
            String name,
            String variantSummary) {
    }

    public record WarehouseOption(
            UUID id,
            String businessCode,
            String name) {
    }

    public record LocationOption(
            UUID id,
            UUID warehouseId,
            String businessCode,
            String name) {
    }
}
