package ai.xzkj.recruitment.browsercompanion;

import ai.xzkj.recruitment.audit.AuditService;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static org.mockito.Mockito.*;

class BrowserSafetyWatchdogTest {
    private final Instant now=Instant.parse("2026-08-29T12:00:00Z");
    private final BrowserDeviceRepository devices=mock(BrowserDeviceRepository.class);
    private final BrowserSendClaimRepository claims=mock(BrowserSendClaimRepository.class);
    private final BrowserUnreadObservationRepository observations=mock(BrowserUnreadObservationRepository.class);
    private final AuditService audit=mock(AuditService.class);

    @Test void isolatesOfflineDeviceAndExpiresUncertainLeases(){
        BrowserDevice device=mock(BrowserDevice.class);BrowserSendClaim claim=mock(BrowserSendClaim.class);BrowserUnreadObservation observation=mock(BrowserUnreadObservation.class);
        when(device.getStatus()).thenReturn("ACTIVE");when(device.getLastHeartbeatAt()).thenReturn(now.minusSeconds(121));when(device.markOffline(BrowserSafetyWatchdog.HEARTBEAT_TIMEOUT_REASON)).thenReturn(true);
        when(device.getId()).thenReturn(java.util.UUID.randomUUID());when(device.getDisplayName()).thenReturn("HR-1");
        when(claim.expire(now)).thenReturn(true);when(claim.getDevice()).thenReturn(device);when(claim.getId()).thenReturn(java.util.UUID.randomUUID());
        when(observation.expireFill(now)).thenReturn(true);when(observation.getId()).thenReturn(java.util.UUID.randomUUID());
        var account=mock(ai.xzkj.recruitment.boss.BossAccount.class);when(account.getDisplayName()).thenReturn("Boss-1");when(observation.getAccount()).thenReturn(account);
        when(devices.findAllByOrderByCreatedAtDesc()).thenReturn(List.of(device));when(claims.findAllByStatusAndLeaseUntilBefore("CLAIMED",now)).thenReturn(List.of(claim));when(observations.findAllByFillStatusAndFillLeaseUntilBefore("CLAIMED",now)).thenReturn(List.of(observation));

        watchdog().sweep();

        verify(device).markOffline(BrowserSafetyWatchdog.HEARTBEAT_TIMEOUT_REASON);verify(claim).expire(now);verify(observation).expireFill(now);
        verify(audit).systemSuccess(eq("BROWSER_DEVICE_OFFLINE"),eq("BROWSER_DEVICE"),any(),eq("HR-1"),any());
        verify(audit).systemSuccess(eq("EXPIRE_BROWSER_SEND_CLAIM"),eq("BROWSER_SEND_CLAIM"),any(),eq("HR-1"),any());
        verify(audit).systemSuccess(eq("EXPIRE_BROWSER_DRAFT_FILL"),eq("BROWSER_UNREAD_OBSERVATION"),any(),eq("Boss-1"),any());
    }

    @Test void leavesFreshDeviceRunning(){
        BrowserDevice device=mock(BrowserDevice.class);when(device.getStatus()).thenReturn("ACTIVE");when(device.getLastHeartbeatAt()).thenReturn(now.minusSeconds(30));
        when(devices.findAllByOrderByCreatedAtDesc()).thenReturn(List.of(device));when(claims.findAllByStatusAndLeaseUntilBefore("CLAIMED",now)).thenReturn(List.of());when(observations.findAllByFillStatusAndFillLeaseUntilBefore("CLAIMED",now)).thenReturn(List.of());
        watchdog().sweep();
        verify(device,never()).markOffline(any());verifyNoInteractions(audit);
    }

    private BrowserSafetyWatchdog watchdog(){return new BrowserSafetyWatchdog(devices,claims,observations,audit,new SimpleMeterRegistry(),Duration.ofMinutes(2),Clock.fixed(now,ZoneOffset.UTC));}
}
