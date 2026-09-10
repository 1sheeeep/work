package cn.xzkj.erp.supplier.service;

import java.util.UUID;

public record SupplierActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId,
        String requestId,
        String sourceIp) {
}
