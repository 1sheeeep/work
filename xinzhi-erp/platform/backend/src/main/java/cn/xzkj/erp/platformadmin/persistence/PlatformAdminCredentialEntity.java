package cn.xzkj.erp.platformadmin.persistence;

import cn.xzkj.erp.platformadmin.domain.PlatformAdminCredentialPurpose;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "platform_admin_password_credentials")
public class PlatformAdminCredentialEntity {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "system_admin_id", nullable = false, updatable = false)
    private SystemAdminEntity systemAdmin;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32, updatable = false)
    private PlatformAdminCredentialPurpose purpose;

    @Column(name = "token_hash", nullable = false, length = 64, unique = true, updatable = false)
    private String tokenHash;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    @Column(name = "consumed_at")
    private Instant consumedAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "created_by_system_admin_id", updatable = false)
    private UUID createdBySystemAdminId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Version
    @Column(nullable = false)
    private long version;

    protected PlatformAdminCredentialEntity() {
    }

    public PlatformAdminCredentialEntity(
            UUID id,
            SystemAdminEntity systemAdmin,
            PlatformAdminCredentialPurpose purpose,
            String tokenHash,
            Instant expiresAt,
            UUID createdBySystemAdminId,
            Instant createdAt) {
        this.id = id;
        this.systemAdmin = systemAdmin;
        this.purpose = purpose;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
        this.createdBySystemAdminId = createdBySystemAdminId;
        this.createdAt = createdAt;
    }

    public boolean isUsableAt(Instant now) {
        return consumedAt == null && revokedAt == null && expiresAt.isAfter(now);
    }

    public void consume(Instant now) {
        this.consumedAt = now;
    }

    public UUID getId() {
        return id;
    }

    public SystemAdminEntity getSystemAdmin() {
        return systemAdmin;
    }

    public PlatformAdminCredentialPurpose getPurpose() {
        return purpose;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getConsumedAt() {
        return consumedAt;
    }

    public Instant getRevokedAt() {
        return revokedAt;
    }
}
