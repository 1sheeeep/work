package cn.xzkj.erp.warehouse.domain;

import java.util.UUID;

import cn.xzkj.erp.platform.domain.TenantOwnedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

@Entity
@Table(name = "tenant_warehouse_locations")
public class WarehouseLocation extends TenantOwnedEntity {

    @Column(name = "warehouse_id", nullable = false, updatable = false)
    private UUID warehouseId;

    @Column(name = "business_code", nullable = false, length = 64)
    private String businessCode;

    @Column(nullable = false, length = 200)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private WarehouseStatus status;

    protected WarehouseLocation() {
    }

    public WarehouseLocation(UUID tenantId, UUID warehouseId, String businessCode, String name) {
        super(tenantId);
        this.warehouseId = warehouseId;
        this.businessCode = businessCode;
        this.name = name;
        this.status = WarehouseStatus.ACTIVE;
    }

    public void update(String name, WarehouseStatus status) {
        this.name = name;
        this.status = status;
    }

    public void archive() {
        status = WarehouseStatus.ARCHIVED;
    }

    public UUID getWarehouseId() {
        return warehouseId;
    }

    public String getBusinessCode() {
        return businessCode;
    }

    public String getName() {
        return name;
    }

    public WarehouseStatus getStatus() {
        return status;
    }
}
