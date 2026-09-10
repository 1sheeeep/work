package cn.xzkj.erp.iam.entry;

import cn.xzkj.erp.iam.persistence.AuthSessionEntity;
import cn.xzkj.erp.platformadmin.persistence.PlatformTenantSessionEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "first_party_application_entry_grants")
public class FirstPartyApplicationEntryGrantEntity {

    @Id
    private UUID id;

    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    @Column(name = "subject_id", nullable = false, updatable = false)
    private UUID subjectId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "auth_session_id", updatable = false)
    private AuthSessionEntity authSession;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "platform_tenant_session_id", updatable = false)
    private PlatformTenantSessionEntity platformTenantSession;

    @Column(name = "token_hash", nullable = false, length = 64, unique = true, updatable = false)
    private String tokenHash;

    @Enumerated(EnumType.STRING)
    @Column(name = "target_application", nullable = false, length = 32, updatable = false)
    private FirstPartyApplication targetApplication;

    @Column(name = "target_origin", nullable = false, length = 512, updatable = false)
    private String targetOrigin;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    @Column(name = "consumed_at")
    private Instant consumedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected FirstPartyApplicationEntryGrantEntity() {
    }

    public FirstPartyApplicationEntryGrantEntity(
            UUID id,
            UUID tenantId,
            UUID subjectId,
            AuthSessionEntity authSession,
            String tokenHash,
            FirstPartyApplication targetApplication,
            String targetOrigin,
            Instant expiresAt,
            Instant createdAt) {
        this.id = id;
        this.tenantId = tenantId;
        this.subjectId = subjectId;
        this.authSession = authSession;
        this.tokenHash = tokenHash;
        this.targetApplication = targetApplication;
        this.targetOrigin = targetOrigin;
        this.expiresAt = expiresAt;
        this.createdAt = createdAt;
    }

    public FirstPartyApplicationEntryGrantEntity(
            UUID id,
            UUID tenantId,
            UUID subjectId,
            PlatformTenantSessionEntity platformTenantSession,
            String tokenHash,
            FirstPartyApplication targetApplication,
            String targetOrigin,
            Instant expiresAt,
            Instant createdAt) {
        this.id = id;
        this.tenantId = tenantId;
        this.subjectId = subjectId;
        this.platformTenantSession = platformTenantSession;
        this.tokenHash = tokenHash;
        this.targetApplication = targetApplication;
        this.targetOrigin = targetOrigin;
        this.expiresAt = expiresAt;
        this.createdAt = createdAt;
    }

    public void consume(Instant now) {
        consumedAt = now;
    }

    public UUID getId() { return id; }
    public UUID getTenantId() { return tenantId; }
    public UUID getSubjectId() { return subjectId; }
    public AuthSessionEntity getAuthSession() { return authSession; }
    public PlatformTenantSessionEntity getPlatformTenantSession() { return platformTenantSession; }
    public FirstPartyApplication getTargetApplication() { return targetApplication; }
    public String getTargetOrigin() { return targetOrigin; }
    public Instant getExpiresAt() { return expiresAt; }
    public Instant getConsumedAt() { return consumedAt; }
}
