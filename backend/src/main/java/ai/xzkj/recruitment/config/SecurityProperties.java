package ai.xzkj.recruitment.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.ConstructorBinding;

import java.time.Duration;

@ConfigurationProperties(prefix = "app.security")
public record SecurityProperties(int loginMaxFailures, Duration loginWindow, Duration loginBlockDuration,
                                 Duration rememberMeDuration, boolean rememberMeSecureCookie) {
    public SecurityProperties(int loginMaxFailures, Duration loginWindow, Duration loginBlockDuration) {
        this(loginMaxFailures, loginWindow, loginBlockDuration, Duration.ofDays(7), false);
    }

    @ConstructorBinding
    public SecurityProperties {
        if (loginMaxFailures < 1) loginMaxFailures = 5;
        if (loginWindow == null || loginWindow.isNegative() || loginWindow.isZero()) loginWindow = Duration.ofMinutes(15);
        if (loginBlockDuration == null || loginBlockDuration.isNegative() || loginBlockDuration.isZero()) loginBlockDuration = Duration.ofMinutes(15);
        if (rememberMeDuration == null || rememberMeDuration.isNegative() || rememberMeDuration.isZero()) rememberMeDuration = Duration.ofDays(7);
    }
}
