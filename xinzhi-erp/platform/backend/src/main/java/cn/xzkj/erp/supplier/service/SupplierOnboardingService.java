package cn.xzkj.erp.supplier.service;

import static cn.xzkj.erp.supplier.domain.SupplierAuditActions.ONBOARDED;

import java.util.Map;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.supplier.api.SupplierDtos.CreateSupplierWithMappingRequest;
import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;

@Service
public class SupplierOnboardingService {
    private final SupplierMasterDataService supplierService;
    private final SupplierSkuMappingService mappingService;
    private final SecurityAuditRecorder auditRecorder;

    public SupplierOnboardingService(
            SupplierMasterDataService supplierService,
            SupplierSkuMappingService mappingService,
            SecurityAuditRecorder auditRecorder) {
        this.supplierService = supplierService;
        this.mappingService = mappingService;
        this.auditRecorder = auditRecorder;
    }

    @Transactional
    public SupplierOnboardingResult createWithMapping(
            SupplierActor actor,
            CreateSupplierWithMappingRequest request) {
        if (request == null) {
            throw new IllegalArgumentException(
                    "Supplier onboarding request is required");
        }
        var supplier = supplierService.create(actor, request.supplier());
        var mapping = mappingService.create(
                actor, supplier.getId(), request.mapping());
        audit(actor, supplier.getId().toString(),
                mapping.mapping().getSkuId().toString());
        return new SupplierOnboardingResult(supplier, mapping);
    }

    private void audit(
            SupplierActor actor,
            String supplierId,
            String skuId) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(), actor.userId(), actor.systemAdminId(),
                ONBOARDED, "supplier_onboarding", supplierId,
                actor.requestId(), actor.sourceIp(),
                Map.of("supplierId", supplierId, "skuId", skuId)));
    }
}
