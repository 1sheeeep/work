package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.boss.BossAccount;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class LocalConnectorActionLeaseServiceTest {
    @Test
    void explicitCycleLeaseSkipsCapabilityApprovalAndQuotaChecks() {
        LocalConnectorService connectors = mock(LocalConnectorService.class);
        LocalConnectorActionTaskRepository tasks = mock(LocalConnectorActionTaskRepository.class);
        LocalConnectorActionLeaseRepository leases = mock(LocalConnectorActionLeaseRepository.class);
        LocalConnectorCapabilityRepository capabilities = mock(LocalConnectorCapabilityRepository.class);
        LocalConnectorProductionApprovalRepository approvals = mock(LocalConnectorProductionApprovalRepository.class);
        CurrentUserService users = mock(CurrentUserService.class);
        AuditService audit = mock(AuditService.class);

        UUID accountId = UUID.randomUUID();
        String targetDigest = "a".repeat(64);
        BossAccount account = mock(BossAccount.class);
        when(account.getId()).thenReturn(accountId);
        BrowserDevice device = mock(BrowserDevice.class);
        when(device.getId()).thenReturn(UUID.randomUUID());
        when(device.getRuntimeState()).thenReturn("RUNNING");
        when(device.getBossAccount()).thenReturn(account);
        when(connectors.authenticate("Bearer device-token")).thenReturn(device);

        BrowserUnreadObservation observation = mock(BrowserUnreadObservation.class);
        when(observation.bypassesProductionGuardsForExplicitCycleTest()).thenReturn(true);
        when(observation.getChatDigest()).thenReturn(targetDigest);
        LocalConnectorActionTask task = mock(LocalConnectorActionTask.class);
        when(task.getId()).thenReturn(UUID.randomUUID());
        when(task.getActionType()).thenReturn("SEND_MESSAGE");
        when(task.getPayload()).thenReturn("您好，已收到您的消息");
        when(task.getObservation()).thenReturn(observation);

        when(tasks.findReadyForSelectedConversation(
                eq(accountId), eq("READY"), eq("SEND_MESSAGE"), eq(targetDigest), any(Pageable.class)
        )).thenReturn(List.of(task));
        when(leases.save(any(LocalConnectorActionLease.class))).thenAnswer(invocation -> invocation.getArgument(0));

        LocalConnectorActionLeaseService service = new LocalConnectorActionLeaseService(
                connectors, tasks, leases, capabilities, approvals, users, audit
        );
        ActionLeaseClaimResponse result = service.claim(
                "Bearer device-token", new ActionLeaseClaimRequest("SEND_MESSAGE", targetDigest)
        );

        assertThat(result.available()).isTrue();
        assertThat(result.mode()).isEqualTo("EXPLICIT_SINGLE_CONVERSATION_TEST");
        verifyNoInteractions(capabilities, approvals);
    }
}
