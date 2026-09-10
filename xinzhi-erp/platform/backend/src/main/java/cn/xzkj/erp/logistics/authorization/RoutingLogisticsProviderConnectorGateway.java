package cn.xzkj.erp.logistics.authorization;

import org.springframework.stereotype.Component;

@Component
final class RoutingLogisticsProviderConnectorGateway
        implements LogisticsProviderConnectorGateway {
    private final ChudaLogisticsProviderConnector chuda;
    private final HualeiLogisticsProviderConnector hualei;
    private final ItdidaLogisticsProviderConnector itdida;
    private final LogisticsProviderSystemConfigService systemConfig;

    RoutingLogisticsProviderConnectorGateway(
            ChudaLogisticsProviderConnector chuda,
            HualeiLogisticsProviderConnector hualei,
            ItdidaLogisticsProviderConnector itdida,
            LogisticsProviderSystemConfigService systemConfig) {
        this.chuda = chuda;
        this.hualei = hualei;
        this.itdida = itdida;
        this.systemConfig = systemConfig;
    }

    @Override
    public ProbeResult probe(ProbeRequest request) {
        if ("CHUDA".equals(request.providerCode())) {
            var providerCredentials = systemConfig.credentials("CHUDA");
            if (providerCredentials == null) {
                return ProbeResult.systemConfigMissing("触达物流");
            }
            return chuda.probe(request, providerCredentials);
        }
        if (LogisticsProviderCatalog.DAYUNJIA.equals(request.providerCode())
                || LogisticsProviderCatalog.HUALEI.equals(request.providerCode())
                || LogisticsProviderCatalog.TONGXI.equals(request.providerCode())
                || LogisticsProviderCatalog.JIAYUN_SHENGTU.equals(
                        request.providerCode())
                || LogisticsProviderCatalog.SHANDIANHOU_XIAOBAO.equals(
                        request.providerCode())
                || LogisticsProviderCatalog.SHANDIANHOU_SHANGPAI.equals(
                        request.providerCode())) {
            return hualei.probe(request);
        }
        if (LogisticsProviderCatalog.BIAOJU.equals(request.providerCode())
                || LogisticsProviderCatalog.BAIDU_YIXIA.equals(
                        request.providerCode())) {
            return itdida.probe(request);
        }
        return ProbeResult.notConfigured();
    }
}
