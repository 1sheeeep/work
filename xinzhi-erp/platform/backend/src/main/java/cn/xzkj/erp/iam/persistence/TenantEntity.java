package cn.xzkj.erp.iam.persistence;

import cn.xzkj.erp.iam.domain.TenantStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "tenants")
public class TenantEntity {

    @Id
    private UUID id;

    @Column(nullable = false, length = 64, unique = true)
    private String code;

    @Column(nullable = false, length = 160)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private TenantStatus status;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    @Column(name = "one_tenant_id", unique = true)
    private UUID oneTenantId;

    @Version
    @Column(nullable = false)
    private long version;

    protected TenantEntity() {
    }

    public TenantEntity(
            UUID id,
            String code,
            String name,
            TenantStatus status) {
        this(id, code, name, status, Instant.now());
    }

    public TenantEntity(
            UUID id,
            String code,
            String name,
            TenantStatus status,
            Instant now) {
        this.id = id;
        this.code = code;
        this.name = name;
        this.status = status;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void update(String name, TenantStatus status, Instant now) {
        this.name = name;
        this.status = status;
        this.updatedAt = now;
    }

    public void linkOneTenant(UUID subjectId, String name, Instant now) {
        if (oneTenantId != null && !oneTenantId.equals(subjectId)) {
            throw new IllegalStateException("Tenant is linked to another One subject");
        }
        oneTenantId = subjectId;
        this.name = name;
        updatedAt = now;
    }

    public void softDelete(Instant now) {
        this.status = TenantStatus.DISABLED;
        this.deletedAt = now;
        this.updatedAt = now;
    }

    public boolean isDeleted() {
        return deletedAt != null;
    }

    public Instant getDeletedAt() {
        return deletedAt;
    }

    public UUID getOneTenantId() {
        return oneTenantId;
    }

    public UUID getId() {
        return id;
    }

    public String getCode() {
        return code;
    }

    public String getName() {
        return name;
    }

    public TenantStatus getStatus() {
        return status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public long getVersion() {
        return version;
    }
}
