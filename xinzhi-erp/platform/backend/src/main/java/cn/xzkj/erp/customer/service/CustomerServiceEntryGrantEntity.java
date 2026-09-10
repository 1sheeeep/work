package cn.xzkj.erp.customer.service;

import cn.xzkj.erp.iam.persistence.AuthSessionEntity;
import cn.xzkj.erp.platformadmin.persistence.PlatformTenantSessionEntity;
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
@Table(name = "customer_service_entry_grants")
public class CustomerServiceEntryGrantEntity {

    @Id
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "auth_session_id", updatable = false)
    private AuthSessionEntity authSession;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "platform_tenant_session_id", updatable = false)
    private PlatformTenantSessionEntity platformTenantSession;

    @Column(name = "token_hash", nullable = false, length = 64, unique = true, updatable = false)
    private String tokenHash;

    @Column(name = "target_origin", nullable = false, length = 512, updatable = false)
    private String targetOrigin;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    @Column(name = "consumed_at")
    private Instant consumedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected CustomerServiceEntryGrantEntity() {
    }

    public CustomerServiceEntryGrantEntity(
            UUID id,
            UUID tenantId,
            UUID userId,
            AuthSessionEntity authSession,
            String tokenHash,
            String targetOrigin,
            Instant expiresAt,
            Instant createdAt) {
        this.id = id;
        this.tenantId = tenantId;
        this.userId = userId;
        this.authSession = authSession;
        this.platformTenantSession = null;
        this.tokenHash = tokenHash;
        this.targetOrigin = targetOrigin;
        this.expiresAt = expiresAt;
        this.createdAt = createdAt;
    }

    public CustomerServiceEntryGrantEntity(
            UUID id,
            UUID tenantId,
            UUID userId,
            PlatformTenantSessionEntity platformTenantSession,
            String tokenHash,
            String targetOrigin,
            Instant expiresAt,
            Instant createdAt) {
        this.id = id;
        this.tenantId = tenantId;
        this.userId = userId;
        this.authSession = null;
        this.platformTenantSession = platformTenantSession;
        this.tokenHash = tokenHash;
        this.targetOrigin = targetOrigin;
        this.expiresAt = expiresAt;
        this.createdAt = createdAt;
    }

    public void consume(Instant now) {
        this.consumedAt = now;
    }

    public UUID getId() {
        return id;
    }

    public UUID getTenantId() {
        return tenantId;
    }

    public UUID getUserId() {
        return userId;
    }

    public AuthSessionEntity getAuthSession() {
        return authSession;
    }

    public PlatformTenantSessionEntity getPlatformTenantSession() {
        return platformTenantSession;
    }

    public String getTokenHash() {
        return tokenHash;
    }

    public String getTargetOrigin() {
        return targetOrigin;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getConsumedAt() {
        return consumedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
