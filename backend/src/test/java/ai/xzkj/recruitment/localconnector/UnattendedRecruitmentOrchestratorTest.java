package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.autoreply.AutoReplyPolicyRepository;
import ai.xzkj.recruitment.boss.BossAccount;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class UnattendedRecruitmentOrchestratorTest {
    @Test
    void explicitSingleConversationCycleRunsInMonitorOnlyWithoutProductionApproval() {
        BrowserUnreadObservationRepository observations = mock(BrowserUnreadObservationRepository.class);
        LocalConnectorActionTaskRepository tasks = mock(LocalConnectorActionTaskRepository.class);
        BrowserDeviceRepository devices = mock(BrowserDeviceRepository.class);
        LocalConnectorCapabilityRepository capabilities = mock(LocalConnectorCapabilityRepository.class);
        LocalConnectorProductionApprovalRepository approvals = mock(LocalConnectorProductionApprovalRepository.class);
        AutoReplyPolicyRepository policies = mock(AutoReplyPolicyRepository.class);
        AuditService audit = mock(AuditService.class);

        BossAccount account = mock(BossAccount.class);
        when(account.getId()).thenReturn(UUID.randomUUID());
        when(account.getDisplayName()).thenReturn("测试账号");
        BrowserDevice device = mock(BrowserDevice.class);
        when(device.getRuntimeState()).thenReturn("RUNNING");

        BrowserUnreadObservation observation = mock(BrowserUnreadObservation.class);
        when(observation.getId()).thenReturn(UUID.randomUUID());
        when(observation.getAccount()).thenReturn(account);
        when(observation.getConversationStage()).thenReturn("INITIAL_CONTACT");
        when(observation.getCycleTestStatus()).thenReturn("ACTIVE");
        when(observation.getReviewStatus()).thenReturn("APPROVED");
        when(observation.getDraftQualification()).thenReturn("KNOWLEDGE_READY");
        when(observation.getDraftContent()).thenReturn("您好，已收到您的消息");
        when(observation.getFirstSeenAt()).thenReturn(Instant.parse("2026-09-06T10:00:00Z"));
        when(observation.bypassesProductionGuardsForExplicitCycleTest()).thenReturn(true);

        when(observations.findActiveCycleTests()).thenReturn(List.of(observation));
        when(tasks.findByObservationIdAndActionTypeAndCycleStartedAt(any(), eq("SEND_MESSAGE"), any()))
                .thenReturn(Optional.empty());
        when(devices.findFirstByBossAccountIdAndStatus(account.getId(), "ACTIVE")).thenReturn(Optional.of(device));
        when(tasks.save(any(LocalConnectorActionTask.class))).thenAnswer(invocation -> invocation.getArgument(0));

        new UnattendedRecruitmentOrchestrator(
                observations, tasks, devices, capabilities, approvals, policies, audit, true
        ).orchestrate();

        ArgumentCaptor<LocalConnectorActionTask> taskCaptor = ArgumentCaptor.forClass(LocalConnectorActionTask.class);
        verify(tasks).save(taskCaptor.capture());
        assertThat(taskCaptor.getValue().getStatus()).isEqualTo("READY");
        assertThat(taskCaptor.getValue().getReason()).contains("HR 显式授权");
        verifyNoInteractions(capabilities, approvals, policies);
    }

    @Test
    void explicitCycleRestoresInitialReplyBeforeResumeWhenHistoricalReplyTaskIsMissing() {
        BrowserUnreadObservationRepository observations = mock(BrowserUnreadObservationRepository.class);
        LocalConnectorActionTaskRepository tasks = mock(LocalConnectorActionTaskRepository.class);
        BrowserDeviceRepository devices = mock(BrowserDeviceRepository.class);
        LocalConnectorCapabilityRepository capabilities = mock(LocalConnectorCapabilityRepository.class);
        LocalConnectorProductionApprovalRepository approvals = mock(LocalConnectorProductionApprovalRepository.class);
        AutoReplyPolicyRepository policies = mock(AutoReplyPolicyRepository.class);
        AuditService audit = mock(AuditService.class);

        BossAccount account = mock(BossAccount.class);
        when(account.getId()).thenReturn(UUID.randomUUID());
        when(account.getDisplayName()).thenReturn("测试账号");
        BrowserDevice device = mock(BrowserDevice.class);
        when(device.getRuntimeState()).thenReturn("RUNNING");
        BrowserUnreadObservation observation = mock(BrowserUnreadObservation.class);
        AtomicReference<String> stage = new AtomicReference<>("CAN_REQUEST_RESUME");
        when(observation.getId()).thenReturn(UUID.randomUUID());
        when(observation.getAccount()).thenReturn(account);
        when(observation.getConversationStage()).thenAnswer(ignored -> stage.get());
        when(observation.getCycleTestStatus()).thenReturn("ACTIVE");
        when(observation.getReviewStatus()).thenReturn("APPROVED");
        when(observation.getDraftQualification()).thenReturn("KNOWLEDGE_READY");
        when(observation.getDraftContent()).thenReturn("您好，已收到您的消息");
        when(observation.getFirstSeenAt()).thenReturn(Instant.parse("2026-09-06T10:00:00Z"));
        when(observation.bypassesProductionGuardsForExplicitCycleTest()).thenReturn(true);
        doAnswer(ignored -> { stage.set("INITIAL_CONTACT"); return null; })
                .when(observation).requireInitialReplyBeforeResume(any());
        LocalConnectorActionTask prematureResumeRequest = mock(LocalConnectorActionTask.class);

        when(observations.findActiveCycleTests()).thenReturn(List.of(observation));
        when(tasks.findByObservationIdAndActionTypeAndCycleStartedAt(any(), anyString(), any()))
                .thenAnswer(invocation -> "REQUEST_RESUME".equals(invocation.getArgument(1))
                        ? Optional.of(prematureResumeRequest) : Optional.empty());
        when(devices.findFirstByBossAccountIdAndStatus(account.getId(), "ACTIVE")).thenReturn(Optional.of(device));
        when(tasks.save(any(LocalConnectorActionTask.class))).thenAnswer(invocation -> invocation.getArgument(0));

        new UnattendedRecruitmentOrchestrator(
                observations, tasks, devices, capabilities, approvals, policies, audit, true
        ).orchestrate();

        ArgumentCaptor<LocalConnectorActionTask> taskCaptor = ArgumentCaptor.forClass(LocalConnectorActionTask.class);
        verify(tasks).save(taskCaptor.capture());
        verify(prematureResumeRequest).waitForPrerequisite(contains("首次自动回复"), any());
        assertThat(taskCaptor.getValue().getActionType()).isEqualTo("SEND_MESSAGE");
        assertThat(taskCaptor.getValue().getStatus()).isEqualTo("READY");
        verifyNoInteractions(capabilities, approvals, policies);
    }
}
