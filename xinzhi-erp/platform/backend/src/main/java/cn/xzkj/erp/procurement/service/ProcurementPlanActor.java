package cn.xzkj.erp.procurement.service;

import java.util.UUID;

public record ProcurementPlanActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId,
        String displayName,
        String requestId,
        String sourceIp) {
}
