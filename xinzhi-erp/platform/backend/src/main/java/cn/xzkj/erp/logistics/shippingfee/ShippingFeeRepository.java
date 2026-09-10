package cn.xzkj.erp.logistics.shippingfee;

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
class ShippingFeeRepository {
    private static final String REGION_SELECT = """
            select id, name, country_code, city, postal_code_prefix, note,
                   lifecycle_status, created_by_display_name, version,
                   created_at, updated_at
              from tenant_shipping_fee_regions region
            """;
    private static final String RULE_SELECT = """
            select rule.id, rule.region_id, region.name as region_name,
                   region.country_code, rule.name,
                   rule.minimum_weight_grams, rule.maximum_weight_grams,
                   rule.base_fee_minor, rule.per_kilogram_fee_minor,
                   rule.other_fee_minor, rule.currency_code, rule.note,
                   rule.lifecycle_status, rule.created_by_display_name,
                   rule.version, rule.created_at, rule.updated_at
              from tenant_shipping_fee_rules rule
              join tenant_shipping_fee_regions region
                on region.tenant_id = rule.tenant_id
               and region.id = rule.region_id
            """;

    private final NamedParameterJdbcTemplate jdbc;

    ShippingFeeRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    Page<ShippingFeeRecords.Region> listRegions(
            UUID tenantId, String status, String keyword, Pageable pageable) {
        String where = " where region.tenant_id = :tenantId"
                + (status == null ? "" : " and region.lifecycle_status = :status")
                + (keyword == null ? "" : " and lower(region.name) like :keyword escape '\\'");
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId).addValue("status", status)
                .addValue("keyword", pattern(keyword))
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<ShippingFeeRecords.Region> items = jdbc.query(
                REGION_SELECT + where
                        + " order by region.updated_at desc, region.id desc"
                        + " limit :limit offset :offset",
                parameters, ShippingFeeRepository::mapRegion);
        Long total = jdbc.queryForObject(
                "select count(*) from tenant_shipping_fee_regions region" + where,
                parameters, Long.class);
        return new PageImpl<>(items, pageable, total == null ? 0 : total);
    }

    Page<ShippingFeeRecords.Rule> listRules(
            UUID tenantId, String status, String regionKeyword,
            String ruleKeyword, Pageable pageable) {
        String where = " where rule.tenant_id = :tenantId"
                + (status == null ? "" : " and rule.lifecycle_status = :status")
                + (regionKeyword == null ? "" : " and lower(region.name) like :regionKeyword escape '\\'")
                + (ruleKeyword == null ? "" : " and lower(rule.name) like :ruleKeyword escape '\\'");
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId).addValue("status", status)
                .addValue("regionKeyword", pattern(regionKeyword))
                .addValue("ruleKeyword", pattern(ruleKeyword))
                .addValue("limit", pageable.getPageSize())
                .addValue("offset", pageable.getOffset());
        List<ShippingFeeRecords.Rule> items = jdbc.query(
                RULE_SELECT + where
                        + " order by rule.updated_at desc, rule.id desc"
                        + " limit :limit offset :offset",
                parameters, ShippingFeeRepository::mapRule);
        Long total = jdbc.queryForObject(
                "select count(*) from tenant_shipping_fee_rules rule"
                        + " join tenant_shipping_fee_regions region"
                        + " on region.tenant_id = rule.tenant_id"
                        + " and region.id = rule.region_id" + where,
                parameters, Long.class);
        return new PageImpl<>(items, pageable, total == null ? 0 : total);
    }

    ShippingFeeRecords.Region findRegion(UUID tenantId, UUID id) {
        return jdbc.query(REGION_SELECT
                        + " where region.tenant_id = :tenantId and region.id = :id",
                Map.of("tenantId", tenantId, "id", id),
                ShippingFeeRepository::mapRegion).stream().findFirst().orElse(null);
    }

    ShippingFeeRecords.Rule findRule(UUID tenantId, UUID id) {
        return jdbc.query(RULE_SELECT
                        + " where rule.tenant_id = :tenantId and rule.id = :id",
                Map.of("tenantId", tenantId, "id", id),
                ShippingFeeRepository::mapRule).stream().findFirst().orElse(null);
    }

    void insertRegion(
            UUID id, UUID tenantId, ShippingFeeService.RegionInput value,
            ShippingFeeService.Actor actor) {
        jdbc.update("""
                insert into tenant_shipping_fee_regions (
                    id, tenant_id, name, country_code, city,
                    postal_code_prefix, note, created_by_display_name,
                    created_by_user_id, created_by_system_admin_id,
                    updated_by_user_id, updated_by_system_admin_id, request_id
                ) values (
                    :id, :tenantId, :name, :countryCode, :city,
                    :postalCodePrefix, :note, :displayName,
                    :userId, :systemAdminId, :userId, :systemAdminId, :requestId
                )
                """, actorParameters(id, tenantId, actor)
                .addValue("name", value.name())
                .addValue("countryCode", value.countryCode())
                .addValue("city", value.city())
                .addValue("postalCodePrefix", value.postalCodePrefix())
                .addValue("note", value.note()));
    }

    void insertRule(
            UUID id, UUID tenantId, ShippingFeeService.RuleInput value,
            ShippingFeeService.Actor actor) {
        jdbc.update("""
                insert into tenant_shipping_fee_rules (
                    id, tenant_id, region_id, name, minimum_weight_grams,
                    maximum_weight_grams, base_fee_minor,
                    per_kilogram_fee_minor, other_fee_minor, currency_code,
                    note, created_by_display_name, created_by_user_id,
                    created_by_system_admin_id, updated_by_user_id,
                    updated_by_system_admin_id, request_id
                ) values (
                    :id, :tenantId, :regionId, :name, :minimumWeightGrams,
                    :maximumWeightGrams, :baseFeeMinor,
                    :perKilogramFeeMinor, :otherFeeMinor, :currencyCode,
                    :note, :displayName, :userId, :systemAdminId,
                    :userId, :systemAdminId, :requestId
                )
                """, actorParameters(id, tenantId, actor)
                .addValue("regionId", value.regionId())
                .addValue("name", value.name())
                .addValue("minimumWeightGrams", value.minimumWeightGrams())
                .addValue("maximumWeightGrams", value.maximumWeightGrams())
                .addValue("baseFeeMinor", value.baseFeeMinor())
                .addValue("perKilogramFeeMinor", value.perKilogramFeeMinor())
                .addValue("otherFeeMinor", value.otherFeeMinor())
                .addValue("currencyCode", value.currencyCode())
                .addValue("note", value.note()));
    }

    boolean archiveRegion(
            UUID tenantId, UUID id, long version, ShippingFeeService.Actor actor) {
        return jdbc.update("""
                update tenant_shipping_fee_regions
                   set lifecycle_status = 'ARCHIVED', version = version + 1,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, updated_at = now()
                 where tenant_id = :tenantId and id = :id
                   and version = :version and lifecycle_status = 'ACTIVE'
                """, actorParameters(id, tenantId, actor)
                .addValue("version", version)) == 1;
    }

    int archiveRulesForRegion(
            UUID tenantId, UUID regionId, ShippingFeeService.Actor actor) {
        return jdbc.update("""
                update tenant_shipping_fee_rules
                   set lifecycle_status = 'ARCHIVED', version = version + 1,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, updated_at = now()
                 where tenant_id = :tenantId and region_id = :id
                   and lifecycle_status = 'ACTIVE'
                """, actorParameters(regionId, tenantId, actor));
    }

    boolean archiveRule(
            UUID tenantId, UUID id, long version, ShippingFeeService.Actor actor) {
        return jdbc.update("""
                update tenant_shipping_fee_rules
                   set lifecycle_status = 'ARCHIVED', version = version + 1,
                       updated_by_user_id = :userId,
                       updated_by_system_admin_id = :systemAdminId,
                       request_id = :requestId, updated_at = now()
                 where tenant_id = :tenantId and id = :id
                   and version = :version and lifecycle_status = 'ACTIVE'
                """, actorParameters(id, tenantId, actor)
                .addValue("version", version)) == 1;
    }

    List<ShippingFeeRecords.Rule> estimateCandidates(
            UUID tenantId, String countryCode, String city,
            String postalCode, long weightGrams) {
        String where = " where rule.tenant_id = :tenantId"
                + " and rule.lifecycle_status = 'ACTIVE'"
                + " and region.lifecycle_status = 'ACTIVE'"
                + " and region.country_code = :countryCode"
                + " and (region.city is null"
                + (city == null ? "" : " or lower(region.city) = :city") + ")"
                + " and (region.postal_code_prefix is null"
                + (postalCode == null ? "" : " or :postalCode like lower(region.postal_code_prefix) || '%'") + ")"
                + " and rule.minimum_weight_grams <= :weightGrams"
                + " and (rule.maximum_weight_grams is null"
                + " or rule.maximum_weight_grams >= :weightGrams)";
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("countryCode", countryCode)
                .addValue("city", city == null ? null : city.toLowerCase())
                .addValue("postalCode", postalCode == null ? null : postalCode.toLowerCase())
                .addValue("weightGrams", weightGrams);
        return jdbc.query(RULE_SELECT + where
                        + " order by rule.base_fee_minor, rule.id limit 100",
                parameters, ShippingFeeRepository::mapRule);
    }

    private static MapSqlParameterSource actorParameters(
            UUID id, UUID tenantId, ShippingFeeService.Actor actor) {
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

    private static ShippingFeeRecords.Region mapRegion(
            ResultSet rs, int row) throws SQLException {
        return new ShippingFeeRecords.Region(
                rs.getObject("id", UUID.class), rs.getString("name"),
                rs.getString("country_code"), rs.getString("city"),
                rs.getString("postal_code_prefix"), rs.getString("note"),
                rs.getString("lifecycle_status"),
                rs.getString("created_by_display_name"), rs.getLong("version"),
                rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                rs.getObject("updated_at", OffsetDateTime.class).toInstant());
    }

    private static ShippingFeeRecords.Rule mapRule(
            ResultSet rs, int row) throws SQLException {
        Number maximum = (Number) rs.getObject("maximum_weight_grams");
        return new ShippingFeeRecords.Rule(
                rs.getObject("id", UUID.class),
                rs.getObject("region_id", UUID.class),
                rs.getString("region_name"), rs.getString("country_code"),
                rs.getString("name"), rs.getLong("minimum_weight_grams"),
                maximum == null ? null : maximum.longValue(),
                rs.getLong("base_fee_minor"),
                rs.getLong("per_kilogram_fee_minor"),
                rs.getLong("other_fee_minor"), rs.getString("currency_code"),
                rs.getString("note"), rs.getString("lifecycle_status"),
                rs.getString("created_by_display_name"), rs.getLong("version"),
                rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                rs.getObject("updated_at", OffsetDateTime.class).toInstant());
    }
}
