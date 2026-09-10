package cn.xzkj.erp.logistics.matchingrule;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalTime;
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
class MatchingRuleRepository {
    private static final String SELECT = """
            select id, name, priority, platform_name, shop_name, channel_name,
                   warehouse_name, auto_handover, no_handover_start,
                   no_handover_end, note, lifecycle_status,
                   created_by_display_name, version, created_at, updated_at
              from tenant_logistics_matching_rules rule
            """;
    private final NamedParameterJdbcTemplate jdbc;

    MatchingRuleRepository(NamedParameterJdbcTemplate jdbc) { this.jdbc = jdbc; }

    Page<MatchingRuleRecord> list(
            UUID tenantId, MatchingRuleService.Filters filters,
            Pageable pageable) {
        StringBuilder where = new StringBuilder(" where rule.tenant_id = :tenantId");
        addLike(where, filters.platform(), "rule.platform_name", "platform");
        addLike(where, filters.shop(), "rule.shop_name", "shop");
        addLike(where, filters.channel(), "rule.channel_name", "channel");
        addLike(where, filters.warehouse(), "rule.warehouse_name", "warehouse");
        addLike(where, filters.name(), "rule.name", "name");
        if (filters.status() != null) where.append(" and rule.lifecycle_status = :status");
        if (filters.autoHandover() != null) where.append(" and rule.auto_handover = :autoHandover");
        if (filters.priority() != null) where.append(" and rule.priority = :priority");
        if (filters.updatedFrom() != null) where.append(" and rule.updated_at >= :updatedFrom");
        if (filters.updatedToExclusive() != null) where.append(" and rule.updated_at < :updatedToExclusive");
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("platform", pattern(filters.platform()))
                .addValue("shop", pattern(filters.shop()))
                .addValue("channel", pattern(filters.channel()))
                .addValue("warehouse", pattern(filters.warehouse()))
                .addValue("name", pattern(filters.name()))
                .addValue("status", filters.status())
                .addValue("autoHandover", filters.autoHandover())
                .addValue("priority", filters.priority())
                .addValue("updatedFrom", filters.updatedFrom())
                .addValue("updatedToExclusive", filters.updatedToExclusive())
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<MatchingRuleRecord> items = jdbc.query(
                SELECT + where + " order by rule.priority, rule.updated_at desc, rule.id desc limit :limit offset :offset",
                parameters, MatchingRuleRepository::map);
        Long total = jdbc.queryForObject(
                "select count(*) from tenant_logistics_matching_rules rule" + where,
                parameters, Long.class);
        return new PageImpl<>(items, pageable, total == null ? 0 : total);
    }

    MatchingRuleRecord find(UUID tenantId, UUID id) {
        return jdbc.query(SELECT + " where rule.tenant_id = :tenantId and rule.id = :id",
                Map.of("tenantId", tenantId, "id", id), MatchingRuleRepository::map)
                .stream().findFirst().orElse(null);
    }

    boolean isEnabledChannel(UUID tenantId, String channelName) {
        Boolean enabled = jdbc.queryForObject("""
                select exists (
                    select 1
                      from tenant_logistics_authorization_channels channel
                      join tenant_logistics_authorizations authorization_profile
                        on authorization_profile.id = channel.authorization_id
                       and authorization_profile.tenant_id = channel.tenant_id
                     where channel.tenant_id = :tenantId
                       and channel.channel_name = :channelName
                       and channel.enabled = true
                       and channel.provider_available = true
                       and authorization_profile.lifecycle_status = 'ACTIVE'
                )
                """, Map.of("tenantId", tenantId, "channelName", channelName),
                Boolean.class);
        return Boolean.TRUE.equals(enabled);
    }

    void insert(UUID id, UUID tenantId, MatchingRuleService.RuleInput value,
            MatchingRuleService.Actor actor) {
        jdbc.update("""
                insert into tenant_logistics_matching_rules (
                    id, tenant_id, name, priority, platform_name, shop_name,
                    channel_name, warehouse_name, auto_handover,
                    no_handover_start, no_handover_end, note,
                    created_by_display_name, created_by_user_id,
                    created_by_system_admin_id, updated_by_user_id,
                    updated_by_system_admin_id, request_id
                ) values (
                    :id, :tenantId, :name, :priority, :platform, :shop,
                    :channel, :warehouse, :autoHandover, :noHandoverStart,
                    :noHandoverEnd, :note, :displayName, :userId,
                    :systemAdminId, :userId, :systemAdminId, :requestId
                )
                """, actorParameters(id, tenantId, actor)
                .addValue("name", value.name()).addValue("priority", value.priority())
                .addValue("platform", value.platform()).addValue("shop", value.shop())
                .addValue("channel", value.channel()).addValue("warehouse", value.warehouse())
                .addValue("autoHandover", value.autoHandover())
                .addValue("noHandoverStart", value.noHandoverStart())
                .addValue("noHandoverEnd", value.noHandoverEnd())
                .addValue("note", value.note()));
    }

    boolean archive(UUID tenantId, UUID id, long version,
            MatchingRuleService.Actor actor) {
        return jdbc.update("""
                update tenant_logistics_matching_rules
                   set lifecycle_status = 'ARCHIVED', version = version + 1,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, updated_at = now()
                 where tenant_id = :tenantId and id = :id
                   and version = :version and lifecycle_status = 'ACTIVE'
                """, actorParameters(id, tenantId, actor).addValue("version", version)) == 1;
    }

    private static void addLike(StringBuilder where, String value, String column, String parameter) {
        if (value != null) where.append(" and lower(").append(column)
                .append(") like :").append(parameter).append(" escape '\\'");
    }

    private static String pattern(String value) {
        if (value == null) return null;
        return "%" + value.replace("\\", "\\\\").replace("%", "\\%")
                .replace("_", "\\_") + "%";
    }

    private static MapSqlParameterSource actorParameters(UUID id, UUID tenantId,
            MatchingRuleService.Actor actor) {
        return new MapSqlParameterSource().addValue("id", id)
                .addValue("tenantId", tenantId).addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId()).addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId());
    }

    private static MatchingRuleRecord map(ResultSet rs, int row) throws SQLException {
        return new MatchingRuleRecord(rs.getObject("id", UUID.class), rs.getString("name"),
                rs.getInt("priority"), rs.getString("platform_name"), rs.getString("shop_name"),
                rs.getString("channel_name"), rs.getString("warehouse_name"),
                rs.getBoolean("auto_handover"), rs.getObject("no_handover_start", LocalTime.class),
                rs.getObject("no_handover_end", LocalTime.class), rs.getString("note"),
                rs.getString("lifecycle_status"), rs.getString("created_by_display_name"),
                rs.getLong("version"), rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                rs.getObject("updated_at", OffsetDateTime.class).toInstant());
    }
}
