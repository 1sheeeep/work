package cn.xzkj.erp.logistics.authorization;

import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.CredentialMaterial;
import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.StoredCredential;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
final class RoutingLogisticsProviderOperations
        implements LogisticsProviderOperations {
    private static final Set<String> HUALEI_FAMILY = Set.of(
            LogisticsProviderCatalog.DAYUNJIA,
            LogisticsProviderCatalog.HUALEI,
            LogisticsProviderCatalog.TONGXI,
            LogisticsProviderCatalog.JIAYUN_SHENGTU,
            LogisticsProviderCatalog.SHANDIANHOU_XIAOBAO,
            LogisticsProviderCatalog.SHANDIANHOU_SHANGPAI);
    private static final Set<String> ITDIDA_FAMILY = Set.of(
            LogisticsProviderCatalog.BIAOJU,
            LogisticsProviderCatalog.BAIDU_YIXIA);

    private final LogisticsAuthorizationRepository repository;
    private final LogisticsCredentialCipher cipher;
    private final LogisticsProviderSystemConfigService systemConfig;
    private final ChudaLogisticsProviderConnector chuda;
    private final HualeiLogisticsProviderConnector hualei;
    private final ItdidaLogisticsProviderConnector itdida;

    RoutingLogisticsProviderOperations(
            LogisticsAuthorizationRepository repository,
            LogisticsCredentialCipher cipher,
            LogisticsProviderSystemConfigService systemConfig,
            ChudaLogisticsProviderConnector chuda,
            HualeiLogisticsProviderConnector hualei,
            ItdidaLogisticsProviderConnector itdida) {
        this.repository = repository;
        this.cipher = cipher;
        this.systemConfig = systemConfig;
        this.chuda = chuda;
        this.hualei = hualei;
        this.itdida = itdida;
    }

    @Override
    public CreateResult create(UUID tenantId, UUID authorizationId,
            UUID channelId, Shipment shipment) {
        OperationalAccount account = account(
                tenantId, authorizationId, channelId);
        if (LogisticsProviderCatalog.CHUDA.equals(account.providerCode())) {
            var providerCredentials = systemConfig.credentials(
                    LogisticsProviderCatalog.CHUDA);
            if (providerCredentials == null) {
                throw new OperationException(
                        "PROVIDER_SYSTEM_CONFIGURATION_MISSING", true);
            }
            return chuda.create(account.credentials(), providerCredentials,
                    account.channel(), shipment);
        }
        if (HUALEI_FAMILY.contains(account.providerCode())) {
            return hualei.create(account.providerCode(), account.credentials(),
                    account.channel(), shipment);
        }
        if (ITDIDA_FAMILY.contains(account.providerCode())) {
            return itdida.create(account.providerCode(), account.credentials(),
                    account.channel(), shipment);
        }
        throw new OperationException("PROVIDER_OPERATION_NOT_SUPPORTED", true);
    }

    @Override
    public TrackingResult track(UUID tenantId, UUID authorizationId,
            UUID channelId, String clientReference,
            String providerOrderReference, String trackingReference) {
        OperationalAccount account = account(
                tenantId, authorizationId, channelId);
        if (LogisticsProviderCatalog.CHUDA.equals(account.providerCode())) {
            var providerCredentials = systemConfig.credentials(
                    LogisticsProviderCatalog.CHUDA);
            if (providerCredentials == null) {
                throw new OperationException(
                        "PROVIDER_SYSTEM_CONFIGURATION_MISSING", true);
            }
            return chuda.track(account.credentials(), providerCredentials,
                    clientReference, providerOrderReference, trackingReference);
        }
        if (HUALEI_FAMILY.contains(account.providerCode())) {
            return hualei.track(account.providerCode(), account.credentials(),
                    clientReference, providerOrderReference, trackingReference);
        }
        if (ITDIDA_FAMILY.contains(account.providerCode())) {
            return itdida.track(account.providerCode(), account.credentials(),
                    clientReference, providerOrderReference, trackingReference);
        }
        throw new OperationException("PROVIDER_OPERATION_NOT_SUPPORTED", true);
    }

    @Override
    public void confirmHandover(UUID tenantId, UUID authorizationId,
            UUID channelId, String clientReference,
            String providerOrderReference, String trackingReference) {
        OperationalAccount account = account(
                tenantId, authorizationId, channelId);
        if (HUALEI_FAMILY.contains(account.providerCode())) {
            hualei.confirmHandover(account.providerCode(), account.credentials(),
                    clientReference);
        }
    }

    private OperationalAccount account(UUID tenantId, UUID authorizationId,
            UUID channelId) {
        if (tenantId == null || authorizationId == null || channelId == null) {
            throw new OperationException("LOGISTICS_ACCOUNT_REQUIRED", true);
        }
        LogisticsAuthorizationRecord authorization = repository.find(
                tenantId, authorizationId);
        LogisticsAuthorizationChannelRecord channel = repository.findChannel(
                tenantId, authorizationId, channelId);
        if (authorization == null || channel == null
                || !"ACTIVE".equals(authorization.status())
                || !channel.effectiveEnabled()
                || !authorization.providerCode().equals(channel.providerCode())) {
            throw new OperationException(
                    "LOGISTICS_CHANNEL_NOT_AVAILABLE", true);
        }
        StoredCredential stored = repository.findCredential(
                tenantId, authorizationId);
        CredentialMaterial credentials = cipher.decrypt(
                tenantId, authorizationId, authorization.providerCode(), stored);
        return new OperationalAccount(
                authorization.providerCode(), credentials, channel);
    }

    private record OperationalAccount(
            String providerCode,
            CredentialMaterial credentials,
            LogisticsAuthorizationChannelRecord channel) {
    }
}
