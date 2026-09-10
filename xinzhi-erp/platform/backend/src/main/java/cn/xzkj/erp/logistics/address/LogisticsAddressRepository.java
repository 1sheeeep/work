package cn.xzkj.erp.logistics.address;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class LogisticsAddressRepository {
    private static final String SELECT = """
            select id, address_type, name, contact_name, contact_email,
                   country_code, province, city, district, address_line1,
                   postal_code, landline, mobile, company_name, fax,
                   lifecycle_status, version, created_at, updated_at
              from tenant_logistics_addresses
            """;
    private final NamedParameterJdbcTemplate jdbc;

    public LogisticsAddressRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Page<LogisticsAddressRecord> list(
            UUID tenantId, String type, String status, String keyword,
            Pageable pageable) {
        String filter = filter(type, status, keyword);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("type", type)
                .addValue("status", status)
                .addValue("keyword", pattern(keyword))
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<LogisticsAddressRecord> items = jdbc.query(
                SELECT + filter
                        + " order by updated_at desc, id desc limit :limit offset :offset",
                parameters, LogisticsAddressRepository::map);
        Long total = jdbc.queryForObject(
                "select count(*) from tenant_logistics_addresses " + filter,
                parameters, Long.class);
        return new PageImpl<>(items, pageable, total == null ? 0 : total);
    }

    public LogisticsAddressRecord find(UUID tenantId, UUID id) {
        return jdbc.query(SELECT + " where tenant_id = :tenantId and id = :id",
                new MapSqlParameterSource().addValue("tenantId", tenantId)
                        .addValue("id", id),
                LogisticsAddressRepository::map).stream().findFirst().orElse(null);
    }

    public void insert(
            UUID id, UUID tenantId, LogisticsAddressService.AddressInput value,
            UUID userId, UUID systemAdminId, String requestId) {
        jdbc.update("""
                insert into tenant_logistics_addresses (
                    id, tenant_id, address_type, name, contact_name, contact_email,
                    country_code, province, city, district, address_line1,
                    postal_code, landline, mobile, company_name, fax,
                    created_by_user_id, created_by_system_admin_id,
                    updated_by_user_id, updated_by_system_admin_id, request_id
                ) values (
                    :id, :tenantId, :type, :name, :contactName, :contactEmail,
                    :countryCode, :province, :city, :district, :addressLine1,
                    :postalCode, :landline, :mobile, :companyName, :fax,
                    :userId, :systemAdminId, :userId, :systemAdminId, :requestId
                )
                """, parameters(id, tenantId, value, userId, systemAdminId, requestId));
    }

    public boolean update(
            UUID id, UUID tenantId, long version,
            LogisticsAddressService.AddressInput value,
            UUID userId, UUID systemAdminId, String requestId) {
        MapSqlParameterSource parameters = parameters(
                id, tenantId, value, userId, systemAdminId, requestId)
                .addValue("version", version);
        return jdbc.update("""
                update tenant_logistics_addresses
                   set address_type = :type, name = :name,
                       contact_name = :contactName, contact_email = :contactEmail,
                       country_code = :countryCode, province = :province,
                       city = :city, district = :district,
                       address_line1 = :addressLine1, postal_code = :postalCode,
                       landline = :landline, mobile = :mobile,
                       company_name = :companyName, fax = :fax,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, version = version + 1,
                       updated_at = now()
                 where tenant_id = :tenantId and id = :id and version = :version
                   and lifecycle_status = 'ACTIVE'
                """, parameters) == 1;
    }

    public boolean archive(
            UUID tenantId, UUID id, long version,
            UUID userId, UUID systemAdminId, String requestId) {
        return jdbc.update("""
                update tenant_logistics_addresses
                   set lifecycle_status = 'ARCHIVED', version = version + 1,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, updated_at = now()
                 where tenant_id = :tenantId and id = :id and version = :version
                   and lifecycle_status = 'ACTIVE'
                """, new MapSqlParameterSource()
                .addValue("tenantId", tenantId).addValue("id", id)
                .addValue("version", version).addValue("userId", userId)
                .addValue("systemAdminId", systemAdminId)
                .addValue("requestId", requestId)) == 1;
    }

    private static MapSqlParameterSource parameters(
            UUID id, UUID tenantId, LogisticsAddressService.AddressInput value,
            UUID userId, UUID systemAdminId, String requestId) {
        return new MapSqlParameterSource()
                .addValue("id", id).addValue("tenantId", tenantId)
                .addValue("type", value.addressType()).addValue("name", value.name())
                .addValue("contactName", value.contactName())
                .addValue("contactEmail", value.contactEmail())
                .addValue("countryCode", value.countryCode())
                .addValue("province", value.province()).addValue("city", value.city())
                .addValue("district", value.district())
                .addValue("addressLine1", value.addressLine1())
                .addValue("postalCode", value.postalCode())
                .addValue("landline", value.landline()).addValue("mobile", value.mobile())
                .addValue("companyName", value.companyName()).addValue("fax", value.fax())
                .addValue("userId", userId).addValue("systemAdminId", systemAdminId)
                .addValue("requestId", requestId);
    }

    private static String pattern(String value) {
        if (value == null) return null;
        return "%" + value.replace("\\", "\\\\")
                .replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private static String filter(String type, String status, String keyword) {
        StringBuilder filter = new StringBuilder(
                " where tenant_id = :tenantId");
        if (type != null) {
            filter.append(" and address_type = :type");
        }
        if (status != null) {
            filter.append(" and lifecycle_status = :status");
        }
        if (keyword != null) {
            filter.append(" and lower(")
                    .append("name || ' ' || contact_name || ' ' || country_code || ' '")
                    .append(" || coalesce(province, '') || ' ' || coalesce(city, '')")
                    .append(" || ' ' || coalesce(district, '') || ' ' || address_line1")
                    .append(" || ' ' || coalesce(company_name, ''))")
                    .append(" like :keyword escape '\\'");
        }
        return filter.toString();
    }

    private static LogisticsAddressRecord map(ResultSet rs, int row)
            throws SQLException {
        return new LogisticsAddressRecord(
                rs.getObject("id", UUID.class), rs.getString("address_type"),
                rs.getString("name"), rs.getString("contact_name"),
                rs.getString("contact_email"), rs.getString("country_code"),
                rs.getString("province"), rs.getString("city"),
                rs.getString("district"), rs.getString("address_line1"),
                rs.getString("postal_code"), rs.getString("landline"),
                rs.getString("mobile"), rs.getString("company_name"),
                rs.getString("fax"), rs.getString("lifecycle_status"),
                rs.getLong("version"), instant(rs, "created_at"),
                instant(rs, "updated_at"));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        return rs.getObject(column, OffsetDateTime.class).toInstant();
    }
}
