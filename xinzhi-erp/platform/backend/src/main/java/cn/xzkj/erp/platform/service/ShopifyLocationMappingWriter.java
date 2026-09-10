package cn.xzkj.erp.platform.service;

import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway.LocationCatalogLocation;
import cn.xzkj.erp.platform.repository.ShopifyLocationMappingRepository;
import cn.xzkj.erp.platform.repository.ShopifyLocationMappingRepository.LocationMapping;
import cn.xzkj.erp.warehouse.domain.WarehouseStatus;
import cn.xzkj.erp.warehouse.repository.WarehouseRepository;

@Service
public class ShopifyLocationMappingWriter {

    private static final String UPSERT = "shopify.location_mapping.upsert";
    private static final String DELETE = "shopify.location_mapping.delete";

    private final WarehouseRepository warehouseRepository;
    private final ShopifyLocationMappingRepository mappingRepository;
    private final SecurityAuditRecorder auditRecorder;

    public ShopifyLocationMappingWriter(
            WarehouseRepository warehouseRepository,
            ShopifyLocationMappingRepository mappingRepository,
            SecurityAuditRecorder auditRecorder) {
        this.warehouseRepository = warehouseRepository;
        this.mappingRepository = mappingRepository;
        this.auditRecorder = auditRecorder;
    }

    @Transactional
    public LocationMapping upsert(
            ShopCenterActor actor,
            UUID shopId,
            UUID warehouseId,
            LocationCatalogLocation location) {
        if (warehouseId == null) {
            throw new IllegalArgumentException("ERP warehouse is required");
        }
        var warehouse = warehouseRepository.findForUpdateByIdAndTenantId(
                        warehouseId, actor.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException(
                        "ERP warehouse was not found"));
        if (warehouse.getStatus() != WarehouseStatus.ACTIVE) {
            throw new ConflictException(
                    "Shopify locations can only map to active ERP warehouses");
        }
        LocationMapping mapping = mappingRepository.upsert(
                actor.tenantId(), shopId, warehouseId, location);
        audit(actor, shopId, mapping, UPSERT);
        return mapping;
    }

    @Transactional
    public void delete(
            ShopCenterActor actor,
            UUID shopId,
            UUID mappingId) {
        LocationMapping mapping = mappingRepository.delete(
                actor.tenantId(), shopId, mappingId);
        if (mapping == null) {
            throw new ResourceNotFoundException(
                    "Shopify location mapping was not found");
        }
        audit(actor, shopId, mapping, DELETE);
    }

    private void audit(
            ShopCenterActor actor,
            UUID shopId,
            LocationMapping mapping,
            String action) {
        auditRecorder.recordAtomically(new SecurityAuditEvent(
                actor.tenantId(),
                actor.userId(),
                actor.systemAdminId(),
                action,
                "shopify_location_mapping",
                mapping.id().toString(),
                actor.requestId(),
                actor.sourceIp(),
                Map.of(
                        "shopId", shopId.toString(),
                        "warehouseId", mapping.warehouseId().toString(),
                        "externalLocationRef", mapping.externalLocationRef())));
    }
}
