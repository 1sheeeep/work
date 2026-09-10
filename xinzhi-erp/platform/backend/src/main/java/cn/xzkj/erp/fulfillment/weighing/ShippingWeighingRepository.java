package cn.xzkj.erp.fulfillment.weighing;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.PackagingTemplate;
import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.WeightTolerance;
import cn.xzkj.erp.fulfillment.weighing.ShippingWeighingRecords.PackageWeighing;
import cn.xzkj.erp.fulfillment.weighing.ShippingWeighingRecords.WeighingEvent;

@Repository
public class ShippingWeighingRepository {
    private final JdbcTemplate jdbc;

    public ShippingWeighingRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<PackageWeighing> findPackage(
            UUID tenantId, UUID planId, UUID packageId, boolean forUpdate) {
        String suffix = forUpdate ? " for update" : "";
        return jdbc.query("""
                select plan_id, id, warehouse_id, package_number, status, version,
                       packaging_template_id, packaging_code_snapshot,
                       packaging_name_snapshot, packaging_weight_grams,
                       expected_weight_grams, weight_grams::bigint as actual_weight_grams,
                       allowed_tolerance_grams, weight_difference_grams,
                       weighing_status, weighing_source, shipping_scale_id, weighed_at
                from tenant_fulfillment_packages
                where tenant_id = ? and plan_id = ? and id = ?
                """ + suffix, (rs, row) -> packageWeighing(rs),
                tenantId, planId, packageId).stream().findFirst();
    }

    public Optional<PackagingTemplate> availableTemplate(
            UUID tenantId, UUID warehouseId, UUID templateId) {
        return jdbc.query("""
                select template.id, template.business_code, template.name,
                       template.packaging_type, template.standard_weight_grams,
                       template.length_mm, template.width_mm, template.height_mm,
                       template.status, template.version, template.updated_at
                from tenant_packaging_templates template
                join tenant_warehouse_packaging_availability availability
                  on availability.tenant_id = template.tenant_id
                 and availability.packaging_template_id = template.id
                 and availability.warehouse_id = ? and availability.enabled
                where template.tenant_id = ? and template.id = ?
                  and template.status = 'ACTIVE'
                """, (rs, row) -> new PackagingTemplate(
                        rs.getObject("id", UUID.class), rs.getString("business_code"),
                        rs.getString("name"), rs.getString("packaging_type"),
                        rs.getInt("standard_weight_grams"), integer(rs, "length_mm"),
                        integer(rs, "width_mm"), integer(rs, "height_mm"),
                        rs.getString("status"), rs.getLong("version"),
                        rs.getTimestamp("updated_at").toInstant()),
                warehouseId, tenantId, templateId).stream().findFirst();
    }

    public WeightCalculation calculateItemWeight(
            UUID tenantId, UUID packageId, int packagingWeightGrams) {
        return jdbc.queryForObject("""
                select case when bool_and(sku.standard_weight_grams is not null)
                         then sum(sku.standard_weight_grams * item.quantity)::bigint + ?
                         else null end as expected_weight_grams,
                       bool_and(sku.standard_weight_grams is not null) as complete
                from tenant_fulfillment_package_items item
                join tenant_fulfillment_lines line
                  on line.tenant_id = item.tenant_id
                 and line.id = item.fulfillment_line_id
                join tenant_product_skus sku
                  on sku.tenant_id = line.tenant_id and sku.id = line.sku_id
                where item.tenant_id = ? and item.package_id = ?
                """, (rs, row) -> new WeightCalculation(
                        longValue(rs, "expected_weight_grams"),
                        rs.getBoolean("complete")),
                packagingWeightGrams, tenantId, packageId);
    }

