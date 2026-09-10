package cn.xzkj.erp.inventory.service;

import java.util.UUID;

public record InventoryActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId,
        String requestId,
        String sourceIp) {
}
