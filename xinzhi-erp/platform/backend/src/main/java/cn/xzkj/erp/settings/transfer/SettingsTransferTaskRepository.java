package cn.xzkj.erp.settings.transfer;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class SettingsTransferTaskRepository {
    private static final String SELECT = """
            select job.id, job.job_type, job.status,
                   coalesce(job.result_filename,
                       case
                         when job.object_reference like 'upload:%'
                           then substring(job.object_reference from 8)
                         when job.object_reference like 'inline:%'
                           then substring(job.object_reference from 8)
                         else job.object_reference
                       end,
                       case when job.job_type = 'IMPORT'
                         then '订单导入.csv' else '订单导出.csv' end) as filename,
                   coalesce(tenant_user.display_name,
                       system_admin.display_name, '历史记录') as created_by_display_name,
                   job.requested_count, job.succeeded_count, job.failed_count,
                   job.safe_error_summary,
                   (job.result_content is not null) as result_available,
                   coalesce(octet_length(job.result_content), 0)
                       as result_size_bytes,
                   job.created_at, job.completed_at
              from tenant_order_transfer_jobs job
              left join users tenant_user
                on tenant_user.tenant_id = job.tenant_id
               and tenant_user.id = job.created_by_user_id
              left join system_admins system_admin
                on system_admin.id = job.created_by_system_admin_id
            """;
    private final NamedParameterJdbcTemplate jdbc;

    SettingsTransferTaskRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    Page<SettingsTransferTaskRecord> list(UUID tenantId,
            SettingsTransferTaskService.Filters filters, Pageable pageable) {
        String where = where(filters);
        MapSqlParameterSource parameters = parameters(tenantId, filters)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<SettingsTransferTaskRecord> items = jdbc.query(
                SELECT + where + " order by job.created_at desc, job.id desc"
                        + " limit :limit offset :offset",
                parameters, SettingsTransferTaskRepository::map);
        Long total = jdbc.queryForObject(
                "select count(*) from tenant_order_transfer_jobs job" + where,
                parameters, Long.class);
        return new PageImpl<>(items, pageable, total == null ? 0 : total);
    }

    SettingsTransferTaskService.Artifact findArtifact(
            UUID tenantId, UUID taskId) {
        return jdbc.query("""
                select result_filename, result_media_type, result_content
                  from tenant_order_transfer_jobs
                 where tenant_id = :tenantId
                   and id = :taskId
                   and job_type = 'EXPORT'
                   and status = 'SUCCEEDED'
                   and result_content is not null
                """, new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("taskId", taskId),
                (rs, row) -> new SettingsTransferTaskService.Artifact(
                        rs.getString("result_filename"),
                        rs.getString("result_media_type"),
                        rs.getBytes("result_content")))
                .stream().findFirst().orElse(null);
    }

    private static String where(SettingsTransferTaskService.Filters filters) {
        StringBuilder where = new StringBuilder(
                " where job.tenant_id = :tenantId"
                        + " and job.job_type in ('IMPORT', 'EXPORT')");
        if (!"ALL".equals(filters.jobType())) {
            where.append(" and job.job_type = :jobType");
        }
        if (!"ALL".equals(filters.status())) {
            where.append(" and job.status = :status");
        }
        if (filters.keyword() != null) {
            where.append(" and lower(coalesce(job.result_filename, "
                    + "job.object_reference, '')) like :keyword escape '\\'");
        }
        if (filters.resultAvailable() != null) {
            where.append(filters.resultAvailable()
                    ? " and job.result_content is not null"
                    : " and job.result_content is null");
        }
        if (filters.startDate() != null) {
            where.append(" and job.created_at >= :startAt");
        }
        if (filters.endDate() != null) {
            where.append(" and job.created_at < :endAt");
        }
        return where.toString();
    }

    private static MapSqlParameterSource parameters(UUID tenantId,
            SettingsTransferTaskService.Filters filters) {
        return new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("jobType", filters.jobType())
                .addValue("status", filters.status())
                .addValue("keyword", like(filters.keyword()))
                .addValue("startAt", start(filters.startDate()))
                .addValue("endAt", start(filters.endDate() == null
                        ? null : filters.endDate().plusDays(1)));
    }

    private static OffsetDateTime start(LocalDate value) {
        return value == null ? null : value.atStartOfDay().atOffset(ZoneOffset.UTC);
    }

    private static String like(String value) {
        if (value == null) return null;
        return "%" + value.toLowerCase(java.util.Locale.ROOT)
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_") + "%";
    }

    private static SettingsTransferTaskRecord map(ResultSet rs, int row)
            throws SQLException {
        OffsetDateTime completedAt = rs.getObject(
                "completed_at", OffsetDateTime.class);
        return new SettingsTransferTaskRecord(
                rs.getObject("id", UUID.class), rs.getString("job_type"),
                rs.getString("status"), rs.getString("filename"),
                rs.getString("created_by_display_name"),
                rs.getInt("requested_count"), rs.getInt("succeeded_count"),
                rs.getInt("failed_count"), rs.getString("safe_error_summary"),
                rs.getBoolean("result_available"),
                rs.getLong("result_size_bytes"),
                rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                completedAt == null ? null : completedAt.toInstant());
    }
}
