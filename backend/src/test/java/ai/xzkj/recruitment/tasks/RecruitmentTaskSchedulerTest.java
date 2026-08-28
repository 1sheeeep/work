package ai.xzkj.recruitment.tasks;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class RecruitmentTaskSchedulerTest {
    @Test
    void onlyExecutesTasksWhoseLeaseWasAcquired() {
        TaskLeaseService leases = mock(TaskLeaseService.class);
        RecruitmentTaskService tasks = mock(RecruitmentTaskService.class);
        UUID acquired = UUID.randomUUID(), contended = UUID.randomUUID();
        var properties = new SchedulerProperties(true, "node-a", Duration.ofSeconds(45), Duration.ofMinutes(1), 20);
        var lease = new TaskLeaseService.Lease(acquired, "node-a", 2, Instant.now().plusSeconds(45));
        when(leases.findDueTaskIds(any(), eq(20))).thenReturn(List.of(acquired, contended));
        when(leases.tryAcquire(eq(acquired), eq("node-a"), any(), any())).thenReturn(lease);
        when(leases.tryAcquire(eq(contended), eq("node-a"), any(), any())).thenReturn(null);

        new RecruitmentTaskScheduler(leases, tasks, properties, new SimpleMeterRegistry()).dispatchDueTasks();

        verify(tasks).runScheduled(eq(acquired), startsWith("scheduled:"), eq("node-a"), any());
        verify(tasks, never()).runScheduled(eq(contended), anyString(), anyString(), any());
        verify(leases).release(eq(lease), any());
    }
}
