package cn.xzkj.erp.platformadmin.security;

import java.time.Instant;
import java.util.UUID;

public record PlatformAdminPrincipal(
        UUID sessionId,
        Instant expiresAt,
        UUID id,
        String username,
        String email,
        String phoneNumber,
        String displayName) {

    public PlatformAdminPrincipal(
            UUID sessionId,
            Instant expiresAt,
            UUID id,
            String username,
            String displayName) {
        this(sessionId, expiresAt, id, username, null, null, displayName);
    }

    public PlatformAdminPrincipal(
            UUID sessionId,
            Instant expiresAt,
            UUID id,
            String username,
            String email,
            String displayName) {
        this(sessionId, expiresAt, id, username, email, null, displayName);
    }
}
