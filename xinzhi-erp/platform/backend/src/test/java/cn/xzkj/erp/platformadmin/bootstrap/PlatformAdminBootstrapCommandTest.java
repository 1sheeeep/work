package cn.xzkj.erp.platformadmin.bootstrap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class PlatformAdminBootstrapCommandTest {

    @Test
    void requiresAndNormalizesEmailIdentity() {
        PlatformAdminBootstrapCommand command =
                new PlatformAdminBootstrapCommand(
                        " Platform.Admin@Example.COM ",
                        " Platform Admin ",
                        tokenPath(),
                        30,
                        false);

        assertThat(command.username())
                .isEqualTo("platform.admin@example.com");
        assertThat(command.email())
                .isEqualTo("platform.admin@example.com");
        assertThat(command.phoneNumber()).isNull();
        assertThat(command.displayName()).isEqualTo("Platform Admin");
    }

    @Test
    void acceptsAndNormalizesMainlandPhoneIdentity() {
        PlatformAdminBootstrapCommand command =
                new PlatformAdminBootstrapCommand(
                        "18002629295",
                        "Platform Admin",
                        tokenPath(),
                        30,
                        false);

        assertThat(command.username()).isEqualTo("+8618002629295");
        assertThat(command.email()).isNull();
        assertThat(command.phoneNumber()).isEqualTo("+8618002629295");
    }

    @Test
    void rejectsLegacyNonEmailForNewSystemAdmin() {
        assertThatThrownBy(() -> new PlatformAdminBootstrapCommand(
                "platform_admin",
                "Platform Admin",
                tokenPath(),
                30,
                false))
                .isExactlyInstanceOf(PlatformAdminBootstrapException.class);
    }

    private static Path tokenPath() {
        return Path.of(
                        System.getProperty("java.io.tmpdir"),
                        "platform-admin-bootstrap.token")
                .toAbsolutePath();
    }
}
