package cn.xzkj.erp.settings.general;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.UUID;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class SystemGeneralSettingRepository {
    static final String DEFAULT_CURRENCY = "USD";
    private final NamedParameterJdbcTemplate jdbc;

    SystemGeneralSettingRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    SystemGeneralSettingRecord find(UUID tenantId) {
        return jdbc.queryForObject("""
                select setting.tenant_id is not null as configured,
                       coalesce(setting.default_currency, :defaultCurrency) as default_currency,
                       setting.order_pull_blackout_start,
                       setting.order_pull_blackout_end,
                       coalesce(setting.version, 0) as version,
                       setting.updated_by_display_name,
                       setting.created_at,
                       setting.updated_at
                  from tenants tenant
                  left join tenant_system_general_settings setting
                    on setting.tenant_id = tenant.id
                 where tenant.id = :tenantId
                   and tenant.deleted_at is null
                """, new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("defaultCurrency", DEFAULT_CURRENCY),
                SystemGeneralSettingRepository::map);
    }

    void insert(UUID tenantId, String defaultCurrency, LocalTime start,
            LocalTime end, SystemGeneralSettingService.Actor actor) {
        jdbc.update("""
                insert into tenant_system_general_settings (
                    tenant_id, default_currency,
                    order_pull_blackout_start, order_pull_blackout_end,
                    updated_by_display_name,
                    created_by_user_id, created_by_system_admin_id,
                    updated_by_user_id, updated_by_system_admin_id, request_id
                ) values (
                    :tenantId, :defaultCurrency, :start, :end, :displayName,
                    :userId, :systemAdminId, :userId, :systemAdminId, :requestId
                )
                """, parameters(tenantId, defaultCurrency, start, end, actor));
    }

    boolean update(UUID tenantId, long version, String defaultCurrency,
            LocalTime start, LocalTime end,
            SystemGeneralSettingService.Actor actor) {
        return jdbc.update("""
                update tenant_system_general_settings
                   set default_currency = :defaultCurrency,
                       order_pull_blackout_start = :start,
                       order_pull_blackout_end = :end,
                       updated_by_display_name = :displayName,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId,
                       version = version + 1,
                       updated_at = now()
                 where tenant_id = :tenantId and version = :version
                """, parameters(tenantId, defaultCurrency, start, end, actor)
                .addValue("version", version)) == 1;
    }

    private static MapSqlParameterSource parameters(UUID tenantId,
            String defaultCurrency, LocalTime start, LocalTime end,
            SystemGeneralSettingService.Actor actor) {
        return new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("defaultCurrency", defaultCurrency)
                .addValue("start", start)
                .addValue("end", end)
                .addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId());
    }

    private static SystemGeneralSettingRecord map(ResultSet resultSet, int row)
            throws SQLException {
        return new SystemGeneralSettingRecord(
                resultSet.getBoolean("configured"),
                resultSet.getString("default_currency"),
                resultSet.getObject("order_pull_blackout_start", LocalTime.class),
                resultSet.getObject("order_pull_blackout_end", LocalTime.class),
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
