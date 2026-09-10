package cn.xzkj.erp.platformadmin.shopifyrelease;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import cn.xzkj.erp.platformadmin.shopifyrelease.ShopifyAppReleaseCredentialCipher.EncryptedToken;
import cn.xzkj.erp.platformadmin.shopifyrelease.ShopifyAppReleaseCredentialCipher.StoredToken;
import java.util.Arrays;
import java.util.Base64;
import org.junit.jupiter.api.Test;

class ShopifyAppReleaseCredentialCipherTest {
    private static final String KEY_A = Base64.getEncoder()
            .encodeToString("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".getBytes());
    private static final String KEY_B = Base64.getEncoder()
            .encodeToString("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".getBytes());

    @Test
    void encryptsWithRandomNoncesAndNeverRendersSecretMaterial() {
        ShopifyAppReleaseCredentialCipher cipher =
                new ShopifyAppReleaseCredentialCipher(KEY_A);
        char[] plain = "shopify-automation-token-for-test".toCharArray();

        EncryptedToken first = cipher.encrypt(plain);
        EncryptedToken second = cipher.encrypt(plain);
        char[] decrypted = cipher.decrypt(new StoredToken(
                first.keyVersion(), first.nonce(), first.ciphertext()));

        assertThat(first.nonce()).hasSize(12).isNotEqualTo(second.nonce());
        assertThat(first.ciphertext()).isNotEqualTo(second.ciphertext());
        assertThat(decrypted).containsExactly(plain);
        assertThat(first.toString()).isEqualTo("EncryptedToken[REDACTED]");
        Arrays.fill(decrypted, '\0');
        Arrays.fill(plain, '\0');
    }

    @Test
    void refusesCiphertextEncryptedWithAnotherKey() {
        ShopifyAppReleaseCredentialCipher source =
                new ShopifyAppReleaseCredentialCipher(KEY_A);
        ShopifyAppReleaseCredentialCipher other =
                new ShopifyAppReleaseCredentialCipher(KEY_B);
        EncryptedToken encrypted = source.encrypt(
                "shopify-automation-token-for-test".toCharArray());

        assertThatThrownBy(() -> other.decrypt(new StoredToken(
                encrypted.keyVersion(), encrypted.nonce(),
                encrypted.ciphertext())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("Stored Shopify Automation Token is unavailable");
    }
}
