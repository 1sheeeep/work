package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.audit.AuditService;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;

@Component
class LocalConnectorActionLeaseWatchdog {
    private final LocalConnectorActionLeaseRepository leases;private final AuditService audit;
    LocalConnectorActionLeaseWatchdog(LocalConnectorActionLeaseRepository leases,AuditService audit){this.leases=leases;this.audit=audit;}
    @Scheduled(fixedDelayString="${app.browser.action-lease-watchdog-interval:10s}",initialDelayString="${app.browser.action-lease-watchdog-interval:10s}")
    @Transactional void expire(){Instant now=Instant.now();for(LocalConnectorActionLease lease:leases.findByStatusAndLeaseUntilBefore("CLAIMED",now)){lease.expire(now);audit.systemSuccess("EXPIRE_CONNECTOR_ACTION_LEASE","LOCAL_CONNECTOR_ACTION_LEASE",lease.getId(),lease.getDevice().getBossAccount().getDisplayName(),lease.getTask().getActionType()+" 租约超时，结果冻结为 UNKNOWN 且不自动重试");}}
}
