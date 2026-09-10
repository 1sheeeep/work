package cn.xzkj.erp.iam.application;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record LoginResult(
        String accessToken,
        Instant expiresAt,
        UUID tenantId,
        String tenantCode,
        String tenantName,
        UUID userId,
        String username,
        String email,
        String displayName,
        List<String> permissions) {

    public LoginResult {
        permissions = List.copyOf(permissions);
    }
}
