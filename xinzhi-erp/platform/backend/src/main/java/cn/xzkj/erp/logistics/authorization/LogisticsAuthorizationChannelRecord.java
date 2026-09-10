package cn.xzkj.erp.logistics.authorization;

import java.time.Instant;
import java.util.UUID;

public record LogisticsAuthorizationChannelRecord(
        UUID id,
        UUID authorizationId,
        String providerCode,
        String providerName,
        String accountLabel,
        String accountStatus,
        String channelCode,
        String channelName,
        boolean enabled,
        boolean providerAvailable,
        boolean effectiveEnabled,
        long version,
        Instant lastSyncedAt,
        Instant updatedAt) {
}
