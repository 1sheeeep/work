package ai.xzkj.recruitment.auth;

import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.config.SecurityProperties;
import org.springframework.http.HttpStatus;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class LoginAttemptService {
    private final SecurityProperties properties;
    private final Clock clock;
    private final ConcurrentHashMap<String, Attempt> attempts = new ConcurrentHashMap<>();

    @Autowired public LoginAttemptService(SecurityProperties properties) { this(properties, Clock.systemUTC()); }
    LoginAttemptService(SecurityProperties properties, Clock clock) { this.properties = properties; this.clock = clock; }

    public void checkAllowed(String remoteAddress, String username) {
        String key = key(remoteAddress, username);
        Attempt attempt = attempts.get(key);
        Instant now = clock.instant();
        if (attempt != null && attempt.blockedUntil() != null && attempt.blockedUntil().isAfter(now)) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "LOGIN_RATE_LIMITED", "登录尝试过多，请稍后再试");
        }
        if (attempt != null && attempt.windowStartedAt().plus(properties.loginWindow()).isBefore(now)) attempts.remove(key, attempt);
    }

    public void recordFailure(String remoteAddress, String username) {
        String key = key(remoteAddress, username);
        Instant now = clock.instant();
        attempts.compute(key, (ignored, previous) -> {
            Attempt current = previous == null || previous.windowStartedAt().plus(properties.loginWindow()).isBefore(now)
                    ? new Attempt(0, now, null) : previous;
            int failures = current.failures() + 1;
            Instant blockedUntil = failures >= properties.loginMaxFailures() ? now.plus(properties.loginBlockDuration()) : null;
            return new Attempt(failures, current.windowStartedAt(), blockedUntil);
        });
    }

    public void recordSuccess(String remoteAddress, String username) { attempts.remove(key(remoteAddress, username)); }
    public String anonymousReference(String username) { return "login:" + digest(normalize(username)).substring(0, 12); }

    private String key(String remoteAddress, String username) { return digest((remoteAddress == null ? "unknown" : remoteAddress) + "|" + normalize(username)); }
    private String normalize(String value) { return value == null ? "" : value.trim().toLowerCase(Locale.ROOT); }
    private String digest(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception exception) { throw new IllegalStateException("SHA-256 unavailable", exception); }
    }
    private record Attempt(int failures, Instant windowStartedAt, Instant blockedUntil) {}
}
