package cn.xzkj.erp.settings.branding;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class EnterpriseBrandingRepository {
    private final NamedParameterJdbcTemplate jdbc;

    EnterpriseBrandingRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    EnterpriseBrandingRecord find(UUID tenantId) {
        return jdbc.queryForObject("""
                select branding.tenant_id is not null as configured,
                       coalesce(branding.watermark_enabled, false) as watermark_enabled,
                       coalesce(branding.watermark_user_name, true) as watermark_user_name,
                       coalesce(branding.watermark_company_name, true) as watermark_company_name,
                       coalesce(branding.watermark_time, true) as watermark_time,
                       coalesce(branding.watermark_phone_suffix, false) as watermark_phone_suffix,
                       coalesce(branding.version, 0) as version,
                       branding.updated_by_display_name, branding.updated_at
                  from tenants tenant
                  left join tenant_enterprise_branding branding
                    on branding.tenant_id = tenant.id
                 where tenant.id = :tenantId and tenant.deleted_at is null
                """, Map.of("tenantId", tenantId), EnterpriseBrandingRepository::map);
    }

    void insertSettings(UUID tenantId, EnterpriseBrandingService.SettingsInput input,
            EnterpriseBrandingService.Actor actor) {
        jdbc.update("""
                insert into tenant_enterprise_branding (
                    tenant_id, watermark_enabled, watermark_user_name,
                    watermark_company_name, watermark_time, watermark_phone_suffix,
                    created_by_display_name, updated_by_display_name,
                    created_by_user_id, created_by_system_admin_id,
                    updated_by_user_id, updated_by_system_admin_id, request_id
                ) values (
                    :tenantId, :enabled, :userName, :companyName, :time, :phoneSuffix,
                    :displayName, :displayName, :userId, :systemAdminId,
                    :userId, :systemAdminId, :requestId
                )
                """, settingsParameters(tenantId, input, actor));
    }

    boolean updateSettings(UUID tenantId, long version,
            EnterpriseBrandingService.SettingsInput input,
            EnterpriseBrandingService.Actor actor) {
        return jdbc.update("""
                update tenant_enterprise_branding
                   set watermark_enabled = :enabled,
                       watermark_user_name = :userName,
                       watermark_company_name = :companyName,
                       watermark_time = :time,
                       watermark_phone_suffix = :phoneSuffix,
                       updated_by_display_name = :displayName,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, version = version + 1,
                       updated_at = now()
                 where tenant_id = :tenantId and version = :version
                """, settingsParameters(tenantId, input, actor)
                .addValue("version", version)) == 1;
    }

    private static MapSqlParameterSource settingsParameters(UUID tenantId,
            EnterpriseBrandingService.SettingsInput input,
            EnterpriseBrandingService.Actor actor) {
        return actorParameters(tenantId, actor)
                .addValue("enabled", input.watermarkEnabled())
                .addValue("userName", input.watermarkUserName())
                .addValue("companyName", input.watermarkCompanyName())
                .addValue("time", input.watermarkTime())
                .addValue("phoneSuffix", input.watermarkPhoneSuffix());
    }

    private static MapSqlParameterSource actorParameters(UUID tenantId,
            EnterpriseBrandingService.Actor actor) {
        return new MapSqlParameterSource("tenantId", tenantId)
                .addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId());
    }

    private static EnterpriseBrandingRecord map(ResultSet resultSet, int row)
            throws SQLException {
        OffsetDateTime updated = resultSet.getObject("updated_at", OffsetDateTime.class);
        return new EnterpriseBrandingRecord(
                resultSet.getBoolean("configured"),
                resultSet.getBoolean("watermark_enabled"),
                resultSet.getBoolean("watermark_user_name"),
                resultSet.getBoolean("watermark_company_name"),
                resultSet.getBoolean("watermark_time"),
                resultSet.getBoolean("watermark_phone_suffix"),
                resultSet.getLong("version"),
                resultSet.getString("updated_by_display_name"),
                updated == null ? null : updated.toInstant());
    }

}
