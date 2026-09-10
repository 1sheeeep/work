package cn.xzkj.erp.platform.domain;

import java.util.regex.Pattern;

public final class SensitiveTextRedactor {

    private static final Pattern AUTHORIZATION_HEADER = Pattern.compile(
            "(?i)authorization\\s*[:=]\\s*(?:bearer\\s+)?[^\\s,;]+"
    );
    private static final Pattern BEARER_TOKEN = Pattern.compile(
            "(?i)bearer\\s+[^\\s,;]+"
    );
    private static final Pattern SENSITIVE_ASSIGNMENT = Pattern.compile(
            "(?i)(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)"
                    + "\\s*[:=]\\s*[^\\s,;]+"
    );

    private SensitiveTextRedactor() {
    }

    public static String redactNullable(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String singleLine = value.replaceAll("[\\r\\n\\t]+", " ").trim();
        String redacted = AUTHORIZATION_HEADER.matcher(singleLine).replaceAll("authorization=[REDACTED]");
        redacted = BEARER_TOKEN.matcher(redacted).replaceAll("bearer [REDACTED]");
        redacted = SENSITIVE_ASSIGNMENT.matcher(redacted).replaceAll("$1=[REDACTED]");
        return redacted.length() <= 1000 ? redacted : redacted.substring(0, 1000);
    }
}
