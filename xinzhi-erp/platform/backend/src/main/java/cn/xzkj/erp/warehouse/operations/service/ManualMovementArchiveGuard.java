package cn.xzkj.erp.warehouse.operations.service;

import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.warehouse.operations.repository.ManualMovementStore;
import cn.xzkj.erp.warehouse.service.WarehouseOperationArchiveGuard;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class ManualMovementArchiveGuard
        implements WarehouseOperationArchiveGuard {
    private final ManualMovementStore store;

    public ManualMovementArchiveGuard(ManualMovementStore store) {
        this.store = store;
    }

    @Override
    public void requireNoOpenWarehouseDocuments(
            UUID tenantId, UUID warehouseId) {
        if (store.hasOpenForWarehouse(tenantId, warehouseId)) {
            throw new ConflictException(
                    "Open manual movements block warehouse archive");
        }
    }

    @Override
    public void requireNoOpenLocationDocuments(
            UUID tenantId, UUID warehouseId, UUID locationId) {
        if (store.hasOpenForLocation(
                tenantId, warehouseId, locationId)) {
            throw new ConflictException(
                    "Open manual movements block location archive");
        }
    }
}
