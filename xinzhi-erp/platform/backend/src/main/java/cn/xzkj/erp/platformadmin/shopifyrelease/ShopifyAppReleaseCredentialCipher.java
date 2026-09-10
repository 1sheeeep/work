package cn.xzkj.erp.platformadmin.shopifyrelease;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
final class ShopifyAppReleaseCredentialCipher {
    static final String KEY_VERSION = "v1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final byte[] AAD =
            "xz-erp-shopify-app-release-token-v1"
                    .getBytes(StandardCharsets.UTF_8);
    private static final int NONCE_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final SecureRandom random = new SecureRandom();
    private final byte[] key;

    ShopifyAppReleaseCredentialCipher(
            @Value("${erp.shopify-release.credential-key:}") String encodedKey) {
        if (encodedKey == null || encodedKey.isBlank()) {
            key = null;
            return;
        }
        try {
            key = Base64.getDecoder().decode(encodedKey.strip());
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException(
                    "Shopify release credential encryption key is invalid",
                    exception);
        }
        if (key.length != 32) {
            throw new IllegalStateException(
                    "Shopify release credential encryption key must contain 32 bytes");
        }
    }

    boolean configured() {
        return key != null;
    }

    EncryptedToken encrypt(char[] token) {
        requireConfigured();
        if (token == null || token.length == 0) {
            throw new IllegalArgumentException("Shopify Automation Token is required");
        }
        byte[] plain = new String(token).getBytes(StandardCharsets.UTF_8);
        byte[] nonce = new byte[NONCE_BYTES];
        random.nextBytes(nonce);
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"),
                    new GCMParameterSpec(TAG_BITS, nonce));
            cipher.updateAAD(AAD);
            return new EncryptedToken(KEY_VERSION, nonce,
                    cipher.doFinal(plain));
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException(
                    "Shopify Automation Token could not be encrypted",
                    exception);
        } finally {
            Arrays.fill(plain, (byte) 0);
        }
    }

    char[] decrypt(StoredToken stored) {
        requireConfigured();
        validate(stored);
        byte[] plain = null;
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"),
                    new GCMParameterSpec(TAG_BITS, stored.nonce()));
            cipher.updateAAD(AAD);
            plain = cipher.doFinal(stored.ciphertext());
            return new String(plain, StandardCharsets.UTF_8).toCharArray();
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException(
                    "Stored Shopify Automation Token is unavailable",
                    exception);
        } finally {
            if (plain != null) Arrays.fill(plain, (byte) 0);
        }
    }

    private void requireConfigured() {
        if (!configured()) {
            throw new IllegalStateException(
                    "Shopify release credential storage is not configured");
        }
    }

    private static void validate(StoredToken stored) {
        if (stored == null || !KEY_VERSION.equals(stored.keyVersion())
                || stored.nonce() == null || stored.nonce().length != NONCE_BYTES
                || stored.ciphertext() == null
                || stored.ciphertext().length < 17) {
            throw new IllegalStateException(
                    "Stored Shopify Automation Token is unavailable");
        }
    }

    record EncryptedToken(String keyVersion, byte[] nonce, byte[] ciphertext) {
        @Override
        public String toString() {
            return "EncryptedToken[REDACTED]";
        }
    }

    record StoredToken(String keyVersion, byte[] nonce, byte[] ciphertext) {
        @Override
        public String toString() {
            return "StoredToken[REDACTED]";
        }
    }
}
