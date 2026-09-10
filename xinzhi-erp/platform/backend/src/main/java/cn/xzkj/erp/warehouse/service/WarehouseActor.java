package cn.xzkj.erp.warehouse.service;

import java.util.UUID;

public record WarehouseActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId,
        String requestId,
        String sourceIp) {
}
