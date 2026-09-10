package cn.xzkj.erp.iam.domain;

import java.util.Locale;
import java.util.regex.Pattern;

public final class BusinessEmailAddress {

    private static final Pattern FORMAT = Pattern.compile(
            "^[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
                    + "(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$");

    private BusinessEmailAddress() {
    }

    public static String normalize(String value) {
        if (value == null) {
            throw new IllegalArgumentException("Email is required");
        }
        String normalized = value.strip().toLowerCase(Locale.ROOT);
        int separator = normalized.indexOf('@');
        if (normalized.length() < 3
                || normalized.length() > 254
                || separator < 1
                || separator > 64
                || normalized.charAt(0) == '.'
                || normalized.charAt(separator - 1) == '.'
                || normalized.substring(0, separator).contains("..")
                || !FORMAT.matcher(normalized).matches()) {
            throw new IllegalArgumentException("Invalid business email");
        }
        return normalized;
    }

    public static boolean isValid(String value) {
        try {
            normalize(value);
            return true;
        } catch (IllegalArgumentException invalidEmail) {
            return false;
        }
    }
}
