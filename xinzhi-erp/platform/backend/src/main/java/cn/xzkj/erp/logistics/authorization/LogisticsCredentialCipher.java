package cn.xzkj.erp.logistics.authorization;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
final class LogisticsCredentialCipher {
    static final String KEY_VERSION = "v1";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int NONCE_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final int PAYLOAD_VERSION = 1;
    private final SecureRandom random = new SecureRandom();
    private final byte[] key;

    LogisticsCredentialCipher(
            @Value("${erp.logistics-connector.credential-key:}") String encodedKey) {
        if (encodedKey == null || encodedKey.isBlank()) {
            key = null;
            return;
        }
        try {
            key = Base64.getDecoder().decode(encodedKey.strip());
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException(
                    "Logistics credential encryption key is invalid", exception);
        }
        if (key.length != 32) {
            throw new IllegalStateException(
                    "Logistics credential encryption key must contain 32 bytes");
        }
    }

    boolean configured() {
        return key != null;
    }

    EncryptedCredential encrypt(UUID tenantId, UUID authorizationId,
            String providerCode, CredentialMaterial material) {
        requireConfigured();
        byte[] plain = encode(material);
        byte[] nonce = new byte[NONCE_BYTES];
        random.nextBytes(nonce);
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"),
                    new GCMParameterSpec(TAG_BITS, nonce));
            cipher.updateAAD(aad(tenantId, authorizationId, providerCode));
            return new EncryptedCredential(KEY_VERSION, nonce,
                    cipher.doFinal(plain));
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException(
                    "Logistics credentials could not be encrypted", exception);
        } finally {
            Arrays.fill(plain, (byte) 0);
        }
    }

    CredentialMaterial decrypt(UUID tenantId, UUID authorizationId,
            String providerCode, StoredCredential stored) {
        requireConfigured();
        if (stored == null || !KEY_VERSION.equals(stored.keyVersion())
                || stored.nonce() == null || stored.nonce().length != NONCE_BYTES
                || stored.ciphertext() == null || stored.ciphertext().length < 17) {
            throw new IllegalStateException(
                    "Stored logistics credentials are unavailable");
        }
        byte[] plain = null;
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"),
                    new GCMParameterSpec(TAG_BITS, stored.nonce()));
            cipher.updateAAD(aad(tenantId, authorizationId, providerCode));
            plain = cipher.doFinal(stored.ciphertext());
            return decode(plain);
        } catch (GeneralSecurityException | java.io.IOException exception) {
            throw new IllegalStateException(
                    "Stored logistics credentials are unavailable", exception);
        } finally {
            if (plain != null) Arrays.fill(plain, (byte) 0);
        }
    }

    EncryptedCredential encryptProvider(String providerCode,
            ProviderCredentialMaterial material) {
        requireConfigured();
        byte[] plain = encodeProvider(material);
        byte[] nonce = new byte[NONCE_BYTES];
        random.nextBytes(nonce);
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"),
                    new GCMParameterSpec(TAG_BITS, nonce));
            cipher.updateAAD(providerAad(providerCode));
            return new EncryptedCredential(KEY_VERSION, nonce,
                    cipher.doFinal(plain));
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException(
                    "Logistics provider credentials could not be encrypted",
                    exception);
        } finally {
            Arrays.fill(plain, (byte) 0);
        }
    }

    ProviderCredentialMaterial decryptProvider(String providerCode,
            StoredCredential stored) {
        requireConfigured();
        validateStored(stored);
        byte[] plain = null;
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"),
                    new GCMParameterSpec(TAG_BITS, stored.nonce()));
            cipher.updateAAD(providerAad(providerCode));
            plain = cipher.doFinal(stored.ciphertext());
            return decodeProvider(plain);
        } catch (GeneralSecurityException | java.io.IOException exception) {
            throw new IllegalStateException(
                    "Stored logistics provider credentials are unavailable",
                    exception);
        } finally {
            if (plain != null) Arrays.fill(plain, (byte) 0);
        }
    }

    private void requireConfigured() {
        if (!configured()) {
            throw new IllegalStateException(
                    "Logistics credential storage is not configured");
        }
    }

    private static byte[] encode(CredentialMaterial value) {
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (DataOutputStream output = new DataOutputStream(bytes)) {
                output.writeInt(PAYLOAD_VERSION);
                output.writeUTF(value.username());
                output.writeUTF(value.password());
                output.writeBoolean(value.key() != null);
                if (value.key() != null) output.writeUTF(value.key());
            }
            return bytes.toByteArray();
        } catch (java.io.IOException exception) {
            throw new IllegalStateException(
                    "Logistics credentials could not be encoded", exception);
        }
    }

    private static byte[] encodeProvider(ProviderCredentialMaterial value) {
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (DataOutputStream output = new DataOutputStream(bytes)) {
                output.writeInt(PAYLOAD_VERSION);
                output.writeUTF(value.customerCode());
                output.writeUTF(value.authorizationCode());
                output.writeUTF(value.secret());
            }
            return bytes.toByteArray();
        } catch (java.io.IOException exception) {
            throw new IllegalStateException(
                    "Logistics provider credentials could not be encoded",
                    exception);
        }
    }

    private static CredentialMaterial decode(byte[] bytes) throws java.io.IOException {
        try (DataInputStream input = new DataInputStream(
                new ByteArrayInputStream(bytes))) {
            if (input.readInt() != PAYLOAD_VERSION) {
                throw new java.io.IOException("Unsupported payload version");
            }
            CredentialMaterial value = new CredentialMaterial(
                    input.readUTF(), input.readUTF(),
                    input.readBoolean() ? input.readUTF() : null);
            if (input.read() != -1) {
                throw new java.io.IOException("Unexpected credential payload data");
            }
            return value;
        }
    }

    private static ProviderCredentialMaterial decodeProvider(byte[] bytes)
            throws java.io.IOException {
        try (DataInputStream input = new DataInputStream(
                new ByteArrayInputStream(bytes))) {
            if (input.readInt() != PAYLOAD_VERSION) {
                throw new java.io.IOException("Unsupported payload version");
            }
            ProviderCredentialMaterial value = new ProviderCredentialMaterial(
                    input.readUTF(), input.readUTF(), input.readUTF());
            if (input.read() != -1) {
                throw new java.io.IOException(
                        "Unexpected provider credential payload data");
            }
            return value;
        }
    }

    private static byte[] aad(UUID tenantId, UUID authorizationId,
            String providerCode) {
        if (tenantId == null || authorizationId == null
                || providerCode == null || providerCode.isBlank()) {
            throw new IllegalArgumentException(
                    "Credential encryption identity is required");
        }
        return ("xz-erp-logistics-credential-v1\n" + tenantId + "\n"
                + authorizationId + "\n" + providerCode)
                .getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] providerAad(String providerCode) {
        if (providerCode == null || providerCode.isBlank()) {
            throw new IllegalArgumentException(
                    "Provider credential encryption identity is required");
        }
        return ("xz-erp-logistics-provider-credential-v1\n" + providerCode)
                .getBytes(StandardCharsets.UTF_8);
    }

    private static void validateStored(StoredCredential stored) {
        if (stored == null || !KEY_VERSION.equals(stored.keyVersion())
                || stored.nonce() == null || stored.nonce().length != NONCE_BYTES
                || stored.ciphertext() == null
                || stored.ciphertext().length < 17) {
            throw new IllegalStateException(
                    "Stored logistics provider credentials are unavailable");
        }
    }

    record CredentialMaterial(String username, String password, String key) {
        @Override
        public String toString() {
            return "CredentialMaterial[REDACTED]";
        }
    }

    record ProviderCredentialMaterial(String customerCode,
            String authorizationCode, String secret) {
        @Override
        public String toString() {
            return "ProviderCredentialMaterial[REDACTED]";
        }
    }

    record EncryptedCredential(String keyVersion, byte[] nonce,
            byte[] ciphertext) {
        @Override
        public String toString() {
            return "EncryptedCredential[REDACTED]";
        }
    }

    record StoredCredential(String keyVersion, byte[] nonce,
            byte[] ciphertext) {
        @Override
        public String toString() {
            return "StoredCredential[REDACTED]";
        }
    }
}
