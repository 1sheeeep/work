package cn.xzkj.erp.logistics.authorization;

import java.time.Instant;
import java.util.UUID;

record LogisticsAuthorizationRecord(
        UUID id, String category, String providerCode,
        String providerName, String accountLabel,
        String integrationMode, boolean credentialConfigured,
        String credentialType, String contactName, String note, String status,
        String createdByDisplayName, long version,
        Instant createdAt, Instant updatedAt) {
}
