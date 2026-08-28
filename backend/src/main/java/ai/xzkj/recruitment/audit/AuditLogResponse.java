package ai.xzkj.recruitment.audit;

import java.time.Instant;
import java.util.UUID;

public record AuditLogResponse(
        UUID id,
        String actorName,
        String action,
        String targetType,
        UUID targetId,
        String targetLabel,
        AuditResult result,
        String details,
        String requestId,
        Instant occurredAt
) {
    static AuditLogResponse from(AuditLog log) {
        return new AuditLogResponse(
                log.getId(), log.getActorName(), log.getAction(), log.getTargetType(),
                log.getTargetId(), log.getTargetLabel(), log.getResult(), log.getDetails(), log.getRequestId(), log.getOccurredAt()
        );
    }
}
