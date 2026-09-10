package cn.xzkj.erp.logistics.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.CredentialMaterial;
import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.EncryptedCredential;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.ProbeResult;
import cn.xzkj.erp.platform.service.ConflictException;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class LogisticsAuthorizationServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private LogisticsAuthorizationRepository repository;
    private SecurityAuditRecorder audits;
    private LogisticsCredentialCipher cipher;
    private LogisticsProviderConnectorGateway connector;
    private LogisticsAuthorizationProbeFinalizer probeFinalizer;
    private LogisticsAuthorizationService service;

    @BeforeEach
    void setUp() {
        repository = mock(LogisticsAuthorizationRepository.class);
        audits = mock(SecurityAuditRecorder.class);
        cipher = new LogisticsCredentialCipher(Base64.getEncoder()
                .encodeToString(new byte[32]));
        connector = mock(LogisticsProviderConnectorGateway.class);
        probeFinalizer = mock(LogisticsAuthorizationProbeFinalizer.class);
        service = new LogisticsAuthorizationService(
                repository, audits, cipher, connector, probeFinalizer);
    }

    @Test
    void getsOnlyTheRequestedTenantAuthorization() {
        UUID id = UUID.randomUUID();
        LogisticsAuthorizationRecord authorization = record(
                id, "DIRECT_CREDENTIALS", "ACTIVE", "BIAOJU");
        when(repository.find(TENANT_ID, id)).thenReturn(authorization);

        LogisticsAuthorizationRecord result = service.get(actor(), id);

        assertThat(result).isEqualTo(authorization);
        verify(repository).find(TENANT_ID, id);
    }

    @Test
    void createsManualConnectionWithoutPretendingExternalAuthorization() {
        when(repository.find(eq(TENANT_ID), any()))
                .thenAnswer(invocation -> record(invocation.getArgument(1),
                        "MANUAL", "ACTIVE", "CUSTOM"));

        LogisticsAuthorizationRecord created = service.create(actor(),
                new LogisticsAuthorizationService.AuthorizationInput(
                        " custom ", " custom ", " UAT Manual Carrier ",
                        " UAT Account ", " manual ", null,
                        " Warehouse Team ", " UAT loop "));

        assertThat(created.status()).isEqualTo("ACTIVE");
        verify(repository).insert(any(), eq(TENANT_ID),
                eq(new LogisticsAuthorizationService.AuthorizationInput(
                        "CUSTOM", "CUSTOM", "UAT Manual Carrier", "UAT Account",
                        "MANUAL", null, "Warehouse Team", "UAT loop")), eq(actor()));
        verify(audits).recordAtomically(any());
    }

    @Test
    void encryptsDirectCredentialsWithoutTrimmingSecretValues() {
        when(repository.find(eq(TENANT_ID), any()))
                .thenAnswer(invocation -> record(invocation.getArgument(1),
                        "DIRECT_CREDENTIALS", "PENDING", "CHUDA"));
        CredentialMaterial credentials = new CredentialMaterial(
                " yun-user ", " secret with spaces ", " key-value ");

        LogisticsAuthorizationRecord created = service.create(actor(),
                new LogisticsAuthorizationService.AuthorizationInput(
                        "PLATFORM", "CHUDA", "触达物流", "华南发货账号",
                        "DIRECT_CREDENTIALS", null, null, null), credentials);

        assertThat(created.status()).isEqualTo("PENDING");
        ArgumentCaptor<EncryptedCredential> encrypted =
                ArgumentCaptor.forClass(EncryptedCredential.class);
        verify(repository).saveCredential(eq(created.id()), eq(TENANT_ID),
                encrypted.capture(), eq(actor()));
        CredentialMaterial decrypted = cipher.decrypt(TENANT_ID, created.id(),
                "CHUDA", new LogisticsCredentialCipher.StoredCredential(
                        encrypted.getValue().keyVersion(), encrypted.getValue().nonce(),
                        encrypted.getValue().ciphertext()));
        assertThat(decrypted.username()).isEqualTo("yun-user");
        assertThat(decrypted.password()).isEqualTo(" secret with spaces ");
        assertThat(decrypted.key()).isEqualTo(" key-value ");
        assertThat(new String(encrypted.getValue().ciphertext(),
                java.nio.charset.StandardCharsets.UTF_8))
                .doesNotContain("secret with spaces", "yun-user");
    }

    @Test
    void probesEncryptedCredentialsAndActivatesOnlyAfterSuccessfulConnection() {
        UUID id = UUID.randomUUID();
        LogisticsAuthorizationRecord pending = record(
                id, "DIRECT_CREDENTIALS", "PENDING", "YUNEXPRESS");
        LogisticsAuthorizationRecord active = record(
                id, "DIRECT_CREDENTIALS", "ACTIVE", "YUNEXPRESS");
        var encrypted = cipher.encrypt(TENANT_ID, id, "YUNEXPRESS",
                new CredentialMaterial("user", "password", null));
        when(repository.find(TENANT_ID, id)).thenReturn(pending);
        when(repository.findCredential(TENANT_ID, id)).thenReturn(
                new LogisticsCredentialCipher.StoredCredential(
                        encrypted.keyVersion(), encrypted.nonce(), encrypted.ciphertext()));
        when(connector.probe(any())).thenReturn(
                new ProbeResult("CONNECTED", "物流商连接成功。"));
        when(probeFinalizer.complete(actor(), pending, 0,
                new ProbeResult("CONNECTED", "物流商连接成功。")))
                .thenReturn(active);

        var outcome = service.probe(actor(), id, 0);

        assertThat(outcome.status()).isEqualTo("CONNECTED");
        assertThat(outcome.authorization().status()).isEqualTo("ACTIVE");
        verify(probeFinalizer).complete(actor(), pending, 0,
                new ProbeResult("CONNECTED", "物流商连接成功。"));
        ArgumentCaptor<LogisticsProviderConnectorGateway.ProbeRequest> request =
                ArgumentCaptor.forClass(
                        LogisticsProviderConnectorGateway.ProbeRequest.class);
        verify(connector).probe(request.capture());
        assertThat(request.getValue().credentials().password()).isEqualTo("password");
        assertThat(request.getValue().toString()).doesNotContain("password");
    }

    @Test
    void replacesCredentialsAndReturnsConnectionToPending() {
        UUID id = UUID.randomUUID();
        LogisticsAuthorizationRecord active = record(
                id, "DIRECT_CREDENTIALS", "ACTIVE", "BIAOJU");
        LogisticsAuthorizationRecord pending = new LogisticsAuthorizationRecord(
                id, active.category(), active.providerCode(), active.providerName(),
                active.accountLabel(), active.integrationMode(), true, "ENCRYPTED",
                active.contactName(), active.note(), "PENDING",
                active.createdByDisplayName(), 2, active.createdAt(), active.updatedAt());
        when(repository.find(TENANT_ID, id)).thenReturn(active, pending);
        when(repository.prepareCredentialReplacement(TENANT_ID, id, 1, actor()))
                .thenReturn(true);

        LogisticsAuthorizationRecord replaced = service.replaceCredentials(
                actor(), id, 1, new CredentialMaterial(
                        "new-user@example.com", " new secret ", null));

        assertThat(replaced.status()).isEqualTo("PENDING");
        assertThat(replaced.version()).isEqualTo(2);
        ArgumentCaptor<EncryptedCredential> encrypted =
                ArgumentCaptor.forClass(EncryptedCredential.class);
        verify(repository).saveCredential(eq(id), eq(TENANT_ID),
                encrypted.capture(), eq(actor()));
        CredentialMaterial decrypted = cipher.decrypt(TENANT_ID, id, "BIAOJU",
                new LogisticsCredentialCipher.StoredCredential(
                        encrypted.getValue().keyVersion(), encrypted.getValue().nonce(),
                        encrypted.getValue().ciphertext()));
        assertThat(decrypted.username()).isEqualTo("new-user@example.com");
        assertThat(decrypted.password()).isEqualTo(" new secret ");
        verify(audits).recordAtomically(any());
    }

    @Test
    void renamesFreightAccountWithoutReplacingCredentialsOrChangingStatus() {
        UUID id = UUID.randomUUID();
        LogisticsAuthorizationRecord active = record(
                id, "DIRECT_CREDENTIALS", "ACTIVE", "BIAOJU");
        LogisticsAuthorizationRecord renamed = new LogisticsAuthorizationRecord(
                id, active.category(), active.providerCode(), active.providerName(),
                "美西仓账号", active.integrationMode(), true, "ENCRYPTED",
                active.contactName(), active.note(), active.status(),
                active.createdByDisplayName(), 2, active.createdAt(), active.updatedAt());
        when(repository.find(TENANT_ID, id)).thenReturn(active, renamed);
        when(repository.updateAccountLabel(TENANT_ID, id, 1,
                "美西仓账号", actor())).thenReturn(true);

        LogisticsAuthorizationRecord result = service.renameAccount(
                actor(), id, 1, " 美西仓账号 ");

        assertThat(result.accountLabel()).isEqualTo("美西仓账号");
        assertThat(result.status()).isEqualTo("ACTIVE");
        verify(repository).updateAccountLabel(
                TENANT_ID, id, 1, "美西仓账号", actor());
        verify(audits).recordAtomically(any());
    }

    @Test
    void enablesDisabledConnectionWithoutDiscardingSavedCredentials() {
        UUID id = UUID.randomUUID();
        LogisticsAuthorizationRecord disabled = record(
                id, "DIRECT_CREDENTIALS", "ARCHIVED", "BIAOJU");
        LogisticsAuthorizationRecord pending = new LogisticsAuthorizationRecord(
                id, disabled.category(), disabled.providerCode(), disabled.providerName(),
                disabled.accountLabel(), disabled.integrationMode(), true, "ENCRYPTED",
                disabled.contactName(), disabled.note(), "PENDING",
                disabled.createdByDisplayName(), 1, disabled.createdAt(), disabled.updatedAt());
        when(repository.find(TENANT_ID, id)).thenReturn(disabled, pending);
        when(repository.findCredential(TENANT_ID, id)).thenReturn(
                new LogisticsCredentialCipher.StoredCredential(
                        "v1", new byte[12], new byte[17]));
        when(repository.enable(TENANT_ID, id, 0, actor())).thenReturn(true);

        LogisticsAuthorizationRecord enabled = service.enable(actor(), id, 0);

        assertThat(enabled.status()).isEqualTo("PENDING");
        verify(repository).enable(TENANT_ID, id, 0, actor());
        verify(audits).recordAtomically(any());
    }

    @Test
    void disablesAllChannelsWhenTheProviderAccountIsDisabled() {
        UUID id = UUID.randomUUID();
        LogisticsAuthorizationRecord active = record(
                id, "DIRECT_CREDENTIALS", "ACTIVE", "CHUDA");
        LogisticsAuthorizationRecord archived = new LogisticsAuthorizationRecord(
                id, active.category(), active.providerCode(), active.providerName(),
                active.accountLabel(), active.integrationMode(), true, "ENCRYPTED",
                active.contactName(), active.note(), "ARCHIVED",
                active.createdByDisplayName(), 2, active.createdAt(), active.updatedAt());
        when(repository.find(TENANT_ID, id)).thenReturn(active, archived);
        when(repository.archive(TENANT_ID, id, 1, actor())).thenReturn(true);

        LogisticsAuthorizationRecord result = service.archive(actor(), id, 1);

        assertThat(result.status()).isEqualTo("ARCHIVED");
        verify(repository).disableAllChannels(TENANT_ID, id, actor());
        verify(audits).recordAtomically(any());
    }

    @Test
    void enablesAnAvailableChannelForAnActiveProviderAccount() {
        UUID authorizationId = UUID.randomUUID();
        UUID channelId = UUID.randomUUID();
        LogisticsAuthorizationRecord active = record(
                authorizationId, "DIRECT_CREDENTIALS", "ACTIVE", "CHUDA");
        Instant time = Instant.parse("2026-08-10T00:00:00Z");
        LogisticsAuthorizationChannelRecord disabled =
                new LogisticsAuthorizationChannelRecord(
                        channelId, authorizationId, "CHUDA", "触达物流",
                        "华南发货账号", "ACTIVE", "US-01", "美国专线",
                        false, true, false, 0, time, time);
        LogisticsAuthorizationChannelRecord enabled =
                new LogisticsAuthorizationChannelRecord(
                        channelId, authorizationId, "CHUDA", "触达物流",
                        "华南发货账号", "ACTIVE", "US-01", "美国专线",
                        true, true, true, 1, time, time);
        when(repository.find(TENANT_ID, authorizationId)).thenReturn(active);
        when(repository.findChannel(TENANT_ID, authorizationId, channelId))
                .thenReturn(disabled, enabled);
        when(repository.setChannelEnabled(TENANT_ID, authorizationId,
                channelId, 0, true, actor())).thenReturn(true);

        LogisticsAuthorizationChannelRecord result = service.setChannelEnabled(
                actor(), authorizationId, channelId, 0, true);

        assertThat(result.effectiveEnabled()).isTrue();
        verify(audits).recordAtomically(any());
    }

    @Test
    void unbindsOnlyDisabledConnectionAndKeepsAnAuditRecord() {
        UUID id = UUID.randomUUID();
        LogisticsAuthorizationRecord disabled = record(
                id, "DIRECT_CREDENTIALS", "ARCHIVED", "CHUDA");
        when(repository.find(TENANT_ID, id)).thenReturn(disabled);
        when(repository.deleteArchived(TENANT_ID, id, 0)).thenReturn(true);

        service.unbind(actor(), id, 0);

        verify(repository).deleteArchived(TENANT_ID, id, 0);
        verify(audits).recordAtomically(any());
    }

    @Test
    void rejectsDuplicateDisabledAccountAndDirectsOperatorToEnableIt() {
        LogisticsAuthorizationService.AuthorizationInput input =
                new LogisticsAuthorizationService.AuthorizationInput(
                        "PLATFORM", "BIAOJU", "镖锔科技物流", "华南账号",
                        "DIRECT_CREDENTIALS", null, null, null);
        when(repository.findByIdentity(
                TENANT_ID, "PLATFORM", "镖锔科技物流", "华南账号"))
                .thenReturn(record(UUID.randomUUID(),
                        "DIRECT_CREDENTIALS", "ARCHIVED", "BIAOJU"));

        assertThatThrownBy(() -> service.create(actor(), input,
                new CredentialMaterial("user", "secret", null)))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("enable or update");
    }

    @Test
    void acceptsLegacyOpaqueCredentialReferenceButRejectsPlaintextSecret() {
        when(repository.find(eq(TENANT_ID), any()))
                .thenAnswer(invocation -> record(invocation.getArgument(1),
                        "CREDENTIAL_REFERENCE", "PENDING", "CUSTOM"));
        LogisticsAuthorizationRecord created = service.create(actor(),
                new LogisticsAuthorizationService.AuthorizationInput(
                        "PLATFORM", "CUSTOM", "Carrier", "Account",
                        "CREDENTIAL_REFERENCE",
                        "credential://logistics/uat/account", null, null));
        assertThat(created.status()).isEqualTo("PENDING");

        assertThatThrownBy(() -> service.create(actor(),
                new LogisticsAuthorizationService.AuthorizationInput(
                        "PLATFORM", "CUSTOM", "Carrier", "Account 2",
                        "CREDENTIAL_REFERENCE", "plain-secret", null, null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("plaintext credentials are forbidden");
    }

    private static LogisticsAuthorizationService.Actor actor() {
        return new LogisticsAuthorizationService.Actor(
                TENANT_ID, USER_ID, null, "UAT Operator",
                "logistics-authorization-uat", "127.0.0.1");
    }

    private static LogisticsAuthorizationRecord record(UUID id, String mode,
            String status, String providerCode) {
        Instant time = Instant.parse("2026-08-10T00:00:00Z");
        boolean manual = "MANUAL".equals(mode);
        return new LogisticsAuthorizationRecord(id, "CUSTOM", providerCode,
                "UAT Manual Carrier", "UAT Account", mode, !manual,
                manual ? null : "ENCRYPTED", "Warehouse Team", "UAT loop", status,
                "UAT Operator", "ACTIVE".equals(status) && !manual ? 1 : 0,
                time, time);
    }
}
