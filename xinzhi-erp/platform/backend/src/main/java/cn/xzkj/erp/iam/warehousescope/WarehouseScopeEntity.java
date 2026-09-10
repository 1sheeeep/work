package cn.xzkj.erp.iam.warehousescope;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;

@Entity
@Table(name = "tenant_user_warehouse_scopes")
public class WarehouseScopeEntity {

    @EmbeddedId
    private WarehouseScopeId id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private WarehouseScopeMode mode;

    @Version
    @Column(nullable = false)
    private long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected WarehouseScopeEntity() {
    }

    public WarehouseScopeEntity(
            WarehouseScopeId id,
            WarehouseScopeMode mode,
            Instant createdAt) {
        this.id = id;
        this.mode = mode;
        this.createdAt = createdAt;
        this.updatedAt = createdAt;
    }

    public void replace(WarehouseScopeMode mode, Instant updatedAt) {
        this.mode = mode;
        this.updatedAt = updatedAt;
    }

    public WarehouseScopeId getId() {
        return id;
    }

    public WarehouseScopeMode getMode() {
        return mode;
    }

    public long getVersion() {
        return version;
    }
}
