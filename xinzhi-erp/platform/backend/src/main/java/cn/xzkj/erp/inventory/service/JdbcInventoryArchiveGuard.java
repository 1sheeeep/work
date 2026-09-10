package cn.xzkj.erp.inventory.service;

import cn.xzkj.erp.inventory.repository.InventoryStore;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class JdbcInventoryArchiveGuard implements InventoryArchiveGuard {
    private final InventoryStore store;

    public JdbcInventoryArchiveGuard(InventoryStore store) {
        this.store = store;
    }

    @Override
    @Transactional(readOnly = true)
    public void requireSkuHasZeroBalance(UUID tenantId, UUID skuId) {
        if (store.hasNonZeroBalanceForSku(
                Objects.requireNonNull(tenantId),
                Objects.requireNonNull(skuId))) {
            throw new InventoryConflictException("nonzero_inventory_balance");
        }
    }

    @Override
    @Transactional(readOnly = true)
    public void requireWarehouseHasZeroBalance(
            UUID tenantId, UUID warehouseId) {
        if (store.hasNonZeroBalanceForWarehouse(
                Objects.requireNonNull(tenantId),
                Objects.requireNonNull(warehouseId))) {
            throw new InventoryConflictException("nonzero_inventory_balance");
        }
    }
}
