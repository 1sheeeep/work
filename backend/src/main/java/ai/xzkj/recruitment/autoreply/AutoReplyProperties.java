package ai.xzkj.recruitment.autoreply;

import org.springframework.boot.context.properties.ConfigurationProperties;
import java.time.Duration;

@ConfigurationProperties("app.auto-reply")
public record AutoReplyProperties(boolean enabled, String instanceId, Duration pollInterval,
                                  Duration initialDelay, Duration leaseDuration, int batchSize) {
    public AutoReplyProperties {
        if (instanceId == null || instanceId.isBlank()) instanceId = "auto-reply-local-1";
        if (pollInterval == null) pollInterval = Duration.ofSeconds(15);
        if (initialDelay == null) initialDelay = Duration.ofSeconds(15);
        if (leaseDuration == null) leaseDuration = Duration.ofSeconds(45);
        if (batchSize < 1) batchSize = 20;
    }
}
