package ai.xzkj.recruitment.resilience;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.beans.factory.annotation.Value;

import java.util.List;
import java.time.Instant;
import java.util.UUID;

@RestController
@RequestMapping("/api/operations")
@PreAuthorize("hasRole('SYSTEM_ADMIN')")
public class GatewayOperationsController {
    private final GatewayResilienceGuard guard;
    private final JdbcTemplate jdbcTemplate;
    @Value("${app.inbound-reply.max-pending-global:1000}") private long maxPendingGlobal;
    @Value("${app.inbound-reply.send-limit-per-hour:20}") private long sendLimitPerHour;
    @Value("${app.inbound-reply.send-limit-per-day:100}") private long sendLimitPerDay;
    @Value("${app.inbound-reply.auto-send-enabled:false}") private boolean inboundAutoSendEnabled;
    public GatewayOperationsController(GatewayResilienceGuard guard, JdbcTemplate jdbcTemplate, MeterRegistry meters) {
        this.guard = guard; this.jdbcTemplate = jdbcTemplate;
        Gauge.builder("recruitment.browser.devices.active", this,
                        controller -> controller.count("SELECT COUNT(*) FROM local_connector_devices WHERE status = 'ACTIVE'"))
                .description("当前处于 ACTIVE 状态的浏览器桥接设备数").register(meters);
        Gauge.builder("recruitment.browser.devices.stale", this,
                        controller -> controller.count("SELECT COUNT(*) FROM local_connector_devices WHERE status = 'ACTIVE' AND (last_heartbeat_at IS NULL OR last_heartbeat_at < CURRENT_TIMESTAMP - INTERVAL '2 minutes')"))
                .description("已超过两分钟未心跳的 ACTIVE 浏览器桥接设备数").register(meters);
        Gauge.builder("recruitment.inbound.reply.auto.send.enabled", this,
                        controller -> controller.inboundAutoSendEnabled ? 1 : 0)
                .description("后端 AI 自动发送总开关；1 为开启").register(meters);
    }
    @GetMapping public OperationsSummary summary() {
        String version = jdbcTemplate.queryForObject("SELECT version FROM flyway_schema_history WHERE success = true ORDER BY installed_rank DESC LIMIT 1", String.class);
        Boolean immutable = jdbcTemplate.queryForObject("SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_logs_append_only' AND NOT tgisinternal)", Boolean.class);
        long activeDevices = count("SELECT COUNT(*) FROM local_connector_devices WHERE status = 'ACTIVE'");
        long staleDevices = count("SELECT COUNT(*) FROM local_connector_devices WHERE status = 'ACTIVE' AND (last_heartbeat_at IS NULL OR last_heartbeat_at < CURRENT_TIMESTAMP - INTERVAL '2 minutes')");
        long unreadObservations = count("SELECT COUNT(*) FROM local_connector_unread_observations WHERE unread = TRUE");
        long unverifiedCaptures = count("SELECT COUNT(*) FROM job_positions WHERE capture_source = 'VISIBLE_PAGE' AND capture_verified = FALSE");
        // -1 keeps the existing operations response shape while explicitly
        // reporting that per-account pending tasks are no longer capped.
        QueueOperations queue = new QueueOperations(
                count("SELECT COUNT(*) FROM inbound_ai_reply_tasks WHERE status IN ('QUEUED','RETRY_WAIT')"),
                count("SELECT COUNT(*) FROM inbound_ai_reply_tasks WHERE status = 'PROCESSING'"),
                count("SELECT COUNT(*) FROM inbound_ai_reply_tasks WHERE status = 'RETRY_WAIT'"),
                count("SELECT COUNT(*) FROM inbound_ai_reply_tasks WHERE send_status = 'READY'"),
                count("SELECT COUNT(*) FROM inbound_ai_reply_tasks WHERE send_status = 'CLAIMED'"),
                count("SELECT COUNT(*) FROM inbound_ai_reply_tasks WHERE send_status = 'UNKNOWN'"),
                count("SELECT COUNT(*) FROM inbound_ai_reply_tasks WHERE status = 'FAILED' AND completed_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'"),
                count("SELECT COUNT(*) FROM inbound_ai_reply_tasks WHERE send_status = 'SUCCEEDED' AND send_completed_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'"),
                count("SELECT COUNT(*) FROM inbound_ai_reply_tasks WHERE send_status = 'SUCCEEDED' AND send_completed_at > CURRENT_TIMESTAMP - INTERVAL '1 day'"),
                nullableLong("SELECT EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(created_at)))::bigint FROM inbound_ai_reply_tasks WHERE status IN ('QUEUED','RETRY_WAIT')"),
                -1L,maxPendingGlobal,sendLimitPerHour,sendLimitPerDay,inboundAutoSendEnabled);
        long activeDutyPolicies = count("SELECT COUNT(*) FROM auto_reply_policies WHERE enabled = TRUE AND auto_send_enabled = TRUE AND away_mode <> 'IN_OFFICE' AND (away_ends_at IS NULL OR away_ends_at > CURRENT_TIMESTAMP)");
        List<InboundReplyEvent> recentInboundReplyEvents = jdbcTemplate.query("""
                SELECT task.id, account.display_name, job.title, LEFT(task.chat_digest, 12),
                       task.status, task.send_status, task.category, task.attempt_count,
                       task.last_error_code,
                       COALESCE(NULLIF(task.send_result_reason, ''), NULLIF(task.result_reason, ''), NULLIF(task.last_error_code, '')),
                       CASE WHEN task.send_status = 'SUCCEEDED' THEN task.reply_content ELSE NULL END,
                       LEFT(COALESCE(NULLIF(task.message_text, ''), (
                           SELECT message.content
                             FROM conversation_messages message
                            WHERE message.external_message_id = CONCAT('boss:', task.message_digest)
                              AND message.direction = 'INBOUND'
                              AND message.superseded_at IS NULL
                            ORDER BY message.created_at DESC
                            LIMIT 1
                       )), 1000),
                       task.created_at, task.updated_at, task.send_completed_at
                  FROM inbound_ai_reply_tasks task
                  JOIN boss_accounts account ON account.id = task.account_id
                  JOIN job_positions job ON job.id = task.job_position_id
                 ORDER BY task.updated_at DESC
                 LIMIT 50
                """, (rs, rowNum) -> new InboundReplyEvent(
                rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), rs.getString(4),
                rs.getString(5), rs.getString(6), rs.getString(7), rs.getInt(8), rs.getString(9),
                rs.getString(10), rs.getString(11), rs.getString(12), rs.getTimestamp(13).toInstant(),
                rs.getTimestamp(14).toInstant(), rs.getTimestamp(15) == null ? null : rs.getTimestamp(15).toInstant()));
        return new OperationsSummary("READY", version, Boolean.TRUE.equals(immutable), activeDevices, staleDevices,
                unreadObservations, unverifiedCaptures, activeDutyPolicies, queue, recentInboundReplyEvents,
                Instant.now(), guard.snapshots());
    }
    private long count(String sql) { Long value = jdbcTemplate.queryForObject(sql, Long.class); return value == null ? 0 : value; }
    private Long nullableLong(String sql) { return jdbcTemplate.queryForObject(sql, Long.class); }
    @GetMapping("/gateways") public List<GatewayResilienceGuard.Snapshot> list() { return guard.snapshots(); }
    public record OperationsSummary(String status, String flywayVersion, boolean auditAppendOnly, long activeBrowserDevices,
                                    long staleBrowserDevices, long unreadObservations, long unverifiedPageCaptures,
                                    long activeDutyPolicies, QueueOperations inboundReplyQueue,
                                    List<InboundReplyEvent> recentInboundReplyEvents, Instant checkedAt,
                                    List<GatewayResilienceGuard.Snapshot> gateways) {}
    public record QueueOperations(long pending,long processing,long retryWaiting,long readyToSend,long sendLeased,
                                  long sendUnknown,long failedLastHour,long sentLastHour,long sentLastDay,Long oldestPendingSeconds,
                                  long maxPendingPerAccount,long maxPendingGlobal,long sendLimitPerHour,long sendLimitPerDay,
                                  boolean autoSendEnabled) {}
    public record InboundReplyEvent(UUID id,String accountName,String jobTitle,String anonymousChatKey,
                                    String taskStatus,String sendStatus,String category,int attemptCount,
                                    String errorCode,String detail,String replyContent,String messageText,
                                    Instant createdAt,Instant updatedAt,Instant completedAt) {}
}
