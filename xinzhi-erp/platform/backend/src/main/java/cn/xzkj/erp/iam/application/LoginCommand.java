package cn.xzkj.erp.iam.application;

public record LoginCommand(
        String tenantCode,
        String username,
        String password,
        String requestId,
        String sourceIp) {
}
