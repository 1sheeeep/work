package cn.xzkj.erp.inventory.service;

public record InventoryMutationResult(
        InventoryEventView event,
        InventoryBalanceView balance,
        boolean replayed) {
}
