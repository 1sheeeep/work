package cn.xzkj.erp.supplier.service;

import static cn.xzkj.erp.supplier.domain.SupplierSkuMappingAuditActions.CREATED;
import static cn.xzkj.erp.supplier.domain.SupplierSkuMappingAuditActions.PREFERRED_CHANGED;
import static cn.xzkj.erp.supplier.domain.SupplierSkuMappingAuditActions.UPDATED;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.Normalizer;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.product.domain.ProductSku;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.product.repository.ProductSkuRepository;
import cn.xzkj.erp.supplier.api.SupplierSkuMappingDtos.CreateMappingRequest;
import cn.xzkj.erp.supplier.api.SupplierSkuMappingDtos.UpdateMappingRequest;
import cn.xzkj.erp.supplier.domain.Supplier;
import cn.xzkj.erp.supplier.domain.SupplierSkuMapping;
import cn.xzkj.erp.supplier.domain.SupplierSkuMappingStatus;
import cn.xzkj.erp.supplier.domain.SupplierStatus;
import cn.xzkj.erp.supplier.repository.SupplierRepository;
import cn.xzkj.erp.supplier.repository.SupplierSkuMappingRepository;

@Service
public class SupplierSkuMappingService {
    private final SupplierRepository supplierRepository;
    private final SupplierSkuMappingRepository mappingRepository;
    private final ProductSkuRepository skuRepository;
    private final SecurityAuditRecorder auditRecorder;

