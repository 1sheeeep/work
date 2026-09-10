package cn.xzkj.erp.iam.security;

import java.time.Instant;
import java.util.UUID;

public record ErpPrincipal(
        UUID sessionId,
        Instant expiresAt,
        UUID tenantId,
        String tenantCode,
        String tenantName,
        UUID userId,
        String username,
        String email,
        String displayName,
        UUID systemAdminId) {

    public ErpPrincipal(
            UUID sessionId,
            Instant expiresAt,
            UUID tenantId,
            String tenantCode,
            String tenantName,
            UUID userId,
            String username,
            String displayName) {
        this(
                sessionId,
                expiresAt,
                tenantId,
                tenantCode,
                tenantName,
                userId,
                username,
                null,
                displayName,
                null);
    }

    public ErpPrincipal(
            UUID sessionId,
            Instant expiresAt,
            UUID tenantId,
            String tenantCode,
            String tenantName,
            UUID userId,
            String username,
            String displayName,
            UUID systemAdminId) {
        this(
                sessionId,
                expiresAt,
                tenantId,
                tenantCode,
                tenantName,
                userId,
                username,
                null,
                displayName,
                systemAdminId);
    }
}
