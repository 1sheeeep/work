package cn.xzkj.erp.platform.service;

import java.util.UUID;

public record ShopCenterActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId,
        String requestId,
        String sourceIp) {
}
