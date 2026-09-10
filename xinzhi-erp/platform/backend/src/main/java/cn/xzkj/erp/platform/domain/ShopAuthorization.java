package cn.xzkj.erp.platform.domain;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

@Entity
@Table(name = "shop_authorizations")
public class ShopAuthorization extends TenantOwnedEntity {

    @Column(name = "shop_id", nullable = false, updatable = false)
    private UUID shopId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private AuthorizationStatus status;

    @Column(name = "credential_reference", length = 512)
    private String credentialReference;

    @Column(name = "provider_account_ref", length = 160)
    private String providerAccountRef;

    @Column(name = "scope_summary", length = 1000)
    private String scopeSummary;

    @Column(name = "authorized_at")
    private Instant authorizedAt;

    @Column(name = "expires_at")
    private Instant expiresAt;

    @Column(name = "last_verified_at")
    private Instant lastVerifiedAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "error_summary", length = 1000)
    private String errorSummary;

    protected ShopAuthorization() {
    }

    public ShopAuthorization(UUID tenantId, UUID shopId) {
        this(tenantId, shopId, AuthorizationStatus.NOT_AUTHORIZED);
    }

    public ShopAuthorization(
            UUID tenantId,
            UUID shopId,
            AuthorizationStatus initialStatus) {
        super(tenantId);
        this.shopId = shopId;
        if (initialStatus != AuthorizationStatus.NOT_AUTHORIZED
                && initialStatus != AuthorizationStatus.NOT_REQUIRED) {
            throw new IllegalArgumentException(
                    "Initial authorization status is invalid");
        }
        this.status = initialStatus;
    }

    public void update(
            AuthorizationStatus status,
            String credentialReference,
            String providerAccountRef,
            String scopeSummary,
            Instant authorizedAt,
            Instant expiresAt,
            Instant lastVerifiedAt,
            String errorSummary
    ) {
        this.status = status;
        this.credentialReference = credentialReference;
        this.providerAccountRef = providerAccountRef;
        this.scopeSummary = scopeSummary;
        this.authorizedAt = authorizedAt;
        this.expiresAt = expiresAt;
        this.lastVerifiedAt = lastVerifiedAt;
        this.errorSummary = errorSummary;
        if (status == AuthorizationStatus.REVOKED) {
            revokedAt = Instant.now();
            this.credentialReference = null;
        } else {
            revokedAt = null;
        }
        if (status == AuthorizationStatus.NOT_AUTHORIZED
                || status == AuthorizationStatus.NOT_REQUIRED) {
            this.credentialReference = null;
            this.authorizedAt = null;
            this.expiresAt = null;
        }
    }

    public UUID getShopId() {
        return shopId;
    }

    public AuthorizationStatus getStatus() {
        return status;
    }

    public String getCredentialReference() {
        return credentialReference;
    }

    public String getProviderAccountRef() {
        return providerAccountRef;
    }

    public String getScopeSummary() {
        return scopeSummary;
    }

    public Instant getAuthorizedAt() {
        return authorizedAt;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getLastVerifiedAt() {
        return lastVerifiedAt;
    }

    public Instant getRevokedAt() {
        return revokedAt;
    }

    public String getErrorSummary() {
        return errorSummary;
    }
}
