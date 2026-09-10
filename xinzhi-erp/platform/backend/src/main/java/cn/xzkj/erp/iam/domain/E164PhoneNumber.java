package cn.xzkj.erp.iam.domain;

import java.util.regex.Pattern;

public final class E164PhoneNumber {

    private static final Pattern FORMAT =
            Pattern.compile("^\\+[1-9][0-9]{7,14}$");

    private E164PhoneNumber() {
    }

    public static String normalizeNullable(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String normalized = value.strip();
        if (!FORMAT.matcher(normalized).matches()) {
            throw new IllegalArgumentException("Invalid E.164 phone number");
        }
        return normalized;
    }
}