    public void assignPackaging(
            UUID tenantId, UUID planId, UUID packageId, long expectedVersion,
            PackagingTemplate template, WeightCalculation weight) {
        int changed = jdbc.update("""
                update tenant_fulfillment_packages
                set packaging_template_id = ?, packaging_code_snapshot = ?,
                    packaging_name_snapshot = ?, packaging_weight_grams = ?,
                    expected_weight_grams = ?, allowed_tolerance_grams = null,
                    weight_difference_grams = null, weighing_status = ?,
                    weighing_source = null, shipping_scale_id = null,
                    weighed_at = null, weight_grams = null,
                    version = version + 1, updated_at = now()
                where tenant_id = ? and plan_id = ? and id = ?
                  and status = 'DRAFT' and version = ?
                """, template.id(), template.businessCode(), template.name(),
                template.standardWeightGrams(), weight.expectedWeightGrams(),
                weight.complete() ? "PENDING" : "MISSING_WEIGHT",
                tenantId, planId, packageId, expectedVersion);
        if (changed != 1) throw new IllegalStateException("package state conflict");
    }

    public Optional<ScaleIdentity> activeScale(
            UUID tenantId, UUID warehouseId, UUID scaleId) {
        return jdbc.query("""
                select id, device_number
                from tenant_shipping_scales
                where tenant_id = ? and warehouse_id = ? and id = ? and status = 'ACTIVE'
                """, (rs, row) -> new ScaleIdentity(
                        rs.getObject("id", UUID.class), rs.getString("device_number")),
                tenantId, warehouseId, scaleId).stream().findFirst();
    }

    public Optional<WeighingEvent> eventByCommand(UUID tenantId, UUID commandId) {
        return jdbc.query("""
                select id, plan_id, package_id, command_id, scale_id, source, expected_weight_grams,
                       actual_weight_grams, allowed_tolerance_grams,
                       weight_difference_grams, result, override_reason,
                       occurred_at, recorded_at
                from tenant_fulfillment_weighing_events
                where tenant_id = ? and command_id = ?
                """, (rs, row) -> event(rs), tenantId, commandId).stream().findFirst();
    }

    public WeighingEvent record(
            UUID tenantId, UUID planId, UUID packageId, long packageVersion,
            UUID commandId, UUID scaleId, String source, Long expectedWeightGrams,
            long actualWeightGrams, Long allowedToleranceGrams,
            Long differenceGrams, String result, String overrideReason,
            Instant occurredAt, UUID actorUserId, UUID actorSystemAdminId,
            String requestId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into tenant_fulfillment_weighing_events (
                    id, tenant_id, plan_id, package_id, command_id, scale_id,
                    source, expected_weight_grams, actual_weight_grams,
                    allowed_tolerance_grams, weight_difference_grams, result,
                    override_reason, occurred_at, actor_user_id,
                    actor_system_admin_id, request_id
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, id, tenantId, planId, packageId, commandId, scaleId,
                source, expectedWeightGrams, actualWeightGrams,
                allowedToleranceGrams, differenceGrams, result, overrideReason,
                Timestamp.from(occurredAt), actorUserId, actorSystemAdminId, requestId);
        int changed = jdbc.update("""
                update tenant_fulfillment_packages
                set weight_grams = ?, expected_weight_grams = ?,
                    allowed_tolerance_grams = ?, weight_difference_grams = ?,
                    weighing_status = ?, weighing_source = ?, shipping_scale_id = ?,
                    weighed_at = ?, version = version + 1, updated_at = now()
                where tenant_id = ? and plan_id = ? and id = ?
                  and status = 'SEALED' and version = ?
                """, actualWeightGrams, expectedWeightGrams, allowedToleranceGrams,
                differenceGrams, result, source, scaleId, Timestamp.from(occurredAt),
                tenantId, planId, packageId, packageVersion);
        if (changed != 1) throw new IllegalStateException("package state conflict");
        return eventByCommand(tenantId, commandId).orElseThrow();
    }

