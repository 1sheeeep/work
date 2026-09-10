package cn.xzkj.erp.platformadmin.application;

import java.util.UUID;

public record PlatformAdminActor(
        UUID adminId,
        UUID platformSessionId,
        String requestId,
        String sourceIp) {
}
