package cn.xzkj.erp.order.domain;

import java.util.regex.Pattern;

import cn.xzkj.erp.platform.domain.SensitiveTextRedactor;

public final class BuyerReferenceSanitizer {
    private static final Pattern EMAIL = Pattern.compile(
            "(?i)\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b");
    private static final Pattern PHONE = Pattern.compile(
            "(?<![0-9])\\+?[0-9][0-9 ()-]{5,18}[0-9](?![0-9])");

    private BuyerReferenceSanitizer() { }

    public static String sanitize(String value) {
        String safe = SensitiveTextRedactor.redactNullable(value);
        if (safe == null) { return null; }
        safe = EMAIL.matcher(safe).replaceAll("[REDACTED_EMAIL]");
        safe = PHONE.matcher(safe).replaceAll("[REDACTED_PHONE]");
        return safe.length() <= 200 ? safe : safe.substring(0, 200);
    }
}
