package cn.xzkj.erp.platformadmin.bootstrap;

import cn.xzkj.erp.iam.domain.LoginIdentifier;
import java.nio.file.Path;
import java.util.Objects;

public record PlatformAdminBootstrapCommand(
        String username,
        String email,
        String phoneNumber,
        String displayName,
        Path tokenOutputPath,
        int ttlMinutes,
        boolean recovery) {

    public PlatformAdminBootstrapCommand(
            String loginIdentifier,
            String displayName,
            Path tokenOutputPath,
            int ttlMinutes,
            boolean recovery) {
        this(
                normalize(loginIdentifier),
                displayName,
                tokenOutputPath,
                ttlMinutes,
                recovery);
    }

    private PlatformAdminBootstrapCommand(
            LoginIdentifier.Normalized identity,
            String displayName,
            Path tokenOutputPath,
            int ttlMinutes,
            boolean recovery) {
        this(
                identity.username(),
                identity.email(),
                identity.phoneNumber(),
                displayName,
                tokenOutputPath,
                ttlMinutes,
                recovery);
    }

    public PlatformAdminBootstrapCommand {
        LoginIdentifier.Normalized identity = normalize(username);
        if (!Objects.equals(identity.email(), email)
                || !Objects.equals(identity.phoneNumber(), phoneNumber)
                || displayName == null
                || displayName.isBlank()
                || displayName.strip().length() > 160
                || tokenOutputPath == null
                || !tokenOutputPath.isAbsolute()
                || ttlMinutes < 5
                || ttlMinutes > 120) {
            throw new PlatformAdminBootstrapException();
        }
        username = identity.username();
        email = identity.email();
        phoneNumber = identity.phoneNumber();
        displayName = displayName.strip();
        tokenOutputPath = tokenOutputPath.normalize();
    }

    private static LoginIdentifier.Normalized normalize(String value) {
        try {
            return LoginIdentifier.normalizeRequired(value);
        } catch (IllegalArgumentException invalidIdentifier) {
            throw new PlatformAdminBootstrapException();
        }
    }
}
