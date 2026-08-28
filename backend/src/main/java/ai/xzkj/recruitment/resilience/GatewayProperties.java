package ai.xzkj.recruitment.resilience;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties(prefix = "app.gateway")
public record GatewayProperties(Duration timeout, int maxConcurrent, int rateLimitPerMinute,
                                int circuitFailureThreshold, Duration circuitOpenDuration) {
    public GatewayProperties {
        if (timeout == null || timeout.isZero() || timeout.isNegative()) timeout = Duration.ofSeconds(3);
        if (maxConcurrent < 1) maxConcurrent = 8;
        if (rateLimitPerMinute < 1) rateLimitPerMinute = 120;
        if (circuitFailureThreshold < 1) circuitFailureThreshold = 3;
        if (circuitOpenDuration == null || circuitOpenDuration.isZero() || circuitOpenDuration.isNegative()) circuitOpenDuration = Duration.ofSeconds(30);
    }
}
