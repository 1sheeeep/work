package ai.xzkj.recruitment.resilience;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.time.Instant;

@RestController
@RequestMapping("/api/operations")
@PreAuthorize("hasRole('SYSTEM_ADMIN')")
public class GatewayOperationsController {
    private final GatewayResilienceGuard guard;
    private final JdbcTemplate jdbcTemplate;
    public GatewayOperationsController(GatewayResilienceGuard guard, JdbcTemplate jdbcTemplate) {
        this.guard = guard; this.jdbcTemplate = jdbcTemplate;
    }
    @GetMapping public OperationsSummary summary() {
        String version = jdbcTemplate.queryForObject("SELECT version FROM flyway_schema_history WHERE success = true ORDER BY installed_rank DESC LIMIT 1", String.class);
        Boolean immutable = jdbcTemplate.queryForObject("SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_logs_append_only' AND NOT tgisinternal)", Boolean.class);
        return new OperationsSummary("READY", version, Boolean.TRUE.equals(immutable), Instant.now(), guard.snapshots());
    }
    @GetMapping("/gateways") public List<GatewayResilienceGuard.Snapshot> list() { return guard.snapshots(); }
    public record OperationsSummary(String status, String flywayVersion, boolean auditAppendOnly, Instant checkedAt,
                                    List<GatewayResilienceGuard.Snapshot> gateways) {}
}
