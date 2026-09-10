package cn.xzkj.erp.settings.task;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class OperationalTaskRepository {
    private static final String SELECT = """
            select task.id, task.task_no, task.title, task.category,
                   task.task_object, task.urgency, task.assignee_name,
                   task.description, task.status, task.completed_at,
                   task.created_by_display_name, task.version,
                   task.created_at, task.updated_at
              from tenant_operational_tasks task
            """;
    private final NamedParameterJdbcTemplate jdbc;

    OperationalTaskRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    Page<OperationalTaskRecord> list(UUID tenantId,
            OperationalTaskService.NormalizedFilters filters, Pageable pageable) {
        StringBuilder where = where(filters);
        MapSqlParameterSource parameters = parameters(tenantId, filters)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<OperationalTaskRecord> items = jdbc.query(
                SELECT + where + " order by task.created_at desc, task.id desc"
                        + " limit :limit offset :offset",
                parameters, OperationalTaskRepository::map);
        Long total = jdbc.queryForObject(
                "select count(*) from tenant_operational_tasks task" + where,
                parameters, Long.class);
        return new PageImpl<>(items, pageable, total == null ? 0 : total);
    }

    List<OperationalTaskRecord> export(UUID tenantId,
            OperationalTaskService.NormalizedFilters filters, int limit) {
        return jdbc.query(SELECT + where(filters)
                        + " order by task.created_at desc, task.id desc limit :limit",
                parameters(tenantId, filters).addValue("limit", limit),
                OperationalTaskRepository::map);
    }

    OperationalTaskRecord find(UUID tenantId, UUID id) {
        return jdbc.query(SELECT
                        + " where task.tenant_id = :tenantId and task.id = :id",
                Map.of("tenantId", tenantId, "id", id),
                OperationalTaskRepository::map).stream().findFirst().orElse(null);
    }

    void insert(UUID id, UUID tenantId, String taskNo,
            OperationalTaskService.TaskInput input,
            OperationalTaskService.Actor actor) {
        jdbc.update("""
                insert into tenant_operational_tasks (
                    id, tenant_id, task_no, title, category, task_object,
                    urgency, assignee_name, description,
                    created_by_display_name, created_by_user_id,
                    created_by_system_admin_id, updated_by_user_id,
                    updated_by_system_admin_id, request_id
                ) values (
                    :id, :tenantId, :taskNo, :title, :category, :taskObject,
                    :urgency, :assigneeName, :description,
                    :displayName, :userId, :systemAdminId, :userId,
                    :systemAdminId, :requestId
                )
                """, actorParameters(id, tenantId, actor)
                .addValue("taskNo", taskNo)
                .addValue("title", input.title())
                .addValue("category", input.category())
                .addValue("taskObject", input.taskObject())
                .addValue("urgency", input.urgency())
                .addValue("assigneeName", input.assigneeName())
                .addValue("description", input.description()));
    }

    boolean transition(UUID tenantId, UUID id, long version,
            String fromStatus, String targetStatus,
            OperationalTaskService.Actor actor) {
        return jdbc.update("""
                update tenant_operational_tasks
                   set status = :targetStatus,
                       completed_at = case when :targetStatus = 'COMPLETED'
                                           then now() else null end,
                       deleted_at = case when :targetStatus = 'DELETED'
                                         then now() else null end,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, version = version + 1,
                       updated_at = now()
                 where tenant_id = :tenantId and id = :id and version = :version
                   and status = :fromStatus
                """, actorParameters(id, tenantId, actor)
                .addValue("version", version)
                .addValue("fromStatus", fromStatus)
                .addValue("targetStatus", targetStatus)) == 1;
    }

    private static StringBuilder where(
            OperationalTaskService.NormalizedFilters filters) {
        StringBuilder where = new StringBuilder(
                " where task.tenant_id = :tenantId");
        if (filters.status() == null) {
            where.append(" and task.status <> 'DELETED'");
        } else {
            where.append(" and task.status = :status");
        }
        if (filters.urgency() != null) {
            where.append(" and task.urgency = :urgency");
        }
        if (filters.keyword() != null) {
            String column = switch (filters.searchBy()) {
                case "ASSIGNEE" -> "task.assignee_name";
                case "OBJECT" -> "task.task_object";
                case "TASK_NO" -> "task.task_no";
                default -> "task.title";
            };
            where.append(" and lower(").append(column)
                    .append(") like :keyword escape '\\'");
        }
        if (filters.createdFrom() != null) {
            where.append(" and task.created_at >= :createdFrom");
        }
        if (filters.createdToExclusive() != null) {
            where.append(" and task.created_at < :createdToExclusive");
        }
        return where;
    }

    private static MapSqlParameterSource parameters(UUID tenantId,
            OperationalTaskService.NormalizedFilters filters) {
        return new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("status", filters.status())
                .addValue("urgency", filters.urgency())
                .addValue("keyword", pattern(filters.keyword()))
                .addValue("createdFrom", offset(filters.createdFrom()))
                .addValue("createdToExclusive", offset(filters.createdToExclusive()));
    }

    private static MapSqlParameterSource actorParameters(UUID id, UUID tenantId,
            OperationalTaskService.Actor actor) {
        return new MapSqlParameterSource()
                .addValue("id", id).addValue("tenantId", tenantId)
                .addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId());
    }

    private static String pattern(String value) {
        if (value == null) return null;
        return "%" + value.replace("\\", "\\\\")
                .replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private static OperationalTaskRecord map(ResultSet rs, int row)
            throws SQLException {
        return new OperationalTaskRecord(
                rs.getObject("id", UUID.class), rs.getString("task_no"),
                rs.getString("title"), rs.getString("category"),
                rs.getString("task_object"), rs.getString("urgency"),
                rs.getString("assignee_name"), rs.getString("description"),
                rs.getString("status"), instantOrNull(rs, "completed_at"),
                rs.getString("created_by_display_name"), rs.getLong("version"),
                instant(rs, "created_at"), instant(rs, "updated_at"));
    }

    private static Instant instant(ResultSet rs, String column)
            throws SQLException {
        return rs.getObject(column, OffsetDateTime.class).toInstant();
    }

    private static Instant instantOrNull(ResultSet rs, String column)
            throws SQLException {
        OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    private static OffsetDateTime offset(Instant value) {
        return value == null ? null : value.atOffset(java.time.ZoneOffset.UTC);
    }
}
