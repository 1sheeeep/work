package cn.xzkj.erp.settings.message;

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
class SettingsMessageRepository {
    private static final String SELECT = """
            select notice.id, notice.title, notice.content, notice.pinned,
                   notice.created_by_display_name, notice.published_at,
                   receipt.read_at
              from tenant_internal_notices notice
              left join tenant_internal_notice_reads receipt
                on receipt.tenant_id = notice.tenant_id
               and receipt.notice_id = notice.id
               and receipt.actor_type = :actorType
               and receipt.actor_id = :actorId
            """;
    private final NamedParameterJdbcTemplate jdbc;

    SettingsMessageRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    Page<SettingsMessageRecord> list(SettingsMessageService.Actor actor,
            SettingsMessageService.Filters filters, Pageable pageable) {
        String where = where(filters);
        MapSqlParameterSource parameters = parameters(actor, filters)
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<SettingsMessageRecord> items = jdbc.query(
                SELECT + where
                        + " order by notice.pinned desc, notice.published_at desc, notice.id desc"
                        + " limit :limit offset :offset",
                parameters, SettingsMessageRepository::map);
        Long total = jdbc.queryForObject(
                "select count(*) from tenant_internal_notices notice"
                        + " left join tenant_internal_notice_reads receipt"
                        + " on receipt.tenant_id = notice.tenant_id"
                        + " and receipt.notice_id = notice.id"
                        + " and receipt.actor_type = :actorType"
                        + " and receipt.actor_id = :actorId" + where,
                parameters, Long.class);
        return new PageImpl<>(items, pageable, total == null ? 0 : total);
    }

    int markRead(SettingsMessageService.Actor actor, List<UUID> noticeIds) {
        return jdbc.update("""
                insert into tenant_internal_notice_reads (
                    tenant_id, notice_id, actor_type, actor_id
                )
                select notice.tenant_id, notice.id, :actorType, :actorId
                  from tenant_internal_notices notice
                 where notice.tenant_id = :tenantId
                   and notice.status = 'ACTIVE'
                   and notice.id in (:noticeIds)
                on conflict do nothing
                """, actorParameters(actor).addValue("noticeIds", noticeIds));
    }

    private static String where(SettingsMessageService.Filters filters) {
        StringBuilder where = new StringBuilder(
                " where notice.tenant_id = :tenantId and notice.status = 'ACTIVE'");
        if (filters.startDate() != null) {
            where.append(" and notice.published_at >= :startAt");
        }
        if (filters.endDate() != null) {
            where.append(" and notice.published_at < :endAt");
        }
        if ("UNREAD".equals(filters.readState())) {
            where.append(" and receipt.read_at is null");
        } else if ("READ".equals(filters.readState())) {
            where.append(" and receipt.read_at is not null");
        }
        return where.toString();
    }

    private static MapSqlParameterSource parameters(
            SettingsMessageService.Actor actor,
            SettingsMessageService.Filters filters) {
        return actorParameters(actor)
                .addValue("startAt", start(filters.startDate()))
                .addValue("endAt", start(filters.endDate() == null
                        ? null : filters.endDate().plusDays(1)));
    }

    private static MapSqlParameterSource actorParameters(
            SettingsMessageService.Actor actor) {
        return new MapSqlParameterSource()
                .addValue("tenantId", actor.tenantId())
                .addValue("actorType", actor.actorType())
                .addValue("actorId", actor.actorId());
    }

    private static OffsetDateTime start(LocalDate value) {
        return value == null ? null : value.atStartOfDay().atOffset(ZoneOffset.UTC);
    }

    private static SettingsMessageRecord map(ResultSet rs, int row)
            throws SQLException {
        OffsetDateTime readAt = rs.getObject("read_at", OffsetDateTime.class);
        return new SettingsMessageRecord(
                rs.getObject("id", UUID.class), rs.getString("title"),
                rs.getString("content"), "INTERNAL_NOTICE",
                rs.getBoolean("pinned"),
                rs.getString("created_by_display_name"),
                rs.getObject("published_at", OffsetDateTime.class).toInstant(),
                readAt != null, readAt == null ? null : readAt.toInstant());
    }
}
