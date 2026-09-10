package cn.xzkj.erp.iam.application;

import java.util.UUID;

public record IamActor(
        UUID tenantId,
        UUID userId,
        UUID systemAdminId,
        String requestId,
        String sourceIp) {

    public IamActor(
            UUID tenantId,
            UUID userId,
            String requestId,
            String sourceIp) {
        this(tenantId, userId, null, requestId, sourceIp);
    }
}
