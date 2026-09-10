package cn.xzkj.erp.logistics.trackingnumber;

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
public class TrackingNumberRepository {
    private static final String FROM = """
            from tenant_logistics_tracking_numbers number
            left join tenant_fulfillment_packages package
              on package.tenant_id = number.tenant_id
             and package.id = number.used_package_id
            left join tenant_fulfillment_plans plan
              on plan.tenant_id = number.tenant_id
             and plan.id = number.used_plan_id
            left join tenant_orders orders
              on orders.tenant_id = plan.tenant_id
             and orders.id = plan.order_id
            """;
    private final NamedParameterJdbcTemplate jdbc;

    public TrackingNumberRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Page<TrackingNumberRecord> list(
            UUID tenantId, String type, String usage, String channel,
            String searchField, String keyword, Pageable pageable) {
        String where = where(type, usage, channel, searchField, keyword);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("type", type)
                .addValue("channel", pattern(channel))
                .addValue("keyword", pattern(keyword))
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<TrackingNumberRecord> items = jdbc.query("""
                select number.id, number.import_batch_id, number.tracking_type,
                       number.logistics_channel, number.tracking_reference,
                       case when number.lifecycle_status = 'ARCHIVED' then 'ARCHIVED'
                            when number.used_package_id is null then 'UNUSED'
                            else 'USED' end as status,
                       orders.external_order_ref as order_reference,
                       package.package_number, number.used_at, number.version,
                       number.created_at
                """ + FROM + where
                + " order by number.created_at desc, number.id desc limit :limit offset :offset",
                parameters, TrackingNumberRepository::map);
        Long total = jdbc.queryForObject(
                "select count(*) " + FROM + where, parameters, Long.class);
        return new PageImpl<>(items, pageable, total == null ? 0 : total);
    }

    public void insert(
            UUID id, UUID tenantId, UUID batchId, String type, String channel,
            String reference, UUID userId, UUID systemAdminId, String requestId) {
        jdbc.update("""
                insert into tenant_logistics_tracking_numbers (
                    id, tenant_id, import_batch_id, tracking_type,
                    logistics_channel, tracking_reference, created_by_user_id,
                    created_by_system_admin_id, request_id
                ) values (
                    :id, :tenantId, :batchId, :type, :channel, :reference,
                    :userId, :systemAdminId, :requestId
                )
                """, new MapSqlParameterSource()
                .addValue("id", id).addValue("tenantId", tenantId)
                .addValue("batchId", batchId).addValue("type", type)
                .addValue("channel", channel).addValue("reference", reference)
                .addValue("userId", userId).addValue("systemAdminId", systemAdminId)
                .addValue("requestId", requestId));
    }

    public boolean archive(UUID tenantId, UUID id, long version) {
        return jdbc.update("""
                update tenant_logistics_tracking_numbers
                   set lifecycle_status = 'ARCHIVED', version = version + 1,
                       updated_at = now()
                 where tenant_id = :tenantId and id = :id and version = :version
                   and lifecycle_status = 'ACTIVE' and used_package_id is null
                """, new MapSqlParameterSource()
                .addValue("tenantId", tenantId).addValue("id", id)
                .addValue("version", version)) == 1;
    }

    public TrackingNumberRecord find(UUID tenantId, UUID id) {
        return jdbc.query("""
                select number.id, number.import_batch_id, number.tracking_type,
                       number.logistics_channel, number.tracking_reference,
                       case when number.lifecycle_status = 'ARCHIVED' then 'ARCHIVED'
                            when number.used_package_id is null then 'UNUSED'
                            else 'USED' end as status,
                       orders.external_order_ref as order_reference,
                       package.package_number, number.used_at, number.version,
                       number.created_at
                """ + FROM + " where number.tenant_id = :tenantId and number.id = :id",
                new MapSqlParameterSource().addValue("tenantId", tenantId).addValue("id", id),
                TrackingNumberRepository::map).stream().findFirst().orElse(null);
    }

    private static String where(
            String type, String usage, String channel, String searchField,
            String keyword) {
        StringBuilder where = new StringBuilder(
                " where number.tenant_id = :tenantId");
        if (type != null) where.append(" and number.tracking_type = :type");
        if ("USED".equals(usage)) where.append(" and number.used_package_id is not null");
        if ("UNUSED".equals(usage)) where.append(
                " and number.used_package_id is null and number.lifecycle_status = 'ACTIVE'");
        if ("ARCHIVED".equals(usage)) where.append(
                " and number.lifecycle_status = 'ARCHIVED'");
        if (channel != null) where.append(
                " and lower(number.logistics_channel) like :channel escape '\\'");
        if (keyword != null) where.append("ORDER_NO".equals(searchField)
                ? " and lower(coalesce(orders.external_order_ref, '')) like :keyword escape '\\'"
                : " and lower(number.tracking_reference) like :keyword escape '\\'");
        return where.toString();
    }

    private static String pattern(String value) {
        if (value == null) return null;
        return "%" + value.replace("\\", "\\\\")
                .replace("%", "\\%").replace("_", "\\_") + "%";
    }

    private static TrackingNumberRecord map(ResultSet rs, int row) throws SQLException {
        return new TrackingNumberRecord(
                rs.getObject("id", UUID.class),
                rs.getObject("import_batch_id", UUID.class),
                rs.getString("tracking_type"), rs.getString("logistics_channel"),
                rs.getString("tracking_reference"), rs.getString("status"),
                rs.getString("order_reference"), rs.getString("package_number"),
                instant(rs, "used_at"), rs.getLong("version"),
                instant(rs, "created_at"));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
