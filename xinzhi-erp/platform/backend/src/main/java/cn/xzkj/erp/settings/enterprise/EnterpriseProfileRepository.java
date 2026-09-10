package cn.xzkj.erp.settings.enterprise;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class EnterpriseProfileRepository {
    private final NamedParameterJdbcTemplate jdbc;

    public EnterpriseProfileRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public EnterpriseProfileRecord find(UUID tenantId) {
        return jdbc.queryForObject("""
                select tenant.code as tenant_code, tenant.name as tenant_name,
                       profile.tenant_id is not null as configured,
                       profile.company_name, profile.province, profile.city,
                       profile.district, profile.detailed_address,
                       profile.contact_name, profile.contact_email,
                       profile.contact_qq, profile.contact_mobile,
                       profile.contact_telephone,
                       coalesce(profile.version, 0) as version,
                       profile.created_at, profile.updated_at
                  from tenants tenant
                  left join tenant_enterprise_profiles profile
                    on profile.tenant_id = tenant.id
                 where tenant.id = :tenantId
                   and tenant.deleted_at is null
                """, Map.of("tenantId", tenantId),
                EnterpriseProfileRepository::map);
    }

    public void insert(UUID tenantId, EnterpriseProfileService.ProfileInput input,
            EnterpriseProfileService.Actor actor) {
        jdbc.update("""
                insert into tenant_enterprise_profiles (
                    tenant_id, company_name, province, city, district,
                    detailed_address, contact_name, contact_email, contact_qq,
                    contact_mobile, contact_telephone,
                    created_by_user_id, created_by_system_admin_id,
                    updated_by_user_id, updated_by_system_admin_id, request_id
                ) values (
                    :tenantId, :companyName, :province, :city, :district,
                    :detailedAddress, :contactName, :contactEmail, :contactQq,
                    :contactMobile, :contactTelephone,
                    :userId, :systemAdminId, :userId, :systemAdminId, :requestId
                )
                """, parameters(tenantId, input, actor));
    }

    public boolean update(UUID tenantId, long version,
            EnterpriseProfileService.ProfileInput input,
            EnterpriseProfileService.Actor actor) {
        MapSqlParameterSource parameters = parameters(tenantId, input, actor)
                .addValue("version", version);
        return jdbc.update("""
                update tenant_enterprise_profiles
                   set company_name = :companyName,
                       province = :province, city = :city, district = :district,
                       detailed_address = :detailedAddress,
                       contact_name = :contactName, contact_email = :contactEmail,
                       contact_qq = :contactQq, contact_mobile = :contactMobile,
                       contact_telephone = :contactTelephone,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId,
                       version = version + 1,
                       updated_at = now()
                 where tenant_id = :tenantId and version = :version
                """, parameters) == 1;
    }

    private static MapSqlParameterSource parameters(
            UUID tenantId, EnterpriseProfileService.ProfileInput input,
            EnterpriseProfileService.Actor actor) {
        return new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("companyName", input.companyName())
                .addValue("province", input.province())
                .addValue("city", input.city())
                .addValue("district", input.district())
                .addValue("detailedAddress", input.detailedAddress())
                .addValue("contactName", input.contactName())
                .addValue("contactEmail", input.contactEmail())
                .addValue("contactQq", input.contactQq())
                .addValue("contactMobile", input.contactMobile())
                .addValue("contactTelephone", input.contactTelephone())
                .addValue("userId", actor.userId())
                .addValue("systemAdminId", actor.systemAdminId())
                .addValue("requestId", actor.requestId());
    }

    private static EnterpriseProfileRecord map(ResultSet resultSet, int row)
            throws SQLException {
        return new EnterpriseProfileRecord(
                resultSet.getString("tenant_code"),
                resultSet.getString("tenant_name"),
                resultSet.getBoolean("configured"),
                resultSet.getString("company_name"),
                resultSet.getString("province"),
                resultSet.getString("city"),
                resultSet.getString("district"),
                resultSet.getString("detailed_address"),
                resultSet.getString("contact_name"),
                resultSet.getString("contact_email"),
                resultSet.getString("contact_qq"),
                resultSet.getString("contact_mobile"),
                resultSet.getString("contact_telephone"),
                resultSet.getLong("version"),
                resultSet.getTimestamp("created_at") == null ? null
                        : resultSet.getTimestamp("created_at").toInstant(),
                resultSet.getTimestamp("updated_at") == null ? null
                        : resultSet.getTimestamp("updated_at").toInstant());
    }
}
