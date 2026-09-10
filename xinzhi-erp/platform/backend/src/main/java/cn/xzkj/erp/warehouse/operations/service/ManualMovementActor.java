package cn.xzkj.erp.warehouse.operations.service;

import java.util.UUID;

public record ManualMovementActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId,
        String displayName,
        String requestId,
        String sourceIp) {
}
