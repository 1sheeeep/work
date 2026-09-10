package cn.xzkj.erp.settings.notice;

import java.sql.ResultSet;
import java.sql.SQLException;
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
class InternalNoticeRepository {
    private static final String SELECT = """
            select notice.id, notice.title, notice.content, notice.pinned,
                   notice.status, notice.published_at, notice.archived_at,
                   notice.created_by_display_name, notice.version,
                   notice.created_at, notice.updated_at
              from tenant_internal_notices notice
            """;
    private final NamedParameterJdbcTemplate jdbc;

    InternalNoticeRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    Page<InternalNoticeRecord> list(UUID tenantId,
            InternalNoticeService.Filters filters, Pageable pageable) {
        StringBuilder where = where(filters);
        MapSqlParameterSource parameters = parameters(tenantId, filters)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<InternalNoticeRecord> items = jdbc.query(
                SELECT + where
                        + " order by notice.pinned desc, notice.published_at desc, notice.id desc"
                        + " limit :limit offset :offset",
                parameters, InternalNoticeRepository::map);
        Long total = jdbc.queryForObject(
                "select count(*) from tenant_internal_notices notice" + where,
                parameters, Long.class);
        return new PageImpl<>(items, pageable, total == null ? 0 : total);
    }

    InternalNoticeRecord find(UUID tenantId, UUID id) {
        return jdbc.query(SELECT
                        + " where notice.tenant_id = :tenantId and notice.id = :id",
                Map.of("tenantId", tenantId, "id", id),
                InternalNoticeRepository::map).stream().findFirst().orElse(null);
    }

    void insert(UUID id, UUID tenantId, InternalNoticeService.NoticeInput input,
            InternalNoticeService.Actor actor) {
        jdbc.update("""
                insert into tenant_internal_notices (
                    id, tenant_id, title, content, pinned,
                    created_by_display_name, created_by_user_id,
                    created_by_system_admin_id, updated_by_user_id,
                    updated_by_system_admin_id, request_id
                ) values (
                    :id, :tenantId, :title, :content, :pinned,
                    :displayName, :userId, :systemAdminId, :userId,
                    :systemAdminId, :requestId
                )
                """, actorParameters(id, tenantId, actor)
                .addValue("title", input.title())
                .addValue("content", input.content())
                .addValue("pinned", input.pinned()));
    }

    boolean setPinned(UUID tenantId, UUID id, long version, boolean pinned,
            InternalNoticeService.Actor actor) {
        return jdbc.update("""
                update tenant_internal_notices
                   set pinned = :pinned,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, version = version + 1,
                       updated_at = now()
                 where tenant_id = :tenantId and id = :id and version = :version
                   and status = 'ACTIVE'
                """, actorParameters(id, tenantId, actor)
                .addValue("version", version)
                .addValue("pinned", pinned)) == 1;
    }

    boolean transition(UUID tenantId, UUID id, long version,
            String fromStatus, String targetStatus,
            InternalNoticeService.Actor actor) {
        return jdbc.update("""
                update tenant_internal_notices
                   set status = :targetStatus,
                       pinned = case when :targetStatus = 'ARCHIVED'
                                     then false else pinned end,
                       archived_at = case when :targetStatus = 'ARCHIVED'
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

    private static StringBuilder where(InternalNoticeService.Filters filters) {
        StringBuilder where = new StringBuilder(
                " where notice.tenant_id = :tenantId");
        where.append(" and notice.status = :status");
        if (filters.pinned() != null) {
            where.append(" and notice.pinned = :pinned");
        }
        if (filters.title() != null) {
            where.append(" and lower(notice.title) like :title escape '\\'");
        }
        return where;
    }

    private static MapSqlParameterSource parameters(UUID tenantId,
            InternalNoticeService.Filters filters) {
        return new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("status", filters.status())
                .addValue("pinned", filters.pinned())
                .addValue("title", pattern(filters.title()));
    }

    private static MapSqlParameterSource actorParameters(UUID id, UUID tenantId,
            InternalNoticeService.Actor actor) {
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

    private static InternalNoticeRecord map(ResultSet rs, int row)
            throws SQLException {
        return new InternalNoticeRecord(
                rs.getObject("id", UUID.class), rs.getString("title"),
                rs.getString("content"), rs.getBoolean("pinned"),
                rs.getString("status"), instant(rs, "published_at"),
                instantOrNull(rs, "archived_at"),
                rs.getString("created_by_display_name"), rs.getLong("version"),
                instant(rs, "created_at"), instant(rs, "updated_at"));
    }

    private static java.time.Instant instant(ResultSet rs, String column)
            throws SQLException {
        return rs.getObject(column, OffsetDateTime.class).toInstant();
    }

    private static java.time.Instant instantOrNull(ResultSet rs, String column)
            throws SQLException {
        OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
