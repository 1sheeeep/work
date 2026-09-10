package cn.xzkj.erp.iam.domain;

import java.util.regex.Pattern;

/** Canonical email-or-phone login identifiers shared by all ERP accounts. */
public final class LoginIdentifier {

    private static final Pattern MAINLAND_CHINA_MOBILE =
            Pattern.compile("^1[3-9][0-9]{9}$");

    private LoginIdentifier() {
    }

    public static Normalized normalizeRequired(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Login identifier is required");
        }
        String candidate = value.strip();
        if (BusinessEmailAddress.isValid(candidate)) {
            String email = BusinessEmailAddress.normalize(candidate);
            return new Normalized(email, email, null);
        }
        String phone = normalizePhone(candidate);
        if (phone != null) {
            return new Normalized(phone, null, phone);
        }
        throw new IllegalArgumentException("Login identifier must be an email or phone number");
    }

    public static String normalizePhone(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String candidate = value.strip()
                .replace(" ", "")
                .replace("-", "");
        if (MAINLAND_CHINA_MOBILE.matcher(candidate).matches()) {
            candidate = "+86" + candidate;
        }
        try {
            return E164PhoneNumber.normalizeNullable(candidate);
        } catch (IllegalArgumentException invalidPhone) {
            return null;
        }
    }

    public record Normalized(String username, String email, String phoneNumber) {
    }
}
