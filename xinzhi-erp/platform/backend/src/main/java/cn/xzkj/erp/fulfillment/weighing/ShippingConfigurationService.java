package cn.xzkj.erp.fulfillment.weighing;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.PackagingRule;
import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.PackagingTemplate;
import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.ShippingScale;
import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.WarehousePackaging;
import cn.xzkj.erp.fulfillment.weighing.ShippingConfigurationRecords.WeightTolerance;
import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;

@Service
public class ShippingConfigurationService {
    private static final String PACKAGING_TEMPLATE_CREATED =
            "shipping.packaging_template.created";
    private static final String PACKAGING_TEMPLATE_UPDATED =
            "shipping.packaging_template.updated";
    private static final String PACKAGING_RULE_CREATED =
            "shipping.sku_packaging_rule.created";
    private static final String PACKAGING_RULE_UPDATED =
            "shipping.sku_packaging_rule.updated";
    private static final String WAREHOUSE_PACKAGING_UPDATED =
            "shipping.warehouse_packaging.updated";
    private static final String SCALE_CREATED = "shipping.scale.created";
    private static final String SCALE_UPDATED = "shipping.scale.updated";
    private static final String WEIGHT_TOLERANCE_UPDATED =
            "shipping.weight_tolerance.updated";
    private final ShippingConfigurationRepository repository;
    private final SecurityAuditRecorder auditRecorder;

