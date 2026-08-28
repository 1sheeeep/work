package ai.xzkj.recruitment.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "app.security")
public record SecurityProperties(int loginMaxFailures, Duration loginWindow, Duration loginBlockDuration) {
    public SecurityProperties {
        if (loginMaxFailures < 1) loginMaxFailures = 5;
        if (loginWindow == null || loginWindow.isNegative() || loginWindow.isZero()) loginWindow = Duration.ofMinutes(15);
        if (loginBlockDuration == null || loginBlockDuration.isNegative() || loginBlockDuration.isZero()) loginBlockDuration = Duration.ofMinutes(15);
    }
}
