package cn.xzkj.erp.iam.domain;

import java.util.Objects;
import java.util.regex.Pattern;

/**
 * Stable feature permission identifier using either dotted module-action
 * segments or the platform integration colon convention.
 */
public record PermissionCode(String value) {

    private static final Pattern FORMAT =
            Pattern.compile(
                    "^(?:[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+"
                            + "|[a-z][a-z0-9_]*(?::[a-z][a-z0-9_]*)+)$");

    public PermissionCode {
        Objects.requireNonNull(value, "value");
        if (!FORMAT.matcher(value).matches()) {
            throw new IllegalArgumentException(
                    "Permission code must use lowercase segments with one delimiter");
        }
    }

    @Override
    public String toString() {
        return value;
    }
}
