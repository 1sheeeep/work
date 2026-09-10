package cn.xzkj.erp.logistics.tracking;

import java.util.UUID;

public record LogisticsTrackingActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId) {
}
