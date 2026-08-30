package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.audit.AuditService;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

@Component
public class LocalConnectorSafetyWatchdog {
    static final String HEARTBEAT_TIMEOUT_REASON="浏览器设备超过心跳时限，已自动离线并停止该账号任务";
    private final BrowserDeviceRepository devices;
    private final BrowserUnreadObservationRepository observations;
    private final AuditService audit;
    private final MeterRegistry meters;
    private final Duration heartbeatTimeout;
    private final Clock clock;

    @Autowired
    public LocalConnectorSafetyWatchdog(BrowserDeviceRepository devices,
                                 BrowserUnreadObservationRepository observations, AuditService audit,
                                 MeterRegistry meters,
                                 @Value("${app.browser.heartbeat-timeout:2m}") Duration heartbeatTimeout) {
        this(devices,observations,audit,meters,heartbeatTimeout,Clock.systemUTC());
    }

    LocalConnectorSafetyWatchdog(BrowserDeviceRepository devices,
                          BrowserUnreadObservationRepository observations, AuditService audit,
                          MeterRegistry meters, Duration heartbeatTimeout, Clock clock) {
        this.devices=devices;this.observations=observations;this.audit=audit;
        this.meters=meters;this.heartbeatTimeout=heartbeatTimeout;this.clock=clock;
    }

    @Scheduled(fixedDelayString="${app.browser.safety-watchdog-interval:30s}",initialDelayString="${app.browser.safety-watchdog-interval:30s}")
    @Transactional
    public void sweep(){
        Instant now=clock.instant(),cutoff=now.minus(heartbeatTimeout);
        for(BrowserDevice device:devices.findAllByOrderByCreatedAtDesc()){
            Instant heartbeat=device.getLastHeartbeatAt();
            if("ACTIVE".equals(device.getStatus())&&heartbeat!=null&&!heartbeat.isAfter(cutoff)&&device.markOffline(HEARTBEAT_TIMEOUT_REASON)){
                meters.counter("recruitment.browser.safety","event","device_offline").increment();
                audit.systemSuccess("BROWSER_DEVICE_OFFLINE","BROWSER_DEVICE",device.getId(),device.getDisplayName(),"心跳超时，仅停止当前账号浏览器任务");
            }
        }
    }
}
