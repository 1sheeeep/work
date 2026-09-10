package cn.xzkj.erp.iam.bootstrap;

import cn.xzkj.erp.iam.domain.BusinessEmailAddress;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.regex.Pattern;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("erp.bootstrap.initial-admin")
public class InitialAdminBootstrapProperties {

    private static final Pattern TENANT_CODE =
            Pattern.compile("^[a-z0-9][a-z0-9_-]{0,63}$");
    private String tenantCode;
    private String tenantName;
    private String email;
    private String username;
    private String displayName;
    private String tokenOutputPath;
    private Integer ttlMinutes;

    public InitialAdminBootstrapCommand toCommand() {
        boolean hasEmail = email != null && !email.isBlank();
        boolean hasUsername = username != null && !username.isBlank();
        if (!matches(TENANT_CODE, tenantCode)
                || !boundedText(tenantName, 160)
                || hasEmail == hasUsername
                || !boundedText(displayName, 160)
                || ttlMinutes == null
                || ttlMinutes < 5
                || ttlMinutes > 120) {
            throw new InitialAdminBootstrapException();
        }
        String normalizedEmail;
        try {
            normalizedEmail = BusinessEmailAddress.normalize(
                    hasEmail ? email : username);
        } catch (IllegalArgumentException invalidEmail) {
            throw new InitialAdminBootstrapException();
        }
        Path outputPath;
        try {
            outputPath = Path.of(tokenOutputPath == null ? "" : tokenOutputPath)
                    .normalize();
        } catch (InvalidPathException invalidPath) {
            throw new InitialAdminBootstrapException();
        }
        if (!outputPath.isAbsolute()) {
            throw new InitialAdminBootstrapException();
        }
        return new InitialAdminBootstrapCommand(
                tenantCode,
                tenantName.strip(),
                normalizedEmail,
                displayName.strip(),
                outputPath,
                ttlMinutes);
    }

    private static boolean matches(Pattern pattern, String value) {
        return value != null && pattern.matcher(value).matches();
    }

    private static boolean boundedText(String value, int maximumLength) {
        if (value == null) {
            return false;
        }
        String normalized = value.strip();
        return !normalized.isEmpty() && normalized.length() <= maximumLength;
    }

    public String getTenantCode() {
        return tenantCode;
    }

    public void setTenantCode(String tenantCode) {
        this.tenantCode = tenantCode;
    }

    public String getTenantName() {
        return tenantName;
    }

    public void setTenantName(String tenantName) {
        this.tenantName = tenantName;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public String getTokenOutputPath() {
        return tokenOutputPath;
    }

    public void setTokenOutputPath(String tokenOutputPath) {
        this.tokenOutputPath = tokenOutputPath;
    }

    public Integer getTtlMinutes() {
        return ttlMinutes;
    }

    public void setTtlMinutes(Integer ttlMinutes) {
        this.ttlMinutes = ttlMinutes;
    }
}
