package cn.xzkj.erp.warehouse.documents;

import java.util.UUID;

public record WarehouseDocumentActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId) {
}
