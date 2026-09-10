package cn.xzkj.erp.order.repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class OrderTransferRepository {

    private final JdbcTemplate jdbc;

    public OrderTransferRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public UUID recordCompleted(
            UUID tenantId,
            UUID createdByUserId,
            UUID createdBySystemAdminId,
            String jobType,
            int requestedCount,
            int succeededCount,
            int failedCount,
            String objectReference,
            String resultFilename,
            String resultMediaType,
            byte[] resultContent) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO tenant_order_transfer_jobs (
                    id, tenant_id, job_type, status, requested_count,
                    succeeded_count, failed_count, object_reference,
                    created_by_user_id, created_by_system_admin_id,
                    result_filename, result_media_type, result_content,
                    completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
                """, id, tenantId, jobType,
                failedCount == 0 ? "SUCCEEDED"
                        : succeededCount == 0 ? "FAILED" : "PARTIALLY_FAILED",
                requestedCount, succeededCount, failedCount, objectReference,
                createdByUserId, createdBySystemAdminId, resultFilename,
                resultMediaType, resultContent);
        return id;
    }

    public UUID recordCompletedCommand(
            UUID tenantId,
            UUID createdByUserId,
            UUID createdBySystemAdminId,
            String jobType,
            int requestedCount,
            UUID commandId,
            String fingerprint) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO tenant_order_transfer_jobs (
                    id, tenant_id, job_type, status, requested_count,
                    succeeded_count, failed_count, command_id,
                    request_fingerprint, created_by_user_id,
                    created_by_system_admin_id, completed_at
                ) VALUES (?, ?, ?, 'SUCCEEDED', ?, ?, 0, ?, ?, ?, ?, now())
                """, id, tenantId, jobType, requestedCount, requestedCount,
                commandId, fingerprint, createdByUserId,
                createdBySystemAdminId);
        return id;
    }

    public void lockCommand(UUID tenantId, UUID commandId) {
        jdbc.queryForObject(
                "select pg_advisory_xact_lock(hashtextextended(?, 0))",
                Object.class, tenantId + ":order-transfer:" + commandId);
    }

    public Optional<CommandJob> findCommand(UUID tenantId, UUID commandId) {
        return jdbc.query("""
                SELECT id, request_fingerprint, requested_count,
                       succeeded_count, failed_count, status
                FROM tenant_order_transfer_jobs
                WHERE tenant_id = ? AND command_id = ?
                """, (rs, row) -> new CommandJob(
                        rs.getObject("id", UUID.class),
                        rs.getString("request_fingerprint"),
                        rs.getInt("requested_count"),
                        rs.getInt("succeeded_count"),
                        rs.getInt("failed_count"),
                        rs.getString("status")),
                tenantId, commandId).stream().findFirst();
    }

    public List<TransferJob> list(UUID tenantId, int page, int size) {
        return jdbc.query("""
                SELECT id, job_type, status, requested_count, succeeded_count,
                       failed_count, safe_error_summary, object_reference,
                       version, created_at, completed_at
                FROM tenant_order_transfer_jobs
                WHERE tenant_id = ?
                ORDER BY created_at DESC, id DESC
                LIMIT ? OFFSET ?
                """, (rs, row) -> new TransferJob(
                        rs.getObject("id", UUID.class),
                        rs.getString("job_type"),
                        rs.getString("status"),
                        rs.getInt("requested_count"),
                        rs.getInt("succeeded_count"),
                        rs.getInt("failed_count"),
                        rs.getString("safe_error_summary"),
                        rs.getString("object_reference"),
                        rs.getLong("version"),
                        rs.getTimestamp("created_at").toInstant(),
                        instantOrNull(rs.getTimestamp("completed_at"))),
                tenantId, size, Math.multiplyExact(page, size));
    }

    public long count(UUID tenantId) {
        Long value = jdbc.queryForObject("""
                SELECT count(*) FROM tenant_order_transfer_jobs
                WHERE tenant_id = ?
                """, Long.class, tenantId);
        return value == null ? 0 : value;
    }

    private static Instant instantOrNull(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    public record CommandJob(
            UUID id,
            String fingerprint,
            int requestedCount,
            int succeededCount,
            int failedCount,
            String status) {
    }

    public record TransferJob(
            UUID id,
            String jobType,
            String status,
            int requestedCount,
            int succeededCount,
            int failedCount,
            String safeErrorSummary,
            String objectReference,
            long version,
            Instant createdAt,
            Instant completedAt) {
    }
}
