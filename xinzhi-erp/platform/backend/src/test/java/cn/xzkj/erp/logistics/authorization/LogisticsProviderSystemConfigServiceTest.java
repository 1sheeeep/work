package cn.xzkj.erp.logistics.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.ProviderCredentialMaterial;
import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.StoredCredential;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderSystemConfigRepository.StoredProviderConfig;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderSystemConfigRepository.StoredProviderName;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderSystemConfigService.ProviderConfigInput;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderSystemConfigService.ProviderNameInput;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.platformadmin.application.PlatformAdminActor;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditEvent;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditRecorder;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class LogisticsProviderSystemConfigServiceTest {
    private final LogisticsProviderSystemConfigRepository repository =
            mock(LogisticsProviderSystemConfigRepository.class);
    private final LogisticsCredentialCipher cipher = new LogisticsCredentialCipher(
            Base64.getEncoder().encodeToString(new byte[32]));
    private final PlatformAdminAuditRecorder audit =
            mock(PlatformAdminAuditRecorder.class);
    private final LogisticsProviderSystemConfigService service =
            new LogisticsProviderSystemConfigService(repository, cipher, audit);
    private final PlatformAdminActor actor = new PlatformAdminActor(
            UUID.randomUUID(), UUID.randomUUID(), "provider-config-uat", "127.0.0.1");

    @Test
    void exposesOnlyConfigurationStatusAndStoresEncryptedMaterial() {
        ProviderCredentialMaterial material = new ProviderCredentialMaterial(
                "customer-code", "authorization-code", "provider-secret");
        var encrypted = cipher.encryptProvider("CHUDA", material);
        StoredProviderConfig stored = new StoredProviderConfig("CHUDA",
                new StoredCredential(encrypted.keyVersion(), encrypted.nonce(),
                        encrypted.ciphertext()), 1, Instant.parse("2026-08-13T01:00:00Z"));
        when(repository.save(eq("CHUDA"), any(), eq(0L), eq(actor.adminId())))
                .thenReturn(true);
        when(repository.find("CHUDA")).thenReturn(stored);

        var result = service.configure(actor, "chuda", new ProviderConfigInput(
                material.customerCode(), material.authorizationCode(),
                material.secret(), 0));

        assertThat(result.configured()).isTrue();
        assertThat(result.toString()).doesNotContain(
                material.customerCode(), material.authorizationCode(), material.secret());
        assertThat(service.credentials("CHUDA")).isEqualTo(material);
        ArgumentCaptor<PlatformAdminAuditEvent> event =
                ArgumentCaptor.forClass(PlatformAdminAuditEvent.class);
        verify(audit).recordAtomically(event.capture());
        assertThat(event.getValue().toString()).doesNotContain(
                material.customerCode(), material.authorizationCode(), material.secret());
    }

    @Test
    void reportsUnconfiguredWithoutInventingCredentialValues() {
        when(repository.find("CHUDA")).thenReturn(null);

        var configurations = service.list();
        var result = configurations.getFirst();

        assertThat(configurations).hasSize(9);
        assertThat(result.configured()).isFalse();
        assertThat(result.configurationMode()).isEqualTo("SYSTEM_CREDENTIALS");
        assertThat(result.version()).isZero();
        assertThat(result.updatedAt()).isNull();
        assertThat(configurations.subList(1, configurations.size()))
                .allSatisfy(provider -> {
                    assertThat(provider.configurationMode()).isEqualTo("BUILT_IN");
                    assertThat(provider.configured()).isTrue();
                    assertThat(provider.customerCodeConfigured()).isFalse();
                });
        assertThat(service.credentials("CHUDA")).isNull();
    }

    @Test
    void rejectsConcurrentReplacementAndUnsupportedProviders() {
        when(repository.save(eq("CHUDA"), any(), eq(3L), eq(actor.adminId())))
                .thenReturn(false);
        ProviderConfigInput input = new ProviderConfigInput(
                "customer", "authorization", "secret", 3);

        assertThatThrownBy(() -> service.configure(actor, "CHUDA", input))
                .isInstanceOf(ConflictException.class);
        assertThatThrownBy(() -> service.configure(actor, "UNKNOWN", input))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void renamesAnyCatalogProviderWithoutChangingItsConnectorIdentity() {
        when(repository.saveName("DAYUNJIA", "达运佳物流", 0, actor.adminId()))
                .thenReturn(true);
        when(repository.findName("DAYUNJIA")).thenReturn(new StoredProviderName(
                "DAYUNJIA", "达运佳物流", 1,
                Instant.parse("2026-08-14T01:00:00Z")));

        var result = service.rename(actor, "dayunjia",
                new ProviderNameInput(" 达运佳物流 ", 0));

        assertThat(result.providerCode()).isEqualTo("DAYUNJIA");
        assertThat(result.providerName()).isEqualTo("达运佳物流");
        assertThat(result.nameVersion()).isEqualTo(1);
        assertThat(result.configurationMode()).isEqualTo("BUILT_IN");
        verify(audit).recordAtomically(any());
    }
}
