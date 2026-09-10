package cn.xzkj.erp.iam.application;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.time.Duration;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties("erp.security.login-throttle")
public class LoginThrottleProperties implements InitializingBean {

    public static final Duration MINIMUM_DURATION = Duration.ofMinutes(1);
    public static final Duration MAXIMUM_DURATION = Duration.ofHours(24);

    @Min(2)
    @Max(100)
    private int maxFailures = 5;

    @NotNull
    private Duration window = Duration.ofMinutes(15);

    @NotNull
    private Duration lockDuration = Duration.ofMinutes(15);

    @Override
    public void afterPropertiesSet() {
        requireBounded(window);
        requireBounded(lockDuration);
    }

    private static void requireBounded(Duration value) {
        if (value == null
                || value.compareTo(MINIMUM_DURATION) < 0
                || value.compareTo(MAXIMUM_DURATION) > 0) {
            throw new IllegalStateException(
                    "Login throttle duration is outside the supported range");
        }
    }

    public int getMaxFailures() {
        return maxFailures;
    }

    public void setMaxFailures(int maxFailures) {
        this.maxFailures = maxFailures;
    }

    public Duration getWindow() {
        return window;
    }

    public void setWindow(Duration window) {
        this.window = window;
    }

    public Duration getLockDuration() {
        return lockDuration;
    }

    public void setLockDuration(Duration lockDuration) {
        this.lockDuration = lockDuration;
    }
}
