package cn.xzkj.erp.platformadmin.audit;

import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

public record PlatformAdminAuditEvent(
        UUID actorSystemAdminId,
        UUID tenantId,
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

    public PlatformAdminAuditEvent {
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
}
