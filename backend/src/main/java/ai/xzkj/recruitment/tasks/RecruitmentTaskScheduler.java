package ai.xzkj.recruitment.tasks;

import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Instant;

@Component
@ConditionalOnProperty(prefix = "app.scheduler", name = "enabled", havingValue = "true", matchIfMissing = true)
public class RecruitmentTaskScheduler {
    private static final Logger log = LoggerFactory.getLogger(RecruitmentTaskScheduler.class);
    private final TaskLeaseService leases;
    private final RecruitmentTaskService tasks;
    private final SchedulerProperties properties;
    private final MeterRegistry meters;

    public RecruitmentTaskScheduler(TaskLeaseService leases, RecruitmentTaskService tasks,
                                    SchedulerProperties properties, MeterRegistry meters) {
        this.leases = leases; this.tasks = tasks; this.properties = properties; this.meters = meters;
    }

    @Scheduled(fixedDelayString = "${app.scheduler.poll-interval:10s}", initialDelayString = "${app.scheduler.initial-delay:10s}")
    public void dispatchDueTasks() {
        Instant now = Instant.now();
        for (var taskId : leases.findDueTaskIds(now, properties.batchSize())) {
            var lease = leases.tryAcquire(taskId, properties.instanceId(), now, now.plus(properties.leaseDuration()));
            if (lease == null) { meters.counter("recruitment.scheduler.claims", "result", "contended").increment(); continue; }
            meters.counter("recruitment.scheduler.claims", "result", "acquired").increment();
            try {
                String key = "scheduled:" + taskId + ":" + now.getEpochSecond() / Math.max(1, properties.cadence().toSeconds());
                tasks.runScheduled(taskId, key, properties.instanceId(), now.plus(properties.cadence()));
                meters.counter("recruitment.scheduler.runs", "result", "completed").increment();
            } catch (RuntimeException exception) {
                meters.counter("recruitment.scheduler.runs", "result", "failed").increment();
                log.error("Scheduled recruitment task failed taskId={} owner={}", taskId, properties.instanceId(), exception);
            } finally { leases.release(lease, Instant.now()); }
        }
    }
}
