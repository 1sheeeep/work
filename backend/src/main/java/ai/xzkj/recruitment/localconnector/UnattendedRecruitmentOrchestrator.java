package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.autoreply.AutoReplyPolicy;
import ai.xzkj.recruitment.autoreply.AutoReplyPolicyRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

@Component
class UnattendedRecruitmentOrchestrator {
    private final BrowserUnreadObservationRepository observations;
    private final LocalConnectorActionTaskRepository tasks;
    private final BrowserDeviceRepository devices;
    private final LocalConnectorCapabilityRepository capabilities;
    private final LocalConnectorProductionApprovalRepository approvals;
    private final AutoReplyPolicyRepository policies;
    private final AuditService audit;
    private final boolean monitorOnly;

    UnattendedRecruitmentOrchestrator(BrowserUnreadObservationRepository observations,
                                      LocalConnectorActionTaskRepository tasks,
                                      BrowserDeviceRepository devices,
                                      LocalConnectorCapabilityRepository capabilities,
                                      LocalConnectorProductionApprovalRepository approvals,
                                      AutoReplyPolicyRepository policies,
                                      AuditService audit,
                                      @Value("${app.browser.monitor-only:true}") boolean monitorOnly) {
        this.observations = observations;
        this.tasks = tasks;
        this.devices = devices;
        this.capabilities = capabilities;
        this.approvals = approvals;
        this.policies = policies;
        this.audit = audit;
        this.monitorOnly = monitorOnly;
    }

    @Scheduled(fixedDelayString = "${app.unattended-recruitment.poll-interval:15s}",
            initialDelayString = "${app.unattended-recruitment.initial-delay:20s}")
    @Transactional
    void orchestrate() {
        if (monitorOnly) return;
        Instant now = Instant.now();
        for (BrowserUnreadObservation observation : observations.findAllByUnreadTrueOrderByFirstSeenAtAsc()) {
            AutoReplyPolicy policy = policies.findByBossAccountId(observation.getAccount().getId()).orElse(null);
            if (policy == null || !policy.isAutoSendEnabled() || !policy.isAwayActive(now)) continue;
            observation.evaluate(now, policy.getResponseTimeoutMinutes(), true);
            createReplyWhenEligible(observation, now);
            createResumeRequestAfterReply(observation, now);
        }
    }

    private void createReplyWhenEligible(BrowserUnreadObservation observation, Instant now) {
        if (!"READY_FOR_REVIEW".equals(observation.getEligibilityStatus())
                || !"KNOWLEDGE_READY".equals(observation.getDraftQualification())
                || observation.getDraftContent() == null
                || observation.getDraftContent().isBlank()) return;
        LocalConnectorActionTask existing = find(observation, "SEND_MESSAGE");
        if (existing != null) {
            promoteWhenApproved(existing, observation, "企业与岗位事实回复", now);
            return;
        }
        String status = executionStatus(observation, "SEND_MESSAGE", now);
        LocalConnectorActionTask task = tasks.save(LocalConnectorActionTask.unattended(
                observation, "SEND_MESSAGE", status, observation.getDraftContent(), reason(status, "企业与岗位事实回复")));
        audit.systemSuccess("QUEUE_UNATTENDED_REPLY", "LOCAL_CONNECTOR_ACTION", task.getId(),
                observation.getAccount().getDisplayName(), "已为当前未读周期幂等登记回复任务；任务状态 " + status);
    }

    private void createResumeRequestAfterReply(BrowserUnreadObservation observation, Instant now) {
        LocalConnectorActionTask reply = tasks.findByObservationIdAndActionTypeAndCycleStartedAt(
                observation.getId(), "SEND_MESSAGE", observation.getFirstSeenAt()).orElse(null);
        if (reply == null || !"SUCCEEDED".equals(reply.getStatus())) return;
        LocalConnectorActionTask existing = find(observation, "REQUEST_RESUME");
        if (existing != null) {
            promoteWhenApproved(existing, observation, "索要简历", now);
            return;
        }
        String status = executionStatus(observation, "REQUEST_RESUME", now);
        LocalConnectorActionTask task = tasks.save(LocalConnectorActionTask.unattended(
                observation, "REQUEST_RESUME", status, null, reason(status, "索要简历")));
        audit.systemSuccess("QUEUE_UNATTENDED_RESUME_REQUEST", "LOCAL_CONNECTOR_ACTION", task.getId(),
                observation.getAccount().getDisplayName(), "事实回复已确认成功，已为当前未读周期幂等登记一次简历请求；任务状态 " + status);
    }

    private LocalConnectorActionTask find(BrowserUnreadObservation observation, String actionType) {
        return tasks.findByObservationIdAndActionTypeAndCycleStartedAt(
                observation.getId(), actionType, observation.getFirstSeenAt()).orElse(null);
    }

    private void promoteWhenApproved(LocalConnectorActionTask task, BrowserUnreadObservation observation,
                                     String action, Instant now) {
        if (!"READY".equals(executionStatus(observation, task.getActionType(), now))) return;
        String before = task.getStatus();
        task.ready(reason("READY", action), now);
        if (!before.equals(task.getStatus())) audit.systemSuccess(
                "PROMOTE_UNATTENDED_ACTION", "LOCAL_CONNECTOR_ACTION", task.getId(),
                observation.getAccount().getDisplayName(), action + "已通过当前真实页面验收和生产批准，任务进入 READY");
    }

    private String executionStatus(BrowserUnreadObservation observation, String actionType, Instant now) {
        BrowserDevice device = devices.findFirstByBossAccountIdAndStatus(observation.getAccount().getId(), "ACTIVE").orElse(null);
        if (device == null || !"RUNNING".equals(device.getRuntimeState())) return "BLOCKED_UNVERIFIED";
        LocalConnectorCapability capability = capabilities.findByDeviceIdAndCapability(device.getId(), actionType).orElse(null);
        LocalConnectorProductionApproval approval = approvals.findByDeviceIdAndActionType(device.getId(), actionType).orElse(null);
        return capability != null && "PRODUCTION_APPROVED".equals(capability.getStatus())
                && approval != null && approval.active(now) ? "READY" : "BLOCKED_UNVERIFIED";
    }

    private String reason(String status, String action) {
        return "READY".equals(status) ? action + "已通过真实页面验收与当前低配额批准"
                : action + "已登记，但真实页面能力或当前批准未就绪，禁止下发";
    }
}
