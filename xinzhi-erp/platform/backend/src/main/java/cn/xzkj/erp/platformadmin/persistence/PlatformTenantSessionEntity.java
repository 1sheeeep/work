package cn.xzkj.erp.platformadmin.persistence;

import cn.xzkj.erp.iam.persistence.TenantEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "platform_admin_tenant_sessions")
public class PlatformTenantSessionEntity {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "platform_session_id", nullable = false, updatable = false)
    private PlatformAdminSessionEntity platformSession;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "system_admin_id", nullable = false, updatable = false)
    private SystemAdminEntity systemAdmin;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tenant_id", nullable = false, updatable = false)
    private TenantEntity tenant;

    @Column(name = "token_hash", nullable = false, length = 64, unique = true, updatable = false)
    private String tokenHash;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected PlatformTenantSessionEntity() {
    }

    public PlatformTenantSessionEntity(
            UUID id,
            PlatformAdminSessionEntity platformSession,
            SystemAdminEntity systemAdmin,
            TenantEntity tenant,
            String tokenHash,
            Instant expiresAt,
            Instant createdAt) {
        this.id = id;
        this.platformSession = platformSession;
        this.systemAdmin = systemAdmin;
        this.tenant = tenant;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
        this.createdAt = createdAt;
    }

    public UUID getId() {
        return id;
    }

    public PlatformAdminSessionEntity getPlatformSession() {
        return platformSession;
    }

    public SystemAdminEntity getSystemAdmin() {
        return systemAdmin;
    }

    public TenantEntity getTenant() {
        return tenant;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getRevokedAt() {
        return revokedAt;
    }
}
