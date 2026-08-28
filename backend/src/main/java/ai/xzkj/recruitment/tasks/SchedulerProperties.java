package ai.xzkj.recruitment.tasks;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties("app.scheduler")
public record SchedulerProperties(boolean enabled, String instanceId, Duration leaseDuration,
                                  Duration cadence, int batchSize) {
    public SchedulerProperties {
        if (instanceId == null || instanceId.isBlank()) instanceId = "scheduler-local";
        if (leaseDuration == null) leaseDuration = Duration.ofSeconds(45);
        if (cadence == null) cadence = Duration.ofMinutes(1);
        if (batchSize < 1) batchSize = 20;
    }
}
