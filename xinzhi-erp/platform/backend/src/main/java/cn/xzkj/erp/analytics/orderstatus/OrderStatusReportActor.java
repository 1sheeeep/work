package cn.xzkj.erp.analytics.orderstatus;

import java.util.UUID;

public record OrderStatusReportActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId) {}
