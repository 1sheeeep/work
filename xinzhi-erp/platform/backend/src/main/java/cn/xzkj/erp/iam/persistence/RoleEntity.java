package cn.xzkj.erp.iam.persistence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "roles")
public class RoleEntity {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tenant_id", nullable = false)
    private TenantEntity tenant;

    @Column(nullable = false, length = 100)
    private String code;

    @Column(nullable = false, length = 160)
    private String name;

    @Column(length = 500)
    private String description;

    @Column(name = "system_role", nullable = false)
    private boolean systemRole;

    @Column(name = "preset_role", nullable = false)
    private boolean presetRole;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(nullable = false)
    private long version;

    protected RoleEntity() {
    }

    public RoleEntity(
            UUID id,
            TenantEntity tenant,
            String code,
            String name,
            String description,
            Instant createdAt) {
        this.id = id;
        this.tenant = tenant;
        this.code = code;
        this.name = name;
        this.description = description;
        this.systemRole = false;
        this.presetRole = false;
        this.createdAt = createdAt;
        this.updatedAt = createdAt;
    }

    public static RoleEntity systemRole(
            UUID id,
            TenantEntity tenant,
            String code,
            String name,
            String description,
            Instant createdAt) {
        RoleEntity role = new RoleEntity(
                id,
                tenant,
                code,
                name,
                description,
                createdAt);
        role.systemRole = true;
        return role;
    }

    public static RoleEntity presetRole(
            UUID id,
            TenantEntity tenant,
            String code,
            String name,
            String description,
            Instant createdAt) {
        RoleEntity role = new RoleEntity(
                id,
                tenant,
                code,
                name,
                description,
                createdAt);
        role.presetRole = true;
        return role;
    }

    public void update(String name, String description, Instant updatedAt) {
        this.name = name;
        this.description = description;
        this.updatedAt = updatedAt;
    }

    public void touch(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    public UUID getId() {
        return id;
    }

    public TenantEntity getTenant() {
        return tenant;
    }

    public String getCode() {
        return code;
    }

    public String getName() {
        return name;
    }

    public String getDescription() {
        return description;
    }

    public boolean isSystemRole() {
        return systemRole;
    }

    public boolean isPresetRole() {
        return presetRole;
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
