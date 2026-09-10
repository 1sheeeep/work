package cn.xzkj.erp.logistics.authorization;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.HexFormat;
import java.util.Locale;
import tools.jackson.databind.JsonNode;

final class LogisticsProviderPayloadSupport {
    private static final DateTimeFormatter PROVIDER_TIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private LogisticsProviderPayloadSupport() {
    }

    static String text(JsonNode node, String... fields) {
        if (node == null) return null;
        for (String field : fields) {
            JsonNode value = node.path(field);
            if (value.isTextual() || value.isNumber() || value.isBoolean()) {
                String result = value.asText().strip();
                if (!result.isEmpty() && result.length() <= 2048
                        && !"null".equalsIgnoreCase(result)) {
                    return result;
                }
            }
        }
        return null;
    }

    static boolean truthy(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.path(field);
        if (value == null || value.isMissingNode() || value.isNull()) return false;
        if (value.isBoolean()) return value.asBoolean();
        String text = value.asText().strip().toLowerCase(Locale.ROOT);
        return "true".equals(text) || "1".equals(text)
                || "success".equals(text) || "ok".equals(text)
                || "200".equals(text);
    }

    static String normalizeStatus(String raw) {
        if (raw == null || raw.isBlank()) return "UNKNOWN";
        String value = raw.strip().toUpperCase(Locale.ROOT);
        if (contains(value, "DELIVERED", "SIGNED", "签收", "妥投")) {
            return "DELIVERED";
        }
        if (contains(value, "EXCEPTION", "FAILED", "RETURN", "异常", "退回", "拒收")) {
            return "EXCEPTION";
        }
        if (contains(value, "TRANSIT", "SHIPPED", "PICKED", "运输", "在途", "揽收", "发运")) {
            return "IN_TRANSIT";
        }
        if (contains(value, "CREATED", "RECEIVED", "PRE", "创建", "预报", "收单")) {
            return "CREATED";
        }
        return "UNKNOWN";
    }

    static Instant instant(String raw) {
        if (raw == null || raw.isBlank()) return Instant.now();
        try {
            return Instant.parse(raw.strip());
        } catch (DateTimeParseException ignored) {
            try {
                return LocalDateTime.parse(raw.strip(), PROVIDER_TIME)
                        .toInstant(ZoneOffset.ofHours(8));
            } catch (DateTimeParseException second) {
                return Instant.now();
            }
        }
    }

    static String eventKey(String providerStatus, String description,
            String location, Instant occurredAt) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(
                    (nullable(providerStatus) + "\n" + nullable(description)
                            + "\n" + nullable(location) + "\n" + occurredAt)
                            .getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    static String safeSummary(String value) {
        if (value == null || value.isBlank()) return null;
        String normalized = value.replaceAll("[\\p{Cntrl}&&[^\\r\\n\\t]]", "?")
                .strip();
        return normalized.substring(0, Math.min(500, normalized.length()));
    }

    private static boolean contains(String value, String... terms) {
        for (String term : terms) {
            if (value.contains(term.toUpperCase(Locale.ROOT))) return true;
        }
        return false;
    }

    private static String nullable(String value) {
        return value == null ? "" : value;
    }
}
