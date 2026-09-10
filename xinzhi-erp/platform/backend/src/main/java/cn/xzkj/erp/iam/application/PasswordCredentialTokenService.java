package cn.xzkj.erp.iam.application;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import java.util.HexFormat;
import org.springframework.stereotype.Service;

@Service
public class PasswordCredentialTokenService {

    private static final int TOKEN_BYTES = 32;

    private final SecureRandom secureRandom;

    public PasswordCredentialTokenService(SecureRandom secureRandom) {
        this.secureRandom = secureRandom;
    }

    public GeneratedToken generate() {
        byte[] randomBytes = new byte[TOKEN_BYTES];
        secureRandom.nextBytes(randomBytes);
        try {
            String rawToken = Base64.getUrlEncoder()
                    .withoutPadding()
                    .encodeToString(randomBytes);
            return new GeneratedToken(rawToken, sha256(rawToken));
        } finally {
            Arrays.fill(randomBytes, (byte) 0);
        }
    }

    /**
     * Hashes and clears a token received from a request. Token shape is
     * deliberately not reported to callers so all unusable values share one
     * public error.
     */
    public String hashPresented(char[] rawToken) {
        if (rawToken == null) {
            throw new InvalidPasswordCredentialException();
        }
        try {
            return sha256(rawToken);
        } finally {
            Arrays.fill(rawToken, '\0');
        }
    }

    private static String sha256(char[] value) {
        ByteBuffer encoded = StandardCharsets.UTF_8.encode(CharBuffer.wrap(value));
        byte[] bytes = new byte[encoded.remaining()];
        encoded.get(bytes);
        try {
            return sha256(bytes);
        } finally {
            Arrays.fill(bytes, (byte) 0);
            if (encoded.hasArray()) {
                Arrays.fill(encoded.array(), (byte) 0);
            }
        }
    }

    private static String sha256(CharSequence value) {
        byte[] bytes = value.toString().getBytes(StandardCharsets.UTF_8);
        try {
            return sha256(bytes);
        } finally {
            Arrays.fill(bytes, (byte) 0);
        }
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    public record GeneratedToken(String rawToken, String tokenHash) {
    }
}
