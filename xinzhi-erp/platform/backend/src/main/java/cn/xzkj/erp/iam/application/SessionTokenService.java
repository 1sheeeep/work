package cn.xzkj.erp.iam.application;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class SessionTokenService {

    private static final int TOKEN_BYTES = 32;

    private final SecureRandom secureRandom;
    private final Clock clock;
    private final Duration sessionTtl;

    public SessionTokenService(
            SecureRandom secureRandom,
            Clock clock,
            @Value("${erp.security.session-ttl:PT8H}") Duration sessionTtl) {
        if (sessionTtl.isNegative() || sessionTtl.isZero()
                || sessionTtl.compareTo(Duration.ofDays(1)) > 0) {
            throw new IllegalArgumentException("Session TTL must be between 1 second and 24 hours");
        }
        this.secureRandom = secureRandom;
        this.clock = clock;
        this.sessionTtl = sessionTtl;
    }

    public IssuedToken issue() {
        byte[] bytes = new byte[TOKEN_BYTES];
        secureRandom.nextBytes(bytes);
        String rawToken = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        return new IssuedToken(rawToken, hash(rawToken), clock.instant().plus(sessionTtl));
    }

    public String hash(String rawToken) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(rawToken.getBytes(StandardCharsets.US_ASCII));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is not available", exception);
        }
    }

    public record IssuedToken(String rawValue, String hash, Instant expiresAt) {
    }
}
