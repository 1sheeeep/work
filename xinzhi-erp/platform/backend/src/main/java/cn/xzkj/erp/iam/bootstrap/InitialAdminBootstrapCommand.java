package cn.xzkj.erp.iam.bootstrap;

import cn.xzkj.erp.iam.domain.BusinessEmailAddress;
import java.nio.file.Path;
import java.util.regex.Pattern;

public record InitialAdminBootstrapCommand(
        String tenantCode,
        String tenantName,
        String email,
        String displayName,
        Path tokenOutputPath,
        int ttlMinutes) {

    private static final Pattern TENANT_CODE =
            Pattern.compile("^[a-z0-9][a-z0-9_-]{0,63}$");
    public InitialAdminBootstrapCommand {
        if (tenantCode == null
                || !TENANT_CODE.matcher(tenantCode).matches()
                || !BusinessEmailAddress.isValid(email)
                || !boundedText(tenantName, 160)
                || !boundedText(displayName, 160)
                || tokenOutputPath == null
                || !tokenOutputPath.isAbsolute()
                || ttlMinutes < 5
                || ttlMinutes > 120) {
            throw new InitialAdminBootstrapException();
        }
        tenantName = tenantName.strip();
        email = BusinessEmailAddress.normalize(email);
        displayName = displayName.strip();
        tokenOutputPath = tokenOutputPath.normalize();
    }

    private static boolean boundedText(String value, int maximumLength) {
        if (value == null) {
            return false;
        }
        String normalized = value.strip();
        return !normalized.isEmpty() && normalized.length() <= maximumLength;
    }
}
