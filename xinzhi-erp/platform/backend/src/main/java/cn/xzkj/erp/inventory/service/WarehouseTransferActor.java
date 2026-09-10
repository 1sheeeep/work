package cn.xzkj.erp.inventory.service;

import java.util.UUID;

public record WarehouseTransferActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId,
        String displayName,
        String requestId,
        String sourceIp) {
}
