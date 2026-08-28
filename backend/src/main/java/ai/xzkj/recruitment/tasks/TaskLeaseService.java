package ai.xzkj.recruitment.tasks;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class TaskLeaseService {
    private final JdbcTemplate jdbc;

    public TaskLeaseService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public List<UUID> findDueTaskIds(Instant now, int limit) {
        return jdbc.query("""
                SELECT id FROM recruitment_tasks
                WHERE scheduler_enabled = TRUE AND status = 'RUNNING'
                  AND (next_run_at IS NULL OR next_run_at <= ?)
                ORDER BY next_run_at NULLS FIRST, id
                LIMIT ?
                """, (rs, row) -> rs.getObject("id", UUID.class), Timestamp.from(now), limit);
    }

    public Lease tryAcquire(UUID taskId, String ownerId, Instant now, Instant leaseUntil) {
        List<Lease> leases = jdbc.query("""
                INSERT INTO recruitment_task_leases(task_id, owner_id, fencing_token, acquired_at, heartbeat_at, lease_until)
                VALUES (?, ?, 1, ?, ?, ?)
                ON CONFLICT (task_id) DO UPDATE SET
                    owner_id = EXCLUDED.owner_id,
                    fencing_token = recruitment_task_leases.fencing_token + 1,
                    acquired_at = EXCLUDED.acquired_at,
                    heartbeat_at = EXCLUDED.heartbeat_at,
                    lease_until = EXCLUDED.lease_until
                WHERE recruitment_task_leases.lease_until <= EXCLUDED.acquired_at
                RETURNING task_id, owner_id, fencing_token, lease_until
                """, (rs, row) -> new Lease(rs.getObject("task_id", UUID.class), rs.getString("owner_id"),
                        rs.getLong("fencing_token"), rs.getTimestamp("lease_until").toInstant()),
                taskId, ownerId, Timestamp.from(now), Timestamp.from(now), Timestamp.from(leaseUntil));
        return leases.isEmpty() ? null : leases.getFirst();
    }

    public void release(Lease lease, Instant now) {
        jdbc.update("""
                UPDATE recruitment_task_leases SET heartbeat_at = ?, lease_until = ?
                WHERE task_id = ? AND owner_id = ? AND fencing_token = ?
                """, Timestamp.from(now), Timestamp.from(now), lease.taskId(), lease.ownerId(), lease.fencingToken());
    }

    public SchedulerSnapshot snapshot(String instanceId, boolean enabled) {
        Integer active = jdbc.queryForObject("SELECT count(*) FROM recruitment_task_leases WHERE lease_until > CURRENT_TIMESTAMP", Integer.class);
        Integer due = jdbc.queryForObject("""
                SELECT count(*) FROM recruitment_tasks WHERE scheduler_enabled = TRUE AND status = 'RUNNING'
                AND (next_run_at IS NULL OR next_run_at <= CURRENT_TIMESTAMP)
                """, Integer.class);
        Instant next = jdbc.query("""
                SELECT min(next_run_at) AS next_run_at FROM recruitment_tasks
                WHERE scheduler_enabled = TRUE AND status = 'RUNNING'
                """, rs -> rs.next() && rs.getTimestamp("next_run_at") != null ? rs.getTimestamp("next_run_at").toInstant() : null);
        return new SchedulerSnapshot(enabled, instanceId, active == null ? 0 : active, due == null ? 0 : due, next);
    }

    public record Lease(UUID taskId, String ownerId, long fencingToken, Instant leaseUntil) {}
    public record SchedulerSnapshot(boolean enabled, String instanceId, int activeLeases, int dueTasks, Instant nextRunAt) {}
}