    public List<WeighingEvent> listEvents(
            UUID tenantId, UUID planId, UUID packageId) {
        return jdbc.query("""
                select id, plan_id, package_id, command_id, scale_id, source, expected_weight_grams,
                       actual_weight_grams, allowed_tolerance_grams,
                       weight_difference_grams, result, override_reason,
                       occurred_at, recorded_at
                from tenant_fulfillment_weighing_events
                where tenant_id = ? and plan_id = ? and package_id = ?
                order by recorded_at desc, id desc
                """, (rs, row) -> event(rs), tenantId, planId, packageId);
    }

    public WeightTolerance effectiveTolerance(UUID tenantId, UUID warehouseId) {
        return jdbc.query("""
                select coalesce(warehouse.tolerance_grams,
                                tenant.tolerance_grams, 30) as tolerance_grams,
                       coalesce(warehouse.tolerance_basis_points,
                                tenant.tolerance_basis_points, 300) as tolerance_basis_points,
                       warehouse.warehouse_id is not null as warehouse_override
                from (select ?::uuid as tenant_id, ?::uuid as warehouse_id) identity
                left join tenant_shipping_weight_settings tenant
                  on tenant.tenant_id = identity.tenant_id
                left join tenant_warehouse_weight_settings warehouse
                  on warehouse.tenant_id = identity.tenant_id
                 and warehouse.warehouse_id = identity.warehouse_id
                """, (rs, row) -> new WeightTolerance(
                        rs.getInt("tolerance_grams"),
                        rs.getInt("tolerance_basis_points"),
                        rs.getBoolean("warehouse_override")),
                tenantId, warehouseId).getFirst();
    }

    private static PackageWeighing packageWeighing(ResultSet rs) throws SQLException {
        return new PackageWeighing(
                rs.getObject("plan_id", UUID.class), rs.getObject("id", UUID.class),
                rs.getObject("warehouse_id", UUID.class), rs.getString("package_number"),
                rs.getString("status"), rs.getLong("version"),
                rs.getObject("packaging_template_id", UUID.class),
                rs.getString("packaging_code_snapshot"),
                rs.getString("packaging_name_snapshot"),
                longValue(rs, "packaging_weight_grams"),
                longValue(rs, "expected_weight_grams"),
                longValue(rs, "actual_weight_grams"),
                longValue(rs, "allowed_tolerance_grams"),
                longValue(rs, "weight_difference_grams"), rs.getString("weighing_status"),
                rs.getString("weighing_source"), rs.getObject("shipping_scale_id", UUID.class),
                timestamp(rs, "weighed_at"));
    }

    private static WeighingEvent event(ResultSet rs) throws SQLException {
        return new WeighingEvent(
                rs.getObject("id", UUID.class), rs.getObject("plan_id", UUID.class),
                rs.getObject("package_id", UUID.class), rs.getObject("command_id", UUID.class),
                rs.getObject("scale_id", UUID.class), rs.getString("source"),
                longValue(rs, "expected_weight_grams"), rs.getLong("actual_weight_grams"),
                longValue(rs, "allowed_tolerance_grams"),
                longValue(rs, "weight_difference_grams"), rs.getString("result"),
                rs.getString("override_reason"), rs.getTimestamp("occurred_at").toInstant(),
                rs.getTimestamp("recorded_at").toInstant());
    }

    private static Long longValue(ResultSet rs, String name) throws SQLException {
        long value = rs.getLong(name);
        return rs.wasNull() ? null : value;
    }

    private static Integer integer(ResultSet rs, String name) throws SQLException {
        int value = rs.getInt(name);
        return rs.wasNull() ? null : value;
    }

    private static Instant timestamp(ResultSet rs, String name) throws SQLException {
        Timestamp value = rs.getTimestamp(name);
        return value == null ? null : value.toInstant();
    }

    public record WeightCalculation(Long expectedWeightGrams, boolean complete) {
    }

    public record ScaleIdentity(UUID id, String deviceNumber) {
    }
}
