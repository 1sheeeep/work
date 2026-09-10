package cn.xzkj.erp.settings.deadline;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.UUID;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class ShippingDeadlineSettingRepository {
    static final int DEFAULT_DEADLINE_DAYS = 3;
    private final NamedParameterJdbcTemplate jdbc;

    ShippingDeadlineSettingRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    ShippingDeadlineSettingRecord find(UUID tenantId) {
        return jdbc.queryForObject("""
                select setting.tenant_id is not null as configured,
                       coalesce(setting.deadline_days, :defaultDays) as deadline_days,
                       coalesce(setting.version, 0) as version,
                       setting.updated_by_display_name,
                       setting.created_at, setting.updated_at
                  from tenants tenant
                  left join tenant_shipping_deadline_settings setting
                    on setting.tenant_id = tenant.id
                 where tenant.id = :tenantId
                   and tenant.deleted_at is null
                """, new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("defaultDays", DEFAULT_DEADLINE_DAYS),
                ShippingDeadlineSettingRepository::map);
    }

    int deadlineDays(UUID tenantId) {
        Integer value = jdbc.queryForObject("""
                select coalesce((
                    select setting.deadline_days
                      from tenant_shipping_deadline_settings setting
                     where setting.tenant_id = :tenantId
                ), :defaultDays)
                """, new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("defaultDays", DEFAULT_DEADLINE_DAYS), Integer.class);
        return value == null ? DEFAULT_DEADLINE_DAYS : value;
    }

    void insert(UUID tenantId, int deadlineDays,
            ShippingDeadlineSettingService.Actor actor) {
        jdbc.update("""
                insert into tenant_shipping_deadline_settings (
                    tenant_id, deadline_days, updated_by_display_name,
                    created_by_user_id, created_by_system_admin_id,
                    updated_by_user_id, updated_by_system_admin_id, request_id
                ) values (
                    :tenantId, :deadlineDays, :displayName,
                    :userId, :systemAdminId, :userId, :systemAdminId, :requestId
                )
                """, parameters(tenantId, deadlineDays, actor));
    }

    boolean update(UUID tenantId, long version, int deadlineDays,
            ShippingDeadlineSettingService.Actor actor) {
        return jdbc.update("""
                update tenant_shipping_deadline_settings
                   set deadline_days = :deadlineDays,
                       updated_by_display_name = :displayName,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId,
                       version = version + 1,
                       updated_at = now()
                 where tenant_id = :tenantId and version = :version
                """, parameters(tenantId, deadlineDays, actor)
                .addValue("version", version)) == 1;
    }

    private static MapSqlParameterSource parameters(UUID tenantId,
            int deadlineDays, ShippingDeadlineSettingService.Actor actor) {
        return new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("deadlineDays", deadlineDays)
                .addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId());
    }

    private static ShippingDeadlineSettingRecord map(ResultSet resultSet, int row)
            throws SQLException {
        return new ShippingDeadlineSettingRecord(
                resultSet.getBoolean("configured"),
                resultSet.getInt("deadline_days"),
                resultSet.getLong("version"),
                resultSet.getString("updated_by_display_name"),
                instantOrNull(resultSet, "created_at"),
                instantOrNull(resultSet, "updated_at"));
    }

    private static java.time.Instant instantOrNull(ResultSet resultSet,
            String column) throws SQLException {
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
