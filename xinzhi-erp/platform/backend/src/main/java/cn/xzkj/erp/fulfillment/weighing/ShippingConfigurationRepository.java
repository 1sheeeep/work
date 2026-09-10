package cn.xzkj.erp.fulfillment.weighing;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.PackagingRule;
import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.PackagingTemplate;
import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.ShippingScale;
import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.WarehousePackaging;
import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.WeightTolerance;

@Repository
public class ShippingConfigurationRepository {
    private final JdbcTemplate jdbc;

    public ShippingConfigurationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean skuExists(UUID tenantId, UUID skuId) {
        return count("select count(*) from tenant_product_skus where tenant_id = ? and id = ?",
                tenantId, skuId) == 1;
    }

    public boolean warehouseExists(UUID tenantId, UUID warehouseId) {
        return count("select count(*) from tenant_warehouses where tenant_id = ? and id = ?",
                tenantId, warehouseId) == 1;
    }

    public List<PackagingTemplate> listTemplates(UUID tenantId) {
        return jdbc.query("""
                select id, business_code, name, packaging_type,
                       standard_weight_grams, length_mm, width_mm, height_mm,
                       status, version, updated_at
                from tenant_packaging_templates
                where tenant_id = ?
                order by status, business_code, id
                """, (rs, row) -> template(rs), tenantId);
    }

    public Optional<PackagingTemplate> findTemplate(UUID tenantId, UUID id) {
        return jdbc.query("""
                select id, business_code, name, packaging_type,
                       standard_weight_grams, length_mm, width_mm, height_mm,
                       status, version, updated_at
                from tenant_packaging_templates
                where tenant_id = ? and id = ?
                """, (rs, row) -> template(rs), tenantId, id).stream().findFirst();
    }

