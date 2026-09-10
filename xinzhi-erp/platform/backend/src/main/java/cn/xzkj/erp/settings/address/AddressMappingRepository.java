package cn.xzkj.erp.settings.address;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class AddressMappingRepository {
    private final NamedParameterJdbcTemplate jdbc;

    AddressMappingRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    AddressMappingSettingRecord findSetting(UUID tenantId) {
        return jdbc.queryForObject("""
                select setting.tenant_id is not null as configured,
                       coalesce(setting.enabled, false) as enabled,
                       coalesce(setting.version, 0) as version,
                       setting.updated_by_display_name,
                       setting.created_at, setting.updated_at
                  from tenants tenant
                  left join tenant_address_mapping_settings setting
                    on setting.tenant_id = tenant.id
                 where tenant.id = :tenantId and tenant.deleted_at is null
                """, new MapSqlParameterSource("tenantId", tenantId),
                AddressMappingRepository::mapSetting);
    }

    void insertSetting(UUID tenantId, boolean enabled,
            AddressMappingService.Actor actor) {
        jdbc.update("""
                insert into tenant_address_mapping_settings (
                    tenant_id, enabled, updated_by_display_name,
                    created_by_user_id, created_by_system_admin_id,
                    updated_by_user_id, updated_by_system_admin_id, request_id
                ) values (
                    :tenantId, :enabled, :displayName, :userId, :systemAdminId,
                    :userId, :systemAdminId, :requestId
                )
                """, actorParameters(tenantId, actor)
                .addValue("enabled", enabled));
    }

    boolean updateSetting(UUID tenantId, long version, boolean enabled,
            AddressMappingService.Actor actor) {
        return jdbc.update("""
                update tenant_address_mapping_settings
                   set enabled = :enabled,
                       updated_by_display_name = :displayName,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId,
                       version = version + 1,
                       updated_at = now()
                 where tenant_id = :tenantId and version = :version
                """, actorParameters(tenantId, actor)
                .addValue("enabled", enabled)
                .addValue("version", version)) == 1;
    }

    AddressMappingService.MappingPage list(UUID tenantId,
            AddressMappingService.MappingQuery query) {
        StringBuilder where = new StringBuilder("""
                 where tenant_id = :tenantId and deleted_at is null
                """);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("limit", query.size())
                .addValue("offset", query.page() * query.size());
        if (query.platform() != null) {
            where.append(" and platform = :platform");
            parameters.addValue("platform", query.platform().name());
        }
        if (query.countryCode() != null) {
            where.append(" and country_code = :countryCode");
            parameters.addValue("countryCode", query.countryCode());
        }
        if (query.addressType() != null) {
            where.append(" and address_type = :addressType");
            parameters.addValue("addressType", query.addressType().name());
        }
        if (query.keyword() != null) {
            where.append(" and (source_key like :keyword or lower(mapped_value) like :keyword)");
            parameters.addValue("keyword", "%" + query.keyword().toLowerCase(java.util.Locale.ROOT) + "%");
        }
        long total = jdbc.queryForObject(
                "select count(*) from tenant_address_mappings" + where,
                parameters, Long.class);
        List<AddressMappingRecord> items = jdbc.query("""
                select id, platform, country_code, address_type,
                       source_value, mapped_value, enabled, version,
                       updated_by_display_name, created_at, updated_at
                  from tenant_address_mappings
                """ + where + " order by updated_at desc, id limit :limit offset :offset",
                parameters, AddressMappingRepository::mapMapping);
        return new AddressMappingService.MappingPage(items, query.page(),
                query.size(), total);
    }

    Optional<AddressMappingRecord> find(UUID tenantId, UUID id) {
        return jdbc.query("""
                select id, platform, country_code, address_type,
                       source_value, mapped_value, enabled, version,
                       updated_by_display_name, created_at, updated_at
                  from tenant_address_mappings
                 where tenant_id = :tenantId and id = :id and deleted_at is null
                """, new MapSqlParameterSource()
                .addValue("tenantId", tenantId).addValue("id", id),
                AddressMappingRepository::mapMapping).stream().findFirst();
    }

    void insert(UUID tenantId, UUID id, AddressMappingService.MappingInput input,
            String sourceKey, AddressMappingService.Actor actor) {
        jdbc.update("""
                insert into tenant_address_mappings (
                    id, tenant_id, platform, country_code, address_type,
                    source_value, source_key, mapped_value, enabled,
                    updated_by_display_name,
                    created_by_user_id, created_by_system_admin_id,
                    updated_by_user_id, updated_by_system_admin_id, request_id
                ) values (
                    :id, :tenantId, :platform, :countryCode, :addressType,
                    :sourceValue, :sourceKey, :mappedValue, :enabled,
                    :displayName, :userId, :systemAdminId,
                    :userId, :systemAdminId, :requestId
                )
                """, mappingParameters(tenantId, input, sourceKey, actor)
                .addValue("id", id));
    }

    boolean update(UUID tenantId, UUID id, long version,
            AddressMappingService.MappingInput input, String sourceKey,
            AddressMappingService.Actor actor) {
        return jdbc.update("""
                update tenant_address_mappings
                   set platform = :platform,
                       country_code = :countryCode,
                       address_type = :addressType,
                       source_value = :sourceValue,
                       source_key = :sourceKey,
                       mapped_value = :mappedValue,
                       enabled = :enabled,
                       updated_by_display_name = :displayName,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId,
                       version = version + 1,
                       updated_at = now()
                 where tenant_id = :tenantId and id = :id
                   and version = :version and deleted_at is null
                """, mappingParameters(tenantId, input, sourceKey, actor)
                .addValue("id", id).addValue("version", version)) == 1;
    }

    boolean delete(UUID tenantId, UUID id, long version,
            AddressMappingService.Actor actor) {
        return jdbc.update("""
                update tenant_address_mappings
                   set deleted_at = now(), updated_at = now(),
                       updated_by_display_name = :displayName,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId,
                       version = version + 1
                 where tenant_id = :tenantId and id = :id
                   and version = :version and deleted_at is null
                """, actorParameters(tenantId, actor)
                .addValue("id", id).addValue("version", version)) == 1;
    }

    Optional<String> resolve(UUID tenantId,
            AddressMappingService.Platform platform, String countryCode,
            AddressMappingService.AddressType addressType, String sourceKey) {
        return jdbc.query("""
                select mapping.mapped_value
                  from tenant_address_mappings mapping
                  join tenant_address_mapping_settings setting
                    on setting.tenant_id = mapping.tenant_id and setting.enabled
                 where mapping.tenant_id = :tenantId
                   and mapping.platform = :platform
                   and mapping.country_code = :countryCode
                   and mapping.address_type = :addressType
                   and mapping.source_key = :sourceKey
                   and mapping.enabled and mapping.deleted_at is null
                 limit 1
                """, new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("platform", platform.name())
                .addValue("countryCode", countryCode)
                .addValue("addressType", addressType.name())
                .addValue("sourceKey", sourceKey),
                (resultSet, row) -> resultSet.getString("mapped_value"))
                .stream().findFirst();
    }

    private static MapSqlParameterSource mappingParameters(UUID tenantId,
            AddressMappingService.MappingInput input, String sourceKey,
            AddressMappingService.Actor actor) {
        return actorParameters(tenantId, actor)
                .addValue("platform", input.platform().name())
                .addValue("countryCode", input.countryCode())
                .addValue("addressType", input.addressType().name())
                .addValue("sourceValue", input.sourceValue())
                .addValue("sourceKey", sourceKey)
                .addValue("mappedValue", input.mappedValue())
                .addValue("enabled", input.enabled());
    }

    private static MapSqlParameterSource actorParameters(UUID tenantId,
            AddressMappingService.Actor actor) {
        return new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("displayName", actor.displayName())
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId());
    }

    private static AddressMappingSettingRecord mapSetting(ResultSet resultSet,
            int row) throws SQLException {
        return new AddressMappingSettingRecord(
                resultSet.getBoolean("configured"),
                resultSet.getBoolean("enabled"),
                resultSet.getLong("version"),
                resultSet.getString("updated_by_display_name"),
                instantOrNull(resultSet, "created_at"),
                instantOrNull(resultSet, "updated_at"));
    }

    private static AddressMappingRecord mapMapping(ResultSet resultSet,
            int row) throws SQLException {
        return new AddressMappingRecord(
                resultSet.getObject("id", UUID.class),
                AddressMappingService.Platform.valueOf(resultSet.getString("platform")),
                resultSet.getString("country_code"),
                AddressMappingService.AddressType.valueOf(resultSet.getString("address_type")),
                resultSet.getString("source_value"),
                resultSet.getString("mapped_value"),
                resultSet.getBoolean("enabled"),
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