    public ShippingConfigurationService(
            ShippingConfigurationRepository repository,
            SecurityAuditRecorder auditRecorder) {
        this.repository = repository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public List<PackagingTemplate> listTemplates(UUID tenantId) {
        requireTenant(tenantId);
        return repository.listTemplates(tenantId);
    }

    @Transactional
    public PackagingTemplate createTemplate(
            Actor actor, String businessCode, String name, String type,
            int weightGrams, Integer lengthMm, Integer widthMm,
            Integer heightMm) {
        requireActor(actor);
        String code = requiredCode(businessCode);
        String normalizedName = requiredName(name);
        String normalizedType = packagingType(type);
        requireWeight(weightGrams);
        requireDimensions(lengthMm, widthMm, heightMm);
        try {
            PackagingTemplate created = repository.insertTemplate(
                    actor.tenantId(), code, normalizedName, normalizedType,
                    weightGrams, lengthMm, widthMm, heightMm);
            audit(actor, PACKAGING_TEMPLATE_CREATED,
                    "packaging_template", created.id(), Map.of(
                            "businessCode", created.businessCode(),
                            "status", created.status()));
            return created;
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("Packaging template already exists");
        }
    }

    @Transactional
    public PackagingTemplate updateTemplate(
            Actor actor, UUID id, long version, String name, String type,
            int weightGrams, Integer lengthMm, Integer widthMm,
            Integer heightMm, String status) {
        requireActor(actor);
        if (id == null || version < 0) throw new IllegalArgumentException("Template is invalid");
        String normalizedName = requiredName(name);
        String normalizedType = packagingType(type);
        String normalizedStatus = templateStatus(status);
        requireWeight(weightGrams);
        requireDimensions(lengthMm, widthMm, heightMm);
        PackagingTemplate updated = repository.updateTemplate(
                actor.tenantId(), id, version, normalizedName, normalizedType,
                weightGrams, lengthMm, widthMm, heightMm, normalizedStatus)
                .orElseThrow(() -> new ConflictException(
                        "Packaging template version changed"));
        audit(actor, PACKAGING_TEMPLATE_UPDATED,
                "packaging_template", updated.id(), Map.of(
                        "version", Long.toString(updated.version()),
                        "status", updated.status()));
        return updated;
    }

    @Transactional(readOnly = true)
    public List<PackagingRule> listRules(UUID tenantId, UUID skuId) {
        requireTenant(tenantId);
        requireSku(tenantId, skuId);
        return repository.listRules(tenantId, skuId);
    }

    @Transactional
    public PackagingRule createRule(
            Actor actor, UUID skuId, int minQuantity, int maxQuantity,
            UUID templateId) {
        requireActor(actor);
        requireSku(actor.tenantId(), skuId);
        PackagingTemplate template = repository.findTemplate(actor.tenantId(), templateId)
                .filter(item -> "ACTIVE".equals(item.status()))
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Active packaging template was not found"));
        if (minQuantity < 1 || maxQuantity < minQuantity || maxQuantity > 999999) {
            throw new IllegalArgumentException("Packaging quantity range is invalid");
        }
        if (repository.overlapsActiveRule(
                actor.tenantId(), skuId, minQuantity, maxQuantity, null)) {
            throw new ConflictException("Packaging quantity range overlaps an active rule");
        }
        PackagingRule created;
        try {
            created = repository.insertRule(
                    actor.tenantId(), skuId, minQuantity, maxQuantity,
                    template.id());
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("Packaging quantity range already exists");
        }
        audit(actor, PACKAGING_RULE_CREATED,
                "sku_packaging_rule", created.id(), Map.of(
                        "skuId", skuId.toString(),
                        "quantityRange", minQuantity + "-" + maxQuantity,
                        "templateId", templateId.toString()));
        return created;
    }

    @Transactional
    public PackagingRule updateRule(
            Actor actor, UUID skuId, UUID ruleId, long version,
            int minQuantity, int maxQuantity, UUID templateId,
            String status) {
        requireActor(actor);
        requireSku(actor.tenantId(), skuId);
        if (ruleId == null || version < 0) {
            throw new IllegalArgumentException("Packaging rule is invalid");
        }
        PackagingRule current = repository.findRule(
                        actor.tenantId(), skuId, ruleId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Packaging rule was not found"));
        if (minQuantity < 1 || maxQuantity < minQuantity
                || maxQuantity > 999999) {
            throw new IllegalArgumentException(
                    "Packaging quantity range is invalid");
        }
        String normalizedStatus = ruleStatus(status);
        PackagingTemplate template = repository.findTemplate(
                        actor.tenantId(), templateId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Packaging template was not found"));
        if ("ACTIVE".equals(normalizedStatus)
                && !"ACTIVE".equals(template.status())) {
            throw new ConflictException(
                    "Active packaging rule requires an active template");
        }
        if ("ACTIVE".equals(normalizedStatus)
                && repository.overlapsActiveRule(actor.tenantId(), skuId,
                        minQuantity, maxQuantity, ruleId)) {
            throw new ConflictException(
                    "Packaging quantity range overlaps an active rule");
        }
        PackagingRule updated;
        try {
            updated = repository.updateRule(actor.tenantId(), skuId, ruleId,
                            version, minQuantity, maxQuantity, template.id(),
                            normalizedStatus)
                    .orElseThrow(() -> new ConflictException(
                            "Packaging rule version changed"));
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException(
                    "Packaging quantity range already exists");
        }
        audit(actor, PACKAGING_RULE_UPDATED, "sku_packaging_rule",
                updated.id(), Map.of(
                        "skuId", skuId.toString(),
                        "quantityRange", minQuantity + "-" + maxQuantity,
                        "templateId", templateId.toString(),
                        "status", normalizedStatus,
                        "previousVersion", Long.toString(current.version())));
        return updated;
    }

    @Transactional(readOnly = true)
    public List<WarehousePackaging> listWarehousePackaging(
            UUID tenantId, UUID warehouseId) {
        requireTenant(tenantId);
        requireWarehouse(tenantId, warehouseId);
        return repository.listWarehousePackaging(tenantId, warehouseId);
    }

    @Transactional
    public List<WarehousePackaging> setWarehousePackaging(
            Actor actor, UUID warehouseId, UUID templateId, boolean enabled) {
        requireActor(actor);
        requireWarehouse(actor.tenantId(), warehouseId);
        repository.findTemplate(actor.tenantId(), templateId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Packaging template was not found"));
        repository.setWarehousePackaging(
                actor.tenantId(), warehouseId, templateId, enabled);
        audit(actor, WAREHOUSE_PACKAGING_UPDATED,
                "warehouse", warehouseId, Map.of(
                        "templateId", templateId.toString(),
                        "enabled", Boolean.toString(enabled)));
        return repository.listWarehousePackaging(actor.tenantId(), warehouseId);
    }

    @Transactional(readOnly = true)
    public List<ShippingScale> listScales(UUID tenantId, UUID warehouseId) {
        requireTenant(tenantId);
        requireWarehouse(tenantId, warehouseId);
        return repository.listScales(tenantId, warehouseId);
    }

    @Transactional
    public ShippingScale createScale(
            Actor actor, UUID warehouseId, String deviceNumber,
            String displayName) {
        requireActor(actor);
        requireWarehouse(actor.tenantId(), warehouseId);
        String number = requiredDeviceNumber(deviceNumber);
        String name = requiredName(displayName);
        try {
            ShippingScale created = repository.insertScale(
                    actor.tenantId(), warehouseId, number, name,
                    actor.userId(), actor.systemAdminId(), actor.requestId());
            audit(actor, SCALE_CREATED, "shipping_scale", created.id(),
                    Map.of("warehouseId", warehouseId.toString(),
                            "deviceNumber", number));
            return created;
        } catch (DataIntegrityViolationException exception) {
            throw new ConflictException("Shipping scale device number already exists");
        }
    }

    @Transactional
    public ShippingScale updateScale(
            Actor actor, UUID id, long version, UUID warehouseId,
            String displayName, String status) {
        requireActor(actor);
        requireWarehouse(actor.tenantId(), warehouseId);
        if (id == null || version < 0) throw new IllegalArgumentException("Scale is invalid");
        ShippingScale updated = repository.updateScale(
                actor.tenantId(), id, version, warehouseId,
                requiredName(displayName), scaleStatus(status), actor.userId(),
                actor.systemAdminId(), actor.requestId())
                .orElseThrow(() -> new ConflictException(
                        "Shipping scale version changed"));
        audit(actor, SCALE_UPDATED, "shipping_scale", updated.id(),
                Map.of("warehouseId", warehouseId.toString(),
                        "status", updated.status(),
                        "version", Long.toString(updated.version())));
        return updated;
    }

    @Transactional(readOnly = true)
    public WeightTolerance getTolerance(UUID tenantId, UUID warehouseId) {
        requireTenant(tenantId);
        requireWarehouse(tenantId, warehouseId);
        return repository.effectiveTolerance(tenantId, warehouseId);
    }

    @Transactional
    public WeightTolerance setWarehouseTolerance(
            Actor actor, UUID warehouseId, int toleranceGrams,
            int toleranceBasisPoints) {
        requireActor(actor);
        requireWarehouse(actor.tenantId(), warehouseId);
        requireTolerance(toleranceGrams, toleranceBasisPoints);
        repository.setWarehouseTolerance(actor.tenantId(), warehouseId,
                toleranceGrams, toleranceBasisPoints);
        audit(actor, WEIGHT_TOLERANCE_UPDATED, "warehouse",
                warehouseId, Map.of(
                        "toleranceGrams", Integer.toString(toleranceGrams),
                        "toleranceBasisPoints", Integer.toString(toleranceBasisPoints)));
        return repository.effectiveTolerance(actor.tenantId(), warehouseId);
    }

    private void requireSku(UUID tenantId, UUID skuId) {
        if (skuId == null || !repository.skuExists(tenantId, skuId)) {
            throw new ResourceNotFoundException("SKU was not found");
        }
    }

    private void requireWarehouse(UUID tenantId, UUID warehouseId) {
        if (warehouseId == null || !repository.warehouseExists(tenantId, warehouseId)) {
            throw new ResourceNotFoundException("Warehouse was not found");
        }
    }

    private void audit(
            Actor actor, String action, String resourceType, UUID resourceId,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(), action,
                resourceType, resourceId.toString(), actor.requestId(),
                actor.sourceIp(), details));
    }

    private static void requireActor(Actor actor) {
        if (actor == null) throw new IllegalArgumentException("Actor is required");
        requireTenant(actor.tenantId());
        if ((actor.userId() == null) == (actor.systemAdminId() == null)
                || actor.requestId() == null || actor.requestId().isBlank()) {
            throw new IllegalArgumentException("Actor identity is invalid");
        }
    }

    private static void requireTenant(UUID tenantId) {
        if (tenantId == null) throw new IllegalArgumentException("Tenant is required");
    }

    private static String requiredCode(String value) {
        String normalized = value == null ? "" : value.strip().toUpperCase(Locale.ROOT);
        if (!normalized.matches("^[A-Z][A-Z0-9_-]{1,63}$")) {
            throw new IllegalArgumentException("Packaging code is invalid");
        }
        return normalized;
    }

    private static String requiredDeviceNumber(String value) {
        String normalized = value == null ? "" : value.strip();
        if (!normalized.matches("^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")) {
            throw new IllegalArgumentException("Scale device number is invalid");
        }
        return normalized;
    }

    private static String requiredName(String value) {
        String normalized = value == null ? "" : value.strip();
        if (normalized.isEmpty() || normalized.length() > 160) {
            throw new IllegalArgumentException("Name is invalid");
        }
        return normalized;
    }

    private static String packagingType(String value) {
        String normalized = value == null ? "" : value.strip().toUpperCase(Locale.ROOT);
        if (!List.of("BOX", "MAILER", "BAG", "OTHER").contains(normalized)) {
            throw new IllegalArgumentException("Packaging type is invalid");
        }
        return normalized;
    }

    private static String templateStatus(String value) {
        String normalized = value == null ? "" : value.strip().toUpperCase(Locale.ROOT);
        if (!List.of("ACTIVE", "INACTIVE", "ARCHIVED").contains(normalized)) {
            throw new IllegalArgumentException("Packaging status is invalid");
        }
        return normalized;
    }

    private static String scaleStatus(String value) {
        String normalized = value == null ? "" : value.strip().toUpperCase(Locale.ROOT);
        if (!List.of("ACTIVE", "INACTIVE").contains(normalized)) {
            throw new IllegalArgumentException("Scale status is invalid");
        }
        return normalized;
    }

    private static String ruleStatus(String value) {
        String normalized = value == null
                ? ""
                : value.strip().toUpperCase(Locale.ROOT);
        if (!List.of("ACTIVE", "INACTIVE").contains(normalized)) {
            throw new IllegalArgumentException("Packaging rule status is invalid");
        }
        return normalized;
    }

    private static void requireWeight(int value) {
        if (value < 1 || value > 999999999) {
            throw new IllegalArgumentException("Packaging weight is invalid");
        }
    }

    private static void requireDimensions(
            Integer lengthMm, Integer widthMm, Integer heightMm) {
        boolean allNull = lengthMm == null && widthMm == null && heightMm == null;
        boolean allValid = lengthMm != null && widthMm != null && heightMm != null
                && lengthMm >= 1 && widthMm >= 1 && heightMm >= 1
                && lengthMm <= 999999 && widthMm <= 999999 && heightMm <= 999999;
        if (!allNull && !allValid) {
            throw new IllegalArgumentException("Packaging dimensions are invalid");
        }
    }

    private static void requireTolerance(int grams, int basisPoints) {
        if (grams < 0 || grams > 999999999
                || basisPoints < 0 || basisPoints > 10000) {
            throw new IllegalArgumentException("Weight tolerance is invalid");
        }
    }

    public record Actor(
            UUID tenantId,
            UUID userId,
            UUID systemAdminId,
            String requestId,
            String sourceIp) {
    }
}
