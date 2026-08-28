package ai.xzkj.recruitment.resilience;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.time.Instant;
import ai.xzkj.recruitment.tasks.SchedulerProperties;
import ai.xzkj.recruitment.tasks.TaskLeaseService;
import ai.xzkj.recruitment.notifications.NotificationProperties;
import ai.xzkj.recruitment.notifications.NotificationTrialService;
import org.springframework.web.bind.annotation.PostMapping;

@RestController
@RequestMapping("/api/operations")
@PreAuthorize("hasRole('SYSTEM_ADMIN')")
public class GatewayOperationsController {
    private final GatewayResilienceGuard guard;
    private final JdbcTemplate jdbcTemplate;
    private final TaskLeaseService taskLeases;
    private final SchedulerProperties schedulerProperties;
    private final NotificationProperties notificationProperties;
    private final NotificationTrialService notificationTrialService;
    public GatewayOperationsController(GatewayResilienceGuard guard, JdbcTemplate jdbcTemplate,
                                       TaskLeaseService taskLeases, SchedulerProperties schedulerProperties,
                                       NotificationProperties notificationProperties, NotificationTrialService notificationTrialService) {
        this.guard = guard; this.jdbcTemplate = jdbcTemplate; this.taskLeases = taskLeases; this.schedulerProperties = schedulerProperties;
        this.notificationProperties = notificationProperties;
        this.notificationTrialService = notificationTrialService;
    }
    @GetMapping public OperationsSummary summary() {
        String version = jdbcTemplate.queryForObject("SELECT version FROM flyway_schema_history WHERE success = true ORDER BY installed_rank DESC LIMIT 1", String.class);
        Boolean immutable = jdbcTemplate.queryForObject("SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_logs_append_only' AND NOT tgisinternal)", Boolean.class);
        return new OperationsSummary("READY", version, Boolean.TRUE.equals(immutable), Instant.now(), guard.snapshots(),
                taskLeases.snapshot(schedulerProperties.instanceId(), schedulerProperties.enabled()),
                new NotificationSnapshot(notificationProperties.mode(), notificationProperties.configured(), notificationProperties.trialEnabled()));
    }
    @GetMapping("/gateways") public List<GatewayResilienceGuard.Snapshot> list() { return guard.snapshots(); }
    @PostMapping("/notification-trial") public NotificationTrialService.TrialResponse trialNotification() { return notificationTrialService.send(); }
    public record OperationsSummary(String status, String flywayVersion, boolean auditAppendOnly, Instant checkedAt,
                                    List<GatewayResilienceGuard.Snapshot> gateways,
                                    TaskLeaseService.SchedulerSnapshot scheduler, NotificationSnapshot notification) {}
    public record NotificationSnapshot(String mode, boolean configured, boolean trialEnabled) {}
}
