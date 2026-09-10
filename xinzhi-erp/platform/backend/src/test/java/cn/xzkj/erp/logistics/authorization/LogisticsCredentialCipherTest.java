package cn.xzkj.erp.logistics.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.CredentialMaterial;
import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.ProviderCredentialMaterial;
import cn.xzkj.erp.logistics.authorization.LogisticsCredentialCipher.StoredCredential;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class LogisticsCredentialCipherTest {
    private final LogisticsCredentialCipher cipher = new LogisticsCredentialCipher(
            Base64.getEncoder().encodeToString(new byte[32]));

    @Test
    void roundTripsCredentialsAndRedactsDiagnosticOutput() {
        UUID tenantId = UUID.randomUUID();
        UUID authorizationId = UUID.randomUUID();
        CredentialMaterial source = new CredentialMaterial(
                "account", "secret value", "optional-key");

        var encrypted = cipher.encrypt(
                tenantId, authorizationId, "YUNEXPRESS", source);
        var restored = cipher.decrypt(tenantId, authorizationId, "YUNEXPRESS",
                new StoredCredential(encrypted.keyVersion(), encrypted.nonce(),
                        encrypted.ciphertext()));

        assertThat(restored).isEqualTo(source);
        assertThat(source.toString()).doesNotContain("account", "secret", "optional-key");
        assertThat(encrypted.toString()).doesNotContain("secret");
    }

    @Test
    void refusesCredentialsBoundToAnotherTenantOrProvider() {
        UUID tenantId = UUID.randomUUID();
        UUID authorizationId = UUID.randomUUID();
        var encrypted = cipher.encrypt(tenantId, authorizationId, "YUNEXPRESS",
                new CredentialMaterial("account", "secret", null));
        StoredCredential stored = new StoredCredential(
                encrypted.keyVersion(), encrypted.nonce(), encrypted.ciphertext());

        assertThatThrownBy(() -> cipher.decrypt(
                UUID.randomUUID(), authorizationId, "YUNEXPRESS", stored))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Stored logistics credentials are unavailable");
        assertThatThrownBy(() -> cipher.decrypt(
                tenantId, authorizationId, "CUSTOM", stored))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Stored logistics credentials are unavailable");
    }

    @Test
    void isolatesAndRedactsPlatformManagedProviderCredentials() {
        ProviderCredentialMaterial source = new ProviderCredentialMaterial(
                "customer-001", "authorization-value", "provider-secret");
        var encrypted = cipher.encryptProvider("CHUDA", source);
        StoredCredential stored = new StoredCredential(encrypted.keyVersion(),
                encrypted.nonce(), encrypted.ciphertext());

        assertThat(cipher.decryptProvider("CHUDA", stored)).isEqualTo(source);
        assertThat(source.toString()).doesNotContain(
                "customer-001", "authorization-value", "provider-secret");
        assertThatThrownBy(() -> cipher.decryptProvider("YUNEXPRESS", stored))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Stored logistics provider credentials are unavailable");
    }

    @Test
    void failsClosedWhenEncryptionKeyIsMissingOrInvalid() {
        LogisticsCredentialCipher missing = new LogisticsCredentialCipher("");
        assertThat(missing.configured()).isFalse();
        assertThatThrownBy(() -> missing.encrypt(UUID.randomUUID(), UUID.randomUUID(),
                "CUSTOM", new CredentialMaterial("account", "secret", null)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Logistics credential storage is not configured");
        assertThatThrownBy(() -> new LogisticsCredentialCipher(
                Base64.getEncoder().encodeToString(new byte[16])))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must contain 32 bytes");
    }
}
