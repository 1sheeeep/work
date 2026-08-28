package ai.xzkj.recruitment.autoreply;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import java.time.Duration;
import java.util.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AutoReplySchedulerTest {
    @Test void claimsAndProcessesEachDueMessageOnce() {
        var claims=mock(AutoReplyClaimService.class);var service=mock(AutoReplyService.class);
        var due=new AutoReplyClaimService.DueMessage(UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID());
        UUID attemptId=UUID.randomUUID();when(claims.findDue(any(),eq(20))).thenReturn(List.of(due));when(claims.claim(eq(due),eq("instance-1"),any(),any())).thenReturn(attemptId);
        var scheduler=new AutoReplyScheduler(claims,service,new AutoReplyProperties(true,"instance-1",Duration.ofSeconds(15),Duration.ZERO,Duration.ofSeconds(45),20),new SimpleMeterRegistry());
        scheduler.dispatch();verify(service).process(attemptId);
    }
}
