package cn.xzkj.erp.platformadmin.bootstrap;

import cn.xzkj.erp.iam.domain.BusinessEmailAddress;
import cn.xzkj.erp.iam.domain.LoginIdentifier;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("erp.bootstrap.platform-admin")
public class PlatformAdminBootstrapProperties {

    private String email;
    private String username;
    private String displayName;
    private String tokenOutputPath;
    private Integer ttlMinutes;
    private boolean recovery;

    public PlatformAdminBootstrapCommand toCommand() {
        boolean hasEmail = email != null && !email.isBlank();
        boolean hasUsername = username != null && !username.isBlank();
        if (hasEmail == hasUsername
                || displayName == null
                || displayName.isBlank()
                || displayName.strip().length() > 160
                || ttlMinutes == null
                || ttlMinutes < 5
                || ttlMinutes > 120) {
            throw new PlatformAdminBootstrapException();
        }
        String normalizedLoginIdentifier;
        try {
            normalizedLoginIdentifier = hasEmail
                    ? BusinessEmailAddress.normalize(email)
                    : LoginIdentifier.normalizeRequired(username).username();
        } catch (IllegalArgumentException invalidIdentifier) {
            throw new PlatformAdminBootstrapException();
        }
        try {
            Path output = Path.of(
                            tokenOutputPath == null ? "" : tokenOutputPath)
                    .normalize();
            if (!output.isAbsolute()) {
                throw new PlatformAdminBootstrapException();
            }
            return new PlatformAdminBootstrapCommand(
                    normalizedLoginIdentifier,
                    displayName.strip(),
                    output,
                    ttlMinutes,
                    recovery);
        } catch (InvalidPathException invalidPath) {
            throw new PlatformAdminBootstrapException();
        }
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

    public boolean isRecovery() {
        return recovery;
    }

    public void setRecovery(boolean recovery) {
        this.recovery = recovery;
    }
}