    public PackagingTemplate insertTemplate(
            UUID tenantId, String businessCode, String name, String type,
            int weightGrams, Integer lengthMm, Integer widthMm,
            Integer heightMm) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into tenant_packaging_templates (
                    id, tenant_id, business_code, name, packaging_type,
                    standard_weight_grams, length_mm, width_mm, height_mm
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, id, tenantId, businessCode, name, type, weightGrams,
                lengthMm, widthMm, heightMm);
        return findTemplate(tenantId, id).orElseThrow();
    }

    public Optional<PackagingTemplate> updateTemplate(
            UUID tenantId, UUID id, long version, String name, String type,
            int weightGrams, Integer lengthMm, Integer widthMm,
            Integer heightMm, String status) {
        int changed = jdbc.update("""
                update tenant_packaging_templates
                   set name = ?, packaging_type = ?, standard_weight_grams = ?,
                       length_mm = ?, width_mm = ?, height_mm = ?, status = ?,
                       version = version + 1, updated_at = now()
                 where tenant_id = ? and id = ? and version = ?
                """, name, type, weightGrams, lengthMm, widthMm, heightMm,
                status, tenantId, id, version);
        return changed == 1 ? findTemplate(tenantId, id) : Optional.empty();
    }

    public List<WarehousePackaging> listWarehousePackaging(
            UUID tenantId, UUID warehouseId) {
        return jdbc.query("""
                select template.id, template.business_code, template.name,
                       template.packaging_type, template.standard_weight_grams,
                       template.length_mm, template.width_mm, template.height_mm,
                       template.status, template.version, template.updated_at,
                       coalesce(availability.enabled, false) as enabled
                from tenant_packaging_templates template
                left join tenant_warehouse_packaging_availability availability
                  on availability.tenant_id = template.tenant_id
                 and availability.packaging_template_id = template.id
                 and availability.warehouse_id = ?
                where template.tenant_id = ? and template.status <> 'ARCHIVED'
                order by template.business_code, template.id
                """, (rs, row) -> new WarehousePackaging(
                        template(rs), rs.getBoolean("enabled")),
                warehouseId, tenantId);
    }

    public void setWarehousePackaging(
            UUID tenantId, UUID warehouseId, UUID templateId,
            boolean enabled) {
        jdbc.update("""
                insert into tenant_warehouse_packaging_availability (
                    tenant_id, warehouse_id, packaging_template_id, enabled
                ) values (?, ?, ?, ?)
                on conflict (tenant_id, warehouse_id, packaging_template_id)
                do update set enabled = excluded.enabled, updated_at = now()
                """, tenantId, warehouseId, templateId, enabled);
    }

    public List<PackagingRule> listRules(UUID tenantId, UUID skuId) {
        return jdbc.query("""
                select rule.id, rule.sku_id, rule.min_quantity,
                       rule.max_quantity, rule.packaging_template_id,
                       template.business_code, template.name,
                       rule.status, rule.version, rule.updated_at
                from tenant_sku_packaging_rules rule
                join tenant_packaging_templates template
                  on template.tenant_id = rule.tenant_id
                 and template.id = rule.packaging_template_id
                where rule.tenant_id = ? and rule.sku_id = ?
                order by rule.min_quantity, rule.max_quantity, rule.id
                """, (rs, row) -> new PackagingRule(
                        rs.getObject("id", UUID.class),
                        rs.getObject("sku_id", UUID.class),
                        rs.getInt("min_quantity"), rs.getInt("max_quantity"),
                        rs.getObject("packaging_template_id", UUID.class),
                        rs.getString("business_code"), rs.getString("name"),
                        rs.getString("status"), rs.getLong("version"),
                        rs.getTimestamp("updated_at").toInstant()),
                tenantId, skuId);
    }

    public Optional<PackagingRule> findRule(
            UUID tenantId, UUID skuId, UUID ruleId) {
        return listRules(tenantId, skuId).stream()
                .filter(item -> item.id().equals(ruleId))
                .findFirst();
    }

    public boolean overlapsActiveRule(
            UUID tenantId, UUID skuId, int minQuantity, int maxQuantity,
            UUID excludedRuleId) {
        return count("""
                select count(*) from tenant_sku_packaging_rules
                where tenant_id = ? and sku_id = ? and status = 'ACTIVE'
                  and min_quantity <= ? and max_quantity >= ?
                  and (?::uuid is null or id <> ?::uuid)
                """, tenantId, skuId, maxQuantity, minQuantity,
                excludedRuleId, excludedRuleId) > 0;
    }

    public PackagingRule insertRule(
            UUID tenantId, UUID skuId, int minQuantity, int maxQuantity,
            UUID templateId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into tenant_sku_packaging_rules (
                    id, tenant_id, sku_id, min_quantity, max_quantity,
                    packaging_template_id
                ) values (?, ?, ?, ?, ?, ?)
                """, id, tenantId, skuId, minQuantity, maxQuantity, templateId);
        return listRules(tenantId, skuId).stream()
                .filter(item -> item.id().equals(id)).findFirst().orElseThrow();
    }

    public Optional<PackagingRule> updateRule(
            UUID tenantId, UUID skuId, UUID ruleId, long version,
            int minQuantity, int maxQuantity, UUID templateId,
            String status) {
        int changed = jdbc.update("""
                update tenant_sku_packaging_rules
                   set min_quantity = ?, max_quantity = ?,
                       packaging_template_id = ?, status = ?,
                       version = version + 1, updated_at = now()
                 where tenant_id = ? and sku_id = ? and id = ? and version = ?
                """, minQuantity, maxQuantity, templateId, status,
                tenantId, skuId, ruleId, version);
        return changed == 1
                ? findRule(tenantId, skuId, ruleId)
                : Optional.empty();
    }

    public List<ShippingScale> listScales(UUID tenantId, UUID warehouseId) {
        return jdbc.query("""
                select id, warehouse_id, device_number, display_name, status,
                       version, updated_at
                from tenant_shipping_scales
                where tenant_id = ? and warehouse_id = ?
                order by status, display_name, id
                """, (rs, row) -> scale(rs), tenantId, warehouseId);
    }

    public Optional<ShippingScale> findScale(UUID tenantId, UUID id) {
        return jdbc.query("""
                select id, warehouse_id, device_number, display_name, status,
                       version, updated_at
                from tenant_shipping_scales
                where tenant_id = ? and id = ?
                """, (rs, row) -> scale(rs), tenantId, id).stream().findFirst();
    }

    public ShippingScale insertScale(
            UUID tenantId, UUID warehouseId, String deviceNumber,
            String displayName, UUID actorUserId, UUID actorSystemAdminId,
            String requestId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into tenant_shipping_scales (
                    id, tenant_id, warehouse_id, device_number, display_name
                ) values (?, ?, ?, ?, ?)
                """, id, tenantId, warehouseId, deviceNumber, displayName);
        insertScaleEvent(tenantId, id, warehouseId, "BOUND", actorUserId,
                actorSystemAdminId, requestId);
        return findScale(tenantId, id).orElseThrow();
    }

    public Optional<ShippingScale> updateScale(
            UUID tenantId, UUID id, long version, UUID warehouseId,
            String displayName, String status, UUID actorUserId,
            UUID actorSystemAdminId, String requestId) {
        ShippingScale before = findScale(tenantId, id).orElse(null);
        if (before == null) return Optional.empty();
        int changed = jdbc.update("""
                update tenant_shipping_scales
                   set warehouse_id = ?, display_name = ?, status = ?,
                       version = version + 1, updated_at = now()
                 where tenant_id = ? and id = ? and version = ?
                """, warehouseId, displayName, status, tenantId, id, version);
        if (changed != 1) return Optional.empty();
        String eventType = !before.warehouseId().equals(warehouseId)
                ? "MOVED" : ("ACTIVE".equals(status) ? "ENABLED" : "DISABLED");
        insertScaleEvent(tenantId, id, warehouseId, eventType, actorUserId,
                actorSystemAdminId, requestId);
        return findScale(tenantId, id);
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

    public void setTenantTolerance(
            UUID tenantId, int toleranceGrams, int toleranceBasisPoints) {
        jdbc.update("""
                insert into tenant_shipping_weight_settings (
                    tenant_id, tolerance_grams, tolerance_basis_points
                ) values (?, ?, ?)
                on conflict (tenant_id) do update
                   set tolerance_grams = excluded.tolerance_grams,
                       tolerance_basis_points = excluded.tolerance_basis_points,
                       updated_at = now()
                """, tenantId, toleranceGrams, toleranceBasisPoints);
    }

    public void setWarehouseTolerance(
            UUID tenantId, UUID warehouseId, int toleranceGrams,
            int toleranceBasisPoints) {
        jdbc.update("""
                insert into tenant_warehouse_weight_settings (
                    tenant_id, warehouse_id, tolerance_grams,
                    tolerance_basis_points
                ) values (?, ?, ?, ?)
                on conflict (tenant_id, warehouse_id) do update
                   set tolerance_grams = excluded.tolerance_grams,
                       tolerance_basis_points = excluded.tolerance_basis_points,
                       updated_at = now()
                """, tenantId, warehouseId, toleranceGrams,
                toleranceBasisPoints);
    }

    private void insertScaleEvent(
            UUID tenantId, UUID scaleId, UUID warehouseId, String eventType,
            UUID actorUserId, UUID actorSystemAdminId, String requestId) {
        jdbc.update("""
                insert into tenant_shipping_scale_binding_events (
                    tenant_id, scale_id, warehouse_id, event_type,
                    actor_user_id, actor_system_admin_id, request_id
                ) values (?, ?, ?, ?, ?, ?, ?)
                """, tenantId, scaleId, warehouseId, eventType, actorUserId,
                actorSystemAdminId, requestId);
    }

    private long count(String sql, Object... parameters) {
        Long value = jdbc.queryForObject(sql, Long.class, parameters);
        return value == null ? 0 : value;
    }

    private static PackagingTemplate template(java.sql.ResultSet rs)
            throws java.sql.SQLException {
        return new PackagingTemplate(
                rs.getObject("id", UUID.class), rs.getString("business_code"),
                rs.getString("name"), rs.getString("packaging_type"),
                rs.getInt("standard_weight_grams"),
                nullableInteger(rs, "length_mm"),
                nullableInteger(rs, "width_mm"),
                nullableInteger(rs, "height_mm"), rs.getString("status"),
                rs.getLong("version"), rs.getTimestamp("updated_at").toInstant());
    }

    private static ShippingScale scale(java.sql.ResultSet rs)
            throws java.sql.SQLException {
        return new ShippingScale(
                rs.getObject("id", UUID.class),
                rs.getObject("warehouse_id", UUID.class),
                rs.getString("device_number"), rs.getString("display_name"),
                rs.getString("status"), rs.getLong("version"),
                rs.getTimestamp("updated_at").toInstant());
    }

    private static Integer nullableInteger(java.sql.ResultSet rs, String column)
            throws java.sql.SQLException {
        int value = rs.getInt(column);
        return rs.wasNull() ? null : value;
    }
}
