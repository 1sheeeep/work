package cn.xzkj.erp.iam.persistence;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import jakarta.persistence.EntityManager;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Component
public class JpaSecurityAuditRecorder implements SecurityAuditRecorder {

    private final EntityManager entityManager;

    public JpaSecurityAuditRecorder(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(SecurityAuditEvent event) {
        insert(event);
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordAtomically(SecurityAuditEvent event) {
        insert(event);
    }

    private void insert(SecurityAuditEvent event) {
        entityManager.createNativeQuery("""
                        INSERT INTO audit_logs (
                            tenant_id, actor_user_id, actor_system_admin_id,
                            action, resource_type,
                            resource_id, request_id, source_ip, details
                        ) VALUES (
                            :tenantId, :actorUserId, :actorSystemAdminId,
                            :action, :resourceType,
                            :resourceId, :requestId, CAST(:sourceIp AS inet),
                            CAST(:details AS jsonb)
                        )
                        """)
                .setParameter("tenantId", event.tenantId())
                .setParameter("actorUserId", event.actorUserId())
                .setParameter("actorSystemAdminId", event.actorSystemAdminId())
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
        if (value == null) {
            return "";
        }
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
