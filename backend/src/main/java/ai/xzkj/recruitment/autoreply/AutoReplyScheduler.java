package ai.xzkj.recruitment.autoreply;

import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import java.time.Instant;
import java.util.UUID;

@Component
@ConditionalOnProperty(prefix="app.auto-reply",name="enabled",havingValue="true",matchIfMissing=true)
public class AutoReplyScheduler {
    private static final Logger log=LoggerFactory.getLogger(AutoReplyScheduler.class);
    private final AutoReplyClaimService claims;private final AutoReplyService service;private final AutoReplyProperties properties;private final MeterRegistry meters;
    public AutoReplyScheduler(AutoReplyClaimService claims,AutoReplyService service,AutoReplyProperties properties,MeterRegistry meters){this.claims=claims;this.service=service;this.properties=properties;this.meters=meters;}
    @Scheduled(fixedDelayString="${app.auto-reply.poll-interval:15s}",initialDelayString="${app.auto-reply.initial-delay:15s}")
    public void dispatch(){Instant now=Instant.now();for(var due:claims.findDue(now,properties.batchSize())){UUID attemptId=claims.claim(due,properties.instanceId(),now,now.plus(properties.leaseDuration()));if(attemptId==null){meters.counter("recruitment.auto_reply.claims","result","contended").increment();continue;}try{service.process(attemptId);meters.counter("recruitment.auto_reply.runs","result","completed").increment();}catch(RuntimeException e){meters.counter("recruitment.auto_reply.runs","result","failed").increment();log.error("Auto reply processing failed attemptId={} accountId={}",attemptId,due.accountId(),e);}}}
}
