package cn.xzkj.erp.product.service;

import java.util.UUID;

public record ProductActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId,
        String requestId,
        String sourceIp) {
}
