package cn.xzkj.erp.logistics.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.DiscoveredChannel;
import cn.xzkj.erp.logistics.authorization.LogisticsProviderConnectorGateway.ProbeResult;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class LogisticsAuthorizationProbeFinalizerTest {
    @Test
    void activatesAndAuditsConnectedProbeInsideTheFinalizationBoundary() {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID id = UUID.randomUUID();
        var actor = new LogisticsAuthorizationService.Actor(
                tenantId, userId, null, "UAT Operator", "uat-probe", "127.0.0.1");
        var pending = record(id, "PENDING", 0);
        var active = record(id, "ACTIVE", 1);
        var repository = mock(LogisticsAuthorizationRepository.class);
        var audits = mock(SecurityAuditRecorder.class);
        when(repository.find(tenantId, id)).thenReturn(pending, active);
        when(repository.activate(tenantId, id, 0, actor)).thenReturn(true);
        var finalizer = new LogisticsAuthorizationProbeFinalizer(repository, audits);

        var channels = List.of(new DiscoveredChannel("US-01", "美国专线"));
        var result = finalizer.complete(actor, pending, 0,
                new ProbeResult("CONNECTED", "Connection succeeded", channels));

        assertThat(result).isEqualTo(active);
        verify(repository).activate(tenantId, id, 0, actor);
        verify(repository).synchronizeChannels(tenantId, id, channels, actor);
        verify(audits).recordAtomically(any());
    }

    @Test
    void auditsPendingProbeWithoutActivatingIt() {
        UUID tenantId = UUID.randomUUID();
        UUID id = UUID.randomUUID();
        var actor = new LogisticsAuthorizationService.Actor(
                tenantId, UUID.randomUUID(), null, "UAT Operator",
                "uat-probe-pending", "127.0.0.1");
        var pending = record(id, "PENDING", 0);
        var repository = mock(LogisticsAuthorizationRepository.class);
        var audits = mock(SecurityAuditRecorder.class);
        when(repository.find(tenantId, id)).thenReturn(pending);
        var finalizer = new LogisticsAuthorizationProbeFinalizer(repository, audits);

        var result = finalizer.complete(actor, pending, 0,
                new ProbeResult("NOT_CONFIGURED", "Connector is not configured"));

        assertThat(result).isEqualTo(pending);
        verify(audits).recordAtomically(any());
    }

    private static LogisticsAuthorizationRecord record(UUID id, String status,
            long version) {
        Instant time = Instant.parse("2026-08-11T00:00:00Z");
        return new LogisticsAuthorizationRecord(id, "PLATFORM", "CUSTOM",
                "UAT Carrier", "UAT Account", "DIRECT_CREDENTIALS", true,
                "ENCRYPTED", null, null, status, "UAT Operator", version,
                time, time);
    }
}