    public SupplierSkuMappingService(
            SupplierRepository supplierRepository,
            SupplierSkuMappingRepository mappingRepository,
            ProductSkuRepository skuRepository,
            SecurityAuditRecorder auditRecorder) {
        this.supplierRepository = supplierRepository;
        this.mappingRepository = mappingRepository;
        this.skuRepository = skuRepository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional(readOnly = true)
    public Page<SupplierSkuMappingSummary> list(
            UUID tenantId,
            UUID supplierId,
            SupplierSkuMappingStatus status,
            String query,
            Pageable pageable) {
        requireTenant(tenantId);
        requireSupplier(tenantId, supplierId);
        String normalizedQuery = optional(query, 120);
        normalizedQuery = normalizedQuery == null
                ? null : normalizedQuery.toLowerCase(Locale.ROOT);
        return mappingRepository.search(
                tenantId, supplierId, status, normalizedQuery != null,
                normalizedQuery == null ? "" : normalizedQuery, pageable);
    }

    @Transactional(readOnly = true)
    public List<PreferredSupplierSkuSummary> listPreferredSuppliers(
            UUID tenantId,
            List<UUID> skuIds) {
        requireTenant(tenantId);
        if (skuIds == null || skuIds.isEmpty() || skuIds.size() > 50
                || skuIds.stream().anyMatch(Objects::isNull)) {
            throw new IllegalArgumentException(
                    "Between 1 and 50 SKU identities are required");
        }
        Set<UUID> requiredSkuIds = Set.copyOf(skuIds);
        if (requiredSkuIds.size() != skuIds.size()) {
            throw new IllegalArgumentException("SKU identities must be unique");
        }
        return mappingRepository.findPreferredByTenantIdAndSkuIdIn(
                tenantId, requiredSkuIds);
    }

    @Transactional
    public SupplierSkuMappingSummary create(
            SupplierActor actor,
            UUID supplierId,
            CreateMappingRequest request) {
        UUID tenantId = requireActor(actor);
        if (request == null) {
            throw new IllegalArgumentException("Mapping request is required");
        }
        requireWritableSupplier(tenantId, supplierId);
        ProductSku sku = requireSku(tenantId, request.skuId());
        if (sku.getStatus() == ProductStatus.ARCHIVED) {
            throw new ConflictException(
                    "Archived SKUs cannot receive supplier mappings");
        }
        if (mappingRepository.existsByTenantIdAndSupplierIdAndSkuId(
                tenantId, supplierId, request.skuId())) {
            throw new ConflictException("Supplier SKU mapping already exists");
        }
        NormalizedMapping normalized = normalize(
                request.supplierSkuCode(), request.status(),
                request.preferred(), request.leadTimeDays(),
                request.unitPrice(), request.currencyCode(),
                request.minimumOrderQuantity());
        if (normalized.preferred()) {
            clearPreviousPreferred(actor, tenantId, request.skuId(), null);
        }
        SupplierSkuMapping mapping = mappingRepository.save(
                new SupplierSkuMapping(
                        tenantId, supplierId, request.skuId(),
                        normalized.supplierSkuCode(), normalized.status(),
                        normalized.preferred(), normalized.leadTimeDays(),
                        normalized.unitPrice(), normalized.currencyCode(),
                        normalized.minimumOrderQuantity()));
        audit(actor, CREATED, mapping, null);
        return summary(mapping, sku);
    }

    @Transactional
    public SupplierSkuMappingSummary update(
            SupplierActor actor,
            UUID supplierId,
            UUID mappingId,
            UpdateMappingRequest request) {
        UUID tenantId = requireActor(actor);
        if (request == null || request.version() == null) {
            throw new IllegalArgumentException("Mapping update is invalid");
        }
        requireWritableSupplier(tenantId, supplierId);
        SupplierSkuMapping mapping = mappingRepository
                .findForUpdate(tenantId, supplierId, mappingId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Supplier SKU mapping was not found"));
        if (mapping.getVersion() != request.version()) {
            throw new ConflictException("The resource has changed");
        }
        if (!mapping.getSkuId().equals(request.skuId())) {
            throw new ConflictException("Mapping SKU identity cannot be changed");
        }
        NormalizedMapping normalized = normalize(
                request.supplierSkuCode(), request.status(),
                request.preferred(), request.leadTimeDays(),
                request.unitPrice(), request.currencyCode(),
                request.minimumOrderQuantity());
        boolean previousPreferred = mapping.isPreferred();
        if (normalized.preferred()) {
            clearPreviousPreferred(actor, tenantId, mapping.getSkuId(), mappingId);
        }
        mapping.update(
                normalized.supplierSkuCode(), normalized.status(),
                normalized.preferred(), normalized.leadTimeDays(),
                normalized.unitPrice(), normalized.currencyCode(),
                normalized.minimumOrderQuantity());
        SupplierSkuMapping saved = mappingRepository.save(mapping);
        ProductSku sku = requireSku(tenantId, mapping.getSkuId());
        audit(actor, previousPreferred == normalized.preferred()
                ? UPDATED : PREFERRED_CHANGED, saved, previousPreferred);
        return summary(saved, sku);
    }

    private void clearPreviousPreferred(
            SupplierActor actor,
            UUID tenantId,
            UUID skuId,
            UUID excludedMappingId) {
        mappingRepository.findPreferredForUpdate(tenantId, skuId)
                .filter(existing -> excludedMappingId == null
                        || !existing.getId().equals(excludedMappingId))
                .ifPresent(existing -> {
                    existing.update(
                            existing.getSupplierSkuCode(), existing.getStatus(),
                            false, existing.getLeadTimeDays(),
                            existing.getUnitPrice(), existing.getCurrencyCode(),
                            existing.getMinimumOrderQuantity());
                    SupplierSkuMapping saved = mappingRepository.save(existing);
                    audit(actor, PREFERRED_CHANGED, saved, true);
                });
    }

    private Supplier requireSupplier(UUID tenantId, UUID supplierId) {
        return supplierRepository.findByIdAndTenantId(supplierId, tenantId)
                .orElseThrow(() ->
                        new ResourceNotFoundException("Supplier was not found"));
    }

    private Supplier requireWritableSupplier(UUID tenantId, UUID supplierId) {
        Supplier supplier = supplierRepository
                .findForUpdateByIdAndTenantId(supplierId, tenantId)
                .orElseThrow(() ->
                        new ResourceNotFoundException("Supplier was not found"));
        if (supplier.getStatus() != SupplierStatus.ACTIVE) {
            throw new ConflictException(
                    "Only active suppliers can change sourcing relationships");
        }
        return supplier;
    }

    private ProductSku requireSku(UUID tenantId, UUID skuId) {
        if (skuId == null) {
            throw new IllegalArgumentException("SKU ID is required");
        }
        return skuRepository.findByIdAndTenantId(skuId, tenantId)
                .orElseThrow(() ->
                        new ResourceNotFoundException("SKU was not found"));
    }

    private void audit(
            SupplierActor actor,
            String action,
            SupplierSkuMapping mapping,
            Boolean previousPreferred) {
        Map<String, String> details = new LinkedHashMap<>();
        details.put("supplierId", mapping.getSupplierId().toString());
        details.put("skuId", mapping.getSkuId().toString());
        details.put("status", mapping.getStatus().name());
        details.put("preferred", Boolean.toString(mapping.isPreferred()));
        if (previousPreferred != null) {
            details.put("previousPreferred",
                    Boolean.toString(previousPreferred));
        }
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                action, "supplier_sku_mapping", mapping.getId().toString(),
                actor.requestId(), actor.sourceIp(), details));
    }

