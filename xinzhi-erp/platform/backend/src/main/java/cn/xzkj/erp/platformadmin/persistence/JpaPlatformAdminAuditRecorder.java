package cn.xzkj.erp.platformadmin.persistence;

import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditEvent;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditRecorder;
import jakarta.persistence.EntityManager;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Component
public class JpaPlatformAdminAuditRecorder
        implements PlatformAdminAuditRecorder {

    private final EntityManager entityManager;

    public JpaPlatformAdminAuditRecorder(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(PlatformAdminAuditEvent event) {
        insert(event);
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordAtomically(PlatformAdminAuditEvent event) {
        insert(event);
    }

    private void insert(PlatformAdminAuditEvent event) {
        entityManager.createNativeQuery("""
                        INSERT INTO platform_admin_audit_logs (
                            actor_system_admin_id, tenant_id, action,
                            resource_type, resource_id, request_id,
                            source_ip, details
                        ) VALUES (
                            :actorSystemAdminId, :tenantId, :action,
                            :resourceType, :resourceId, :requestId,
                            CAST(:sourceIp AS inet), CAST(:details AS jsonb)
                        )
                        """)
                .setParameter("actorSystemAdminId", event.actorSystemAdminId())
                .setParameter("tenantId", event.tenantId())
                .setParameter("action", event.action())
                .setParameter("resourceType", event.resourceType())
                .setParameter("resourceId", event.resourceId())
                .setParameter("requestId", event.requestId())
                .setParameter("sourceIp", event.sourceIp())
                .setParameter("details", toJson(event.details()))
                .executeUpdate();
    }

    private static String toJson(Map<String, String> details) {
        return details.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(entry -> "\"" + escape(entry.getKey()) + "\":\""
                        + escape(entry.getValue()) + "\"")
                .collect(java.util.stream.Collectors.joining(",", "{", "}"));
    }

    private static String escape(String value) {
        StringBuilder escaped = new StringBuilder(value.length() + 8);
        for (int index = 0; index < value.length(); index++) {
            char current = value.charAt(index);
            switch (current) {
                case '"' -> escaped.append("\\\"");
                case '\\' -> escaped.append("\\\\");
                case '\b' -> escaped.append("\\b");
                case '\f' -> escaped.append("\\f");
                case '\n' -> escaped.append("\\n");
                case '\r' -> escaped.append("\\r");
                case '\t' -> escaped.append("\\t");
                default -> {
                    if (current < 0x20) {
                        escaped.append(String.format("\\u%04x", (int) current));
                    } else {
                        escaped.append(current);
                    }
                }
            }
        }
        return escaped.toString();
    }
}
