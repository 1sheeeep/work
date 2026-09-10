package cn.xzkj.erp.procurement.statistics;

import java.util.UUID;

public record PurchaserStatisticsActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId) {}
