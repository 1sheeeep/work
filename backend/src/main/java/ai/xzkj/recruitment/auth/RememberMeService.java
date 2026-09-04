package ai.xzkj.recruitment.auth;

import ai.xzkj.recruitment.config.SecurityProperties;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;

@Service
public class RememberMeService {
    static final String COOKIE_NAME = "RECRUITMENT_REMEMBER";
    private final RememberMeTokenRepository repository;
    private final SecurityProperties properties;
    private final SecureRandom random = new SecureRandom();

    public RememberMeService(RememberMeTokenRepository repository, SecurityProperties properties) {
        this.repository = repository;
        this.properties = properties;
    }

    @Transactional
    public void issue(SystemUser user, HttpServletRequest request, HttpServletResponse response) {
        revokeExisting(request, Instant.now());
        Instant now = Instant.now();
        String secret = secret();
        RememberMeToken token = repository.save(new RememberMeToken(
                user, digest(secret), now.plus(properties.rememberMeDuration()), now));
        writeCookie(response, token.getId(), secret, properties.rememberMeDuration().toSeconds());
    }

    @Transactional
    public Optional<String> restore(HttpServletRequest request, HttpServletResponse response) {
        ParsedCookie parsed = readCookie(request).orElse(null);
        if (parsed == null) return Optional.empty();
        RememberMeToken token = repository.findForUpdateById(parsed.id()).orElse(null);
        Instant now = Instant.now();
        if (token == null || !token.usable(now) || !token.matches(digest(parsed.secret()), now)) {
            if (token != null) token.revoke(now);
            clearCookie(response);
            return Optional.empty();
        }
        String rotatedSecret = secret();
        token.rotate(digest(rotatedSecret), now);
        long remainingSeconds = Math.max(1, token.getExpiresAt().getEpochSecond() - now.getEpochSecond());
        writeCookie(response, token.getId(), rotatedSecret, remainingSeconds);
        return Optional.of(token.getUser().getUsername());
    }

    @Transactional
    public void revoke(HttpServletRequest request, HttpServletResponse response) {
        revokeExisting(request, Instant.now());
        clearCookie(response);
    }

    private void revokeExisting(HttpServletRequest request, Instant now) {
        readCookie(request).flatMap(cookie -> repository.findForUpdateById(cookie.id()))
                .ifPresent(token -> token.revoke(now));
    }

    private Optional<ParsedCookie> readCookie(HttpServletRequest request) {
        if (request.getCookies() == null) return Optional.empty();
        for (Cookie cookie : request.getCookies()) {
            if (!COOKIE_NAME.equals(cookie.getName()) || cookie.getValue() == null) continue;
            String[] parts = cookie.getValue().split("\\.", 2);
            if (parts.length != 2 || parts[1].isBlank()) return Optional.empty();
            try {
                return Optional.of(new ParsedCookie(UUID.fromString(parts[0]), parts[1]));
            } catch (IllegalArgumentException ignored) {
                return Optional.empty();
            }
        }
        return Optional.empty();
    }

    private void writeCookie(HttpServletResponse response, UUID id, String secret, long maxAgeSeconds) {
        ResponseCookie cookie = ResponseCookie.from(COOKIE_NAME, id + "." + secret)
                .httpOnly(true)
                .secure(properties.rememberMeSecureCookie())
                .sameSite("Lax")
                .path("/")
                .maxAge(maxAgeSeconds)
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }

    private void clearCookie(HttpServletResponse response) {
        ResponseCookie cookie = ResponseCookie.from(COOKIE_NAME, "")
                .httpOnly(true)
                .secure(properties.rememberMeSecureCookie())
                .sameSite("Lax")
                .path("/")
                .maxAge(0)
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }

    private String secret() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String digest(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("无法生成登录令牌摘要", exception);
        }
    }

    static boolean constantTimeEquals(String left, String right) {
        return MessageDigest.isEqual(left.getBytes(StandardCharsets.US_ASCII), right.getBytes(StandardCharsets.US_ASCII));
    }

    private record ParsedCookie(UUID id, String secret) {}
}
