package cn.xzkj.erp.iam.warehousescope;

import java.util.Set;
import java.util.UUID;

public record WarehouseScopeAccess(
        WarehouseScopeMode mode,
        Set<UUID> warehouseIds) {

    public WarehouseScopeAccess {
        warehouseIds = Set.copyOf(warehouseIds);
        if (mode == WarehouseScopeMode.ALL && !warehouseIds.isEmpty()) {
            throw new IllegalArgumentException("ALL scope cannot contain warehouse IDs");
        }
    }

    public boolean allowsAll() {
        return mode == WarehouseScopeMode.ALL;
    }

    public boolean allows(UUID warehouseId) {
        return allowsAll() || warehouseIds.contains(warehouseId);
    }
}
