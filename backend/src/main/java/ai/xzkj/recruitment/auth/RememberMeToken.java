package ai.xzkj.recruitment.auth;

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
@Table(name = "auth_remember_tokens")
class RememberMeToken {
    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private SystemUser user;

    @Column(name = "token_hash", nullable = false, length = 64)
    private String tokenHash;

    @Column(name = "previous_token_hash", length = 64)
    private String previousTokenHash;

    @Column(name = "previous_valid_until")
    private Instant previousValidUntil;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "last_used_at")
    private Instant lastUsedAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected RememberMeToken() {
    }

    RememberMeToken(SystemUser user, String tokenHash, Instant expiresAt, Instant now) {
        this.id = UUID.randomUUID();
        this.user = user;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
        this.createdAt = now;
    }

    boolean usable(Instant now) {
        return revokedAt == null && expiresAt.isAfter(now) && user.isEnabled();
    }

    boolean matches(String candidateHash, Instant now) {
        if (RememberMeService.constantTimeEquals(tokenHash, candidateHash)) return true;
        return previousTokenHash != null && previousValidUntil != null && previousValidUntil.isAfter(now)
                && RememberMeService.constantTimeEquals(previousTokenHash, candidateHash);
    }

    void rotate(String newTokenHash, Instant now) {
        previousTokenHash = tokenHash;
        previousValidUntil = now.plusSeconds(30);
        tokenHash = newTokenHash;
        lastUsedAt = now;
    }

    void revoke(Instant now) {
        revokedAt = now;
        previousTokenHash = null;
        previousValidUntil = null;
    }

    UUID getId() { return id; }
    SystemUser getUser() { return user; }
    Instant getExpiresAt() { return expiresAt; }
}
