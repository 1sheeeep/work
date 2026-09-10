package cn.xzkj.erp.inventory.service;

import java.util.List;

public record WarehouseTransferDetail(
        WarehouseTransferSummary summary,
        List<WarehouseTransferLineView> lines) {
}
