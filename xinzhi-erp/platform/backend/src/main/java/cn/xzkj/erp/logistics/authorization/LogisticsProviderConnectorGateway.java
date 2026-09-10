package cn.xzkj.erp.logistics.authorization;

import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.CredentialMaterial;
import java.util.List;
import java.util.UUID;

interface LogisticsProviderConnectorGateway {
    ProbeResult probe(ProbeRequest request);

    record ProbeRequest(UUID tenantId, UUID authorizationId,
            String providerCode, CredentialMaterial credentials,
            String correlationId) {
        @Override
        public String toString() {
            return "ProbeRequest[tenantId=" + tenantId
                    + ", authorizationId=" + authorizationId
                    + ", providerCode=" + providerCode
                    + ", credentials=[REDACTED], correlationId="
                    + correlationId + "]";
        }
    }

    record DiscoveredChannel(String code, String name) {
    }

    record ProbeResult(String status, String message,
            List<DiscoveredChannel> channels) {
        public ProbeResult(String status, String message) {
            this(status, message, List.of());
        }

        public ProbeResult {
            channels = channels == null ? List.of() : List.copyOf(channels);
        }

        static ProbeResult notConfigured() {
            return new ProbeResult("NOT_CONFIGURED",
                    "物流商接口尚未启用；账号信息已安全保存。拿到官方接口资料后即可完成连接验证。");
        }

        static ProbeResult systemConfigMissing(String providerName) {
            return new ProbeResult("NOT_CONFIGURED",
                    providerName + "系统接口凭据尚未配置，请联系系统管理员完成配置后重试。");
        }
    }
}
