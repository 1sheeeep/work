package cn.xzkj.erp.iam.persistence;

import cn.xzkj.erp.iam.domain.PasswordCredentialPurpose;
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
@Table(name = "password_credentials")
public class PasswordCredentialEntity {

    @Id
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false, updatable = false)
    private UserAccountEntity user;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32, updatable = false)
    private PasswordCredentialPurpose purpose;

    @Column(name = "token_hash", nullable = false, length = 64, unique = true, updatable = false)
    private String tokenHash;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    @Column(name = "consumed_at")
    private Instant consumedAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "created_by_user_id", updatable = false)
    private UUID createdByUserId;

    @Column(name = "created_by_system_admin_id", updatable = false)
    private UUID createdBySystemAdminId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Version
    @Column(nullable = false)
    private long version;

    protected PasswordCredentialEntity() {
    }

    public PasswordCredentialEntity(
            UUID id,
            UUID tenantId,
            UserAccountEntity user,
            PasswordCredentialPurpose purpose,
            String tokenHash,
            Instant expiresAt,
            UUID createdByUserId,
            Instant createdAt) {
        this(
                id,
                tenantId,
                user,
                purpose,
                tokenHash,
                expiresAt,
                createdByUserId,
                null,
                createdAt);
    }

    public PasswordCredentialEntity(
            UUID id,
            UUID tenantId,
            UserAccountEntity user,
            PasswordCredentialPurpose purpose,
            String tokenHash,
            Instant expiresAt,
            UUID createdByUserId,
            UUID createdBySystemAdminId,
            Instant createdAt) {
        this.id = id;
        this.tenantId = tenantId;
        this.user = user;
        this.purpose = purpose;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
        this.createdByUserId = createdByUserId;
        this.createdBySystemAdminId = createdBySystemAdminId;
        this.createdAt = createdAt;
    }

    public boolean isUsableAt(Instant now) {
        return consumedAt == null && revokedAt == null && expiresAt.isAfter(now);
    }

    public void consume(Instant now) {
        this.consumedAt = now;
    }

    public void revoke(Instant now) {
        this.revokedAt = now;
    }

    public UUID getId() {
        return id;
    }

    public UUID getTenantId() {
        return tenantId;
    }

    public UserAccountEntity getUser() {
        return user;
    }

    public PasswordCredentialPurpose getPurpose() {
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

    public Instant getCreatedAt() {
        return createdAt;
    }
}
