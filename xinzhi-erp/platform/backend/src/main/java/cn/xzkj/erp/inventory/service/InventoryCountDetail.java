package cn.xzkj.erp.inventory.service;

import java.util.List;

public record InventoryCountDetail(
        InventoryCountSummary summary,
        List<InventoryCountLineView> lines) {

    public InventoryCountDetail {
        lines = List.copyOf(lines);
    }
}
