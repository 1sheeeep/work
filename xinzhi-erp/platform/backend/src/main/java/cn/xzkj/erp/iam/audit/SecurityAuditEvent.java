package cn.xzkj.erp.iam.audit;

import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

public record SecurityAuditEvent(
        UUID tenantId,
        UUID actorUserId,
        UUID actorSystemAdminId,
        String action,
        String resourceType,
        String resourceId,
        String requestId,
        String sourceIp,
        Map<String, String> details) {

    private static final Pattern DETAIL_KEY =
            Pattern.compile("^[a-z][a-zA-Z0-9]{0,39}$");
    private static final Pattern SENSITIVE_KEY =
            Pattern.compile(
                    "(?i).*(password|secret|token|credential|email|phone|contact).*");

    public SecurityAuditEvent {
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(action, "action");
        Objects.requireNonNull(resourceType, "resourceType");
        details = details == null ? Map.of() : Map.copyOf(details);
        if (details.size() > 20) {
            throw new IllegalArgumentException("Audit details exceed the safe entry limit");
        }
        details.forEach((key, value) -> {
            if (key == null
                    || !DETAIL_KEY.matcher(key).matches()
                    || SENSITIVE_KEY.matcher(key).matches()) {
                throw new IllegalArgumentException("Audit detail key is not permitted");
            }
            if (value == null || value.length() > 160) {
                throw new IllegalArgumentException("Audit detail value exceeds the safe limit");
            }
        });
    }

    public SecurityAuditEvent(
            UUID tenantId,
            UUID actorUserId,
            String action,
            String resourceType,
            String resourceId,
            String requestId,
            String sourceIp,
            Map<String, String> details) {
        this(
                tenantId,
                actorUserId,
                null,
                action,
                resourceType,
                resourceId,
                requestId,
                sourceIp,
                details);
    }
}
