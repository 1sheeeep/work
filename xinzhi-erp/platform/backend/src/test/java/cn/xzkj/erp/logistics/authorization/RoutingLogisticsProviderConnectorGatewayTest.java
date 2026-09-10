package cn.xzkj.erp.logistics.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.CredentialMaterial;
import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.ProviderCredentialMaterial;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.ProbeRequest;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.ProbeResult;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class RoutingLogisticsProviderConnectorGatewayTest {
    @Test
    void routesEachImplementedProviderFamily() {
        var chuda = mock(ChudaLogisticsProviderConnector.class);
        var hualei = mock(HualeiLogisticsProviderConnector.class);
        var itdida = mock(ItdidaLogisticsProviderConnector.class);
        var systemConfig = mock(LogisticsProviderSystemConfigService.class);
        var gateway = new RoutingLogisticsProviderConnectorGateway(
                chuda, hualei, itdida, systemConfig);
        ProbeRequest chudaRequest = request("CHUDA");
        ProviderCredentialMaterial providerCredentials =
                new ProviderCredentialMaterial("customer", "authorization", "secret");
        when(systemConfig.credentials("CHUDA")).thenReturn(providerCredentials);
        when(chuda.probe(chudaRequest, providerCredentials)).thenReturn(
                new ProbeResult("CONNECTED", "触达物流连接成功。"));
        when(hualei.probe(org.mockito.ArgumentMatchers.any())).thenReturn(
                new ProbeResult("CONNECTED", "华磊系连接成功。"));
        when(itdida.probe(org.mockito.ArgumentMatchers.any())).thenReturn(
                new ProbeResult("CONNECTED", "易抵达系连接成功。"));

        assertThat(gateway.probe(chudaRequest).status()).isEqualTo("CONNECTED");
        assertThat(gateway.probe(request("DAYUNJIA")).status())
                .isEqualTo("CONNECTED");
        assertThat(gateway.probe(request("HUALEI")).status())
                .isEqualTo("CONNECTED");
        assertThat(gateway.probe(request("TONGXI")).status())
                .isEqualTo("CONNECTED");
        assertThat(gateway.probe(request("JIAYUN_SHENGTU")).status())
                .isEqualTo("CONNECTED");
        assertThat(gateway.probe(request("SHANDIANHOU_XIAOBAO")).status())
                .isEqualTo("CONNECTED");
        assertThat(gateway.probe(request("SHANDIANHOU_SHANGPAI")).status())
                .isEqualTo("CONNECTED");
        assertThat(gateway.probe(request("BIAOJU")).status())
                .isEqualTo("CONNECTED");
        assertThat(gateway.probe(request("BAIDU_YIXIA")).status())
                .isEqualTo("CONNECTED");
        assertThat(gateway.probe(request("YUNEXPRESS")).status())
                .isEqualTo("NOT_CONFIGURED");
        verify(chuda).probe(chudaRequest, providerCredentials);
    }

    @Test
    void keepsTenantCredentialsSavedWhenSystemConfigurationIsMissing() {
        var chuda = mock(ChudaLogisticsProviderConnector.class);
        var hualei = mock(HualeiLogisticsProviderConnector.class);
        var itdida = mock(ItdidaLogisticsProviderConnector.class);
        var systemConfig = mock(LogisticsProviderSystemConfigService.class);
        var gateway = new RoutingLogisticsProviderConnectorGateway(
                chuda, hualei, itdida, systemConfig);

        ProbeResult result = gateway.probe(request("CHUDA"));

        assertThat(result.status()).isEqualTo("NOT_CONFIGURED");
        assertThat(result.message()).contains("系统管理员");
    }

    private static ProbeRequest request(String providerCode) {
        return new ProbeRequest(UUID.randomUUID(), UUID.randomUUID(), providerCode,
                new CredentialMaterial("user", "password", null), "uat-route");
    }
}
