package cn.xzkj.erp.inventory.service;

import java.util.List;

public record InventoryOperationalResult(
        List<InventoryEventView> events,
        List<InventoryBalanceView> balances) {
}