    private static SupplierSkuMappingSummary summary(
            SupplierSkuMapping mapping,
            ProductSku sku) {
        return new SupplierSkuMappingSummary(
                mapping, sku.getBusinessCode(), sku.getName());
    }

    private static NormalizedMapping normalize(
            String supplierSkuCode,
            SupplierSkuMappingStatus status,
            Boolean preferred,
            Integer leadTimeDays,
            BigDecimal unitPrice,
            String currencyCode,
            Long minimumOrderQuantity) {
        if (status == null || preferred == null) {
            throw new IllegalArgumentException("Mapping status is required");
        }
        if (preferred && status != SupplierSkuMappingStatus.ACTIVE) {
            throw new IllegalArgumentException(
                    "Only active sourcing relationships can be preferred");
        }
        if (leadTimeDays != null && (leadTimeDays < 0 || leadTimeDays > 3650)) {
            throw new IllegalArgumentException("Lead time is invalid");
        }
        if (minimumOrderQuantity != null
                && (minimumOrderQuantity < 1
                || minimumOrderQuantity > 1_000_000_000L)) {
            throw new IllegalArgumentException("Minimum order quantity is invalid");
        }
        String currency = normalizeCurrency(currencyCode);
        BigDecimal price = normalizePrice(unitPrice);
        if ((price == null) != (currency == null)) {
            throw new IllegalArgumentException(
                    "Unit price and currency must be provided together");
        }
        return new NormalizedMapping(
                optional(supplierSkuCode, 120), status, preferred,
                leadTimeDays, price, currency, minimumOrderQuantity);
    }

    private static BigDecimal normalizePrice(BigDecimal value) {
        if (value == null) {
            return null;
        }
        if (value.signum() <= 0 || value.precision() > 19
                || value.scale() > 4) {
            throw new IllegalArgumentException("Unit price is invalid");
        }
        return value.setScale(4, RoundingMode.UNNECESSARY);
    }

    private static String normalizeCurrency(String value) {
        String normalized = optional(value, 3);
        if (normalized == null) {
            return null;
        }
        normalized = normalized.toUpperCase(Locale.ROOT);
        if (!normalized.matches("^[A-Z]{3}$")) {
            throw new IllegalArgumentException("Currency is invalid");
        }
        return normalized;
    }

    private static UUID requireActor(SupplierActor actor) {
        if (actor == null) {
            throw new IllegalArgumentException("Actor is required");
        }
        requireTenant(actor.tenantId());
        boolean userActor = actor.userId() != null;
        boolean systemAdminActor = actor.systemAdminId() != null;
        if (userActor == systemAdminActor) {
            throw new IllegalArgumentException(
                    "Exactly one actor identity is required");
        }
        return actor.tenantId();
    }

    private static void requireTenant(UUID tenantId) {
        if (tenantId == null) {
            throw new IllegalArgumentException("Tenant ID is required");
        }
    }

    private static String optional(String value, int maximum) {
        if (value == null) {
            return null;
        }
        String normalized = Normalizer.normalize(value, Normalizer.Form.NFKC)
                .strip();
        if (normalized.isEmpty()) {
            return null;
        }
        if (normalized.length() > maximum
                || normalized.codePoints().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("Mapping value is invalid");
        }
        return normalized;
    }

    private record NormalizedMapping(
            String supplierSkuCode,
            SupplierSkuMappingStatus status,
            boolean preferred,
            Integer leadTimeDays,
            BigDecimal unitPrice,
            String currencyCode,
            Long minimumOrderQuantity) {
    }
}
