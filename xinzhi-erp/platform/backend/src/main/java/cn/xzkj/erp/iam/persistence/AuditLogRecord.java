package cn.xzkj.erp.iam.persistence;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record AuditLogRecord(
        UUID id,
        UUID actorUserId,
        UUID actorSystemAdminId,
        String action,
        String resourceType,
        String resourceId,
        String requestId,
        String sourceIp,
        Map<String, String> details,
        Instant createdAt) {
}
