package cn.xzkj.erp.logistics.authorization;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.logistics.authorization.LogisticsAuthorizationService.Actor;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.ProbeResult;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
class LogisticsAuthorizationProbeFinalizer {
    private final LogisticsAuthorizationRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    LogisticsAuthorizationProbeFinalizer(LogisticsAuthorizationRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional
    LogisticsAuthorizationRecord complete(Actor actor,
            LogisticsAuthorizationRecord probed, long version, ProbeResult result) {
        LogisticsAuthorizationRecord current = repository.find(actor.tenantId(), probed.id());
        if (current == null) {
            throw new ResourceNotFoundException(
                    "Logistics provider connection was not found");
        }
        if ("ARCHIVED".equals(current.status()) || current.version() != version) {
            throw new ConflictException(
                    "Logistics provider connection changed concurrently or is archived");
        }
        if ("CONNECTED".equals(result.status()) && "PENDING".equals(current.status())) {
            if (!repository.activate(actor.tenantId(), current.id(), version, actor)) {
                throw new ConflictException(
                        "Logistics provider connection changed concurrently");
            }
            current = repository.find(actor.tenantId(), current.id());
            if (current == null) {
                throw new ResourceNotFoundException(
                        "Logistics provider connection was not found");
            }
        }
        if ("CONNECTED".equals(result.status())) {
            repository.synchronizeChannels(actor.tenantId(), current.id(),
                    result.channels(), actor);
        }
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                "logistics.authorization.probed", "logistics_authorization",
                current.id().toString(), actor.requestId(), actor.sourceIp(),
                Map.of("providerCode", current.providerCode(),
                        "result", result.status())));
        return current;
    }
}
