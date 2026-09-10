package cn.xzkj.erp.supplier.service;

import static cn.xzkj.erp.supplier.domain.SupplierAuditActions.ARCHIVED;
import static cn.xzkj.erp.supplier.domain.SupplierAuditActions.CREATED;
import static cn.xzkj.erp.supplier.domain.SupplierAuditActions.IMPORTED;
import static cn.xzkj.erp.supplier.domain.SupplierAuditActions.UPDATED;

import java.text.Normalizer;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
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
import cn.xzkj.erp.supplier.api.SupplierDtos.CreateSupplierRequest;
import cn.xzkj.erp.supplier.api.SupplierDtos.UpdateSupplierRequest;
import cn.xzkj.erp.supplier.domain.Supplier;
import cn.xzkj.erp.supplier.domain.SupplierStatus;
import cn.xzkj.erp.supplier.repository.SupplierRepository;

@Service
public class SupplierMasterDataService {
    private final SupplierRepository supplierRepository;
    private final SecurityAuditRecorder auditRecorder;

    public SupplierMasterDataService(
            SupplierRepository supplierRepository,
            SecurityAuditRecorder auditRecorder) {
        this.supplierRepository = supplierRepository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional
    public Supplier create(SupplierActor actor, CreateSupplierRequest request) {
        UUID tenantId = requireActor(actor);
        NormalizedSupplier normalized = normalize(request);
        if (supplierRepository.existsByTenantIdAndBusinessCode(
                tenantId, normalized.businessCode())) {
            throw new ConflictException("Supplier business code already exists");
        }
        Supplier supplier = createNormalized(actor, normalized);
        audit(actor, CREATED, supplier, Map.of(
                "businessCode", supplier.getBusinessCode(),
                "status", supplier.getStatus().name()));
        return supplier;
    }

    @Transactional
    public List<Supplier> importSuppliers(
            SupplierActor actor,
            List<CreateSupplierRequest> requests) {
        UUID tenantId = requireActor(actor);
        if (requests == null || requests.isEmpty() || requests.size() > 200) {
            throw new IllegalArgumentException(
                    "Between 1 and 200 suppliers are required");
        }
        List<NormalizedSupplier> rows = requests.stream()
                .map(SupplierMasterDataService::normalize)
                .toList();
        Set<String> codes = new HashSet<>();
        if (rows.stream().map(NormalizedSupplier::businessCode)
                .anyMatch(code -> !codes.add(code))) {
            throw new ConflictException(
                    "Supplier import contains duplicate business codes");
        }
        List<String> existing = supplierRepository.findExistingBusinessCodes(
                tenantId, codes);
        if (!existing.isEmpty()) {
            throw new ConflictException(
                    "Supplier business code already exists: " + existing.get(0));
        }
        return rows.stream()
                .map(row -> {
                    Supplier supplier = createNormalized(actor, row);
                    audit(actor, IMPORTED, supplier, Map.of(
                            "businessCode", supplier.getBusinessCode(),
                            "status", supplier.getStatus().name()));
                    return supplier;
                })
                .toList();
    }

    @Transactional(readOnly = true)
    public Page<Supplier> list(
            UUID tenantId,
            SupplierStatus status,
            String query,
            Pageable pageable) {
        requireTenant(tenantId);
        String normalizedQuery = normalizedQuery(query);
        return supplierRepository.searchByTenantId(
                tenantId,
                status,
                normalizedQuery != null,
                normalizedQuery == null ? "" : normalizedQuery,
                pageable);
    }

    @Transactional(readOnly = true)
    public Supplier get(UUID tenantId, UUID supplierId) {
        requireTenant(tenantId);
        return supplierRepository.findByIdAndTenantId(supplierId, tenantId)
                .orElseThrow(() ->
                        new ResourceNotFoundException("Supplier was not found"));
    }

    @Transactional
    public Supplier update(
            SupplierActor actor,
            UUID supplierId,
            UpdateSupplierRequest request) {
        UUID tenantId = requireActor(actor);
        if (supplierId == null || request == null || request.version() == null) {
            throw new IllegalArgumentException("Supplier update is invalid");
        }
        Supplier supplier = supplierRepository
                .findForUpdateByIdAndTenantId(supplierId, tenantId)
                .orElseThrow(() ->
                        new ResourceNotFoundException("Supplier was not found"));
        if (supplier.getVersion() != request.version()) {
            throw new ConflictException("The resource has changed");
        }
        if (supplier.getStatus() == SupplierStatus.ARCHIVED) {
            throw new ConflictException("Archived suppliers cannot be changed");
        }
        String code = normalizeCode(request.businessCode());
        if (supplierRepository.existsByTenantIdAndBusinessCodeAndIdNot(
                tenantId, code, supplierId)) {
            throw new ConflictException("Supplier business code already exists");
        }
        SupplierStatus status = requireStatus(request.status());
        SupplierStatus previousStatus = supplier.getStatus();
        supplier.update(
                code,
                required(request.name()),
                status,
                nullable(request.contactName(), 120),
                nullable(request.contactPhone(), 40),
                normalizeEmail(request.contactEmail()),
                nullable(request.address(), 500),
                nullable(request.taxRegistrationNumber(), 120),
                normalizeCurrency(request.settlementCurrency()),
                paymentTerms(request.paymentTermsDays()),
                nullable(request.notes(), 2000));
        Supplier saved = supplierRepository.save(supplier);
        Map<String, String> details = new LinkedHashMap<>();
        details.put("businessCode", saved.getBusinessCode());
        details.put("previousStatus", previousStatus.name());
        details.put("status", saved.getStatus().name());
        audit(actor, status == SupplierStatus.ARCHIVED ? ARCHIVED : UPDATED,
                saved, details);
        return saved;
    }

    private Supplier createNormalized(
            SupplierActor actor,
            NormalizedSupplier row) {
        return supplierRepository.save(new Supplier(
                actor.tenantId(),
                row.businessCode(),
                row.name(),
                row.contactName(),
                row.contactPhone(),
                row.contactEmail(),
                row.address(),
                row.taxRegistrationNumber(),
                row.settlementCurrency(),
                row.paymentTermsDays(),
                row.notes()));
    }

    private void audit(
            SupplierActor actor,
            String action,
            Supplier supplier,
            Map<String, String> details) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                action, "supplier", supplier.getId().toString(),
                actor.requestId(), actor.sourceIp(), details));
    }

    private static NormalizedSupplier normalize(CreateSupplierRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Supplier request is required");
        }
        return new NormalizedSupplier(
                normalizeCode(request.businessCode()),
                required(request.name()),
                nullable(request.contactName(), 120),
                nullable(request.contactPhone(), 40),
                normalizeEmail(request.contactEmail()),
                nullable(request.address(), 500),
                nullable(request.taxRegistrationNumber(), 120),
                normalizeCurrency(request.settlementCurrency()),
                paymentTerms(request.paymentTermsDays()),
                nullable(request.notes(), 2000));
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

    private static SupplierStatus requireStatus(SupplierStatus status) {
        if (status == null) {
            throw new IllegalArgumentException("Status is required");
        }
        return status;
    }

    private static void requireTenant(UUID tenantId) {
        if (tenantId == null) {
            throw new IllegalArgumentException("Tenant ID is required");
        }
    }

    private static String normalizeCode(String value) {
        String normalized = required(value).toUpperCase(Locale.ROOT);
        if (!normalized.matches("^[A-Z][A-Z0-9_-]{1,63}$")) {
            throw new IllegalArgumentException("Supplier business code is invalid");
        }
        return normalized;
    }

    private static String normalizeEmail(String value) {
        String normalized = nullable(value, 254);
        return normalized == null ? null : normalized.toLowerCase(Locale.ROOT);
    }

    private static String normalizeCurrency(String value) {
        String normalized = nullable(value, 3);
        if (normalized == null) {
            return null;
        }
        normalized = normalized.toUpperCase(Locale.ROOT);
        if (!normalized.matches("^[A-Z]{3}$")) {
            throw new IllegalArgumentException("Settlement currency is invalid");
        }
        return normalized;
    }

    private static Integer paymentTerms(Integer value) {
        if (value != null && (value < 0 || value > 3650)) {
            throw new IllegalArgumentException("Payment terms are invalid");
        }
        return value;
    }

    private static String normalizedQuery(String value) {
        String normalized = nullable(value, 100);
        return normalized == null ? null : normalized.toLowerCase(Locale.ROOT);
    }

    private static String required(String value) {
        String normalized = nullable(value, 200);
        if (normalized == null) {
            throw new IllegalArgumentException("A required value is missing");
        }
        return normalized;
    }

    private static String nullable(String value, int maximum) {
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
            throw new IllegalArgumentException("Supplier value is invalid");
        }
        return normalized;
    }

    private record NormalizedSupplier(
            String businessCode,
            String name,
            String contactName,
            String contactPhone,
            String contactEmail,
            String address,
            String taxRegistrationNumber,
            String settlementCurrency,
            Integer paymentTermsDays,
            String notes) {
    }
}
