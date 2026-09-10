package cn.xzkj.erp.platform.domain;

import java.util.regex.Pattern;

public final class CredentialReferenceValidator {

    public static final String REFERENCE_PATTERN =
            "^(?:vault|credential)://[A-Za-z0-9][A-Za-z0-9._/-]*(?:#[A-Za-z0-9._-]+)?$";

    private static final Pattern VALID_REFERENCE = Pattern.compile(REFERENCE_PATTERN);

    private CredentialReferenceValidator() {
    }

    public static String validateNullable(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String candidate = value.trim();
        if (candidate.length() > 512 || !VALID_REFERENCE.matcher(candidate).matches()) {
            throw new IllegalArgumentException(
                    "Credential must be a vault:// or credential:// reference; plaintext credentials are forbidden"
            );
        }
        return candidate;
    }

    public static String referenceType(String value) {
        if (value == null) {
            return null;
        }
        return value.substring(0, value.indexOf("://")).toUpperCase();
    }
}
