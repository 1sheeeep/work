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
        Instant now = Instant.now();
        for (BrowserUnreadObservation observation : observations.findActiveCycleTests()) {
            restoreRequiredInitialReply(observation, now);
            switch (observation.getConversationStage()) {
                case "INITIAL_CONTACT" -> createReplyWhenEligible(observation, now);
                case "CAN_REQUEST_RESUME" -> createResumeRequestAfterReply(observation, now);
                case "CAN_EXCHANGE_CONTACT" -> createContactExchange(observation, now);
                default -> { /* 等待新的只读 DOM 信号或 HR 简历复核，不主动跨阶段。 */ }
            }
        }
        // monitor-only 只约束常规无人值守任务。HR 在控制台显式启动的单会话周期测试
        // 始终允许推进，但动作仍绑定账号、目标摘要和单次租约。
        if (monitorOnly) return;
        for (BrowserUnreadObservation observation : observations.findAllByUnreadTrueOrderByFirstSeenAtAsc()) {
            AutoReplyPolicy policy = policies.findByBossAccountId(observation.getAccount().getId()).orElse(null);
            if (policy == null || !policy.isAutoSendEnabled() || !policy.isAwayActive(now)) continue;
            observation.evaluate(now, policy.getResponseTimeoutMinutes(), true);
            createReplyWhenEligible(observation, now);
        }
        for (BrowserUnreadObservation observation : observations.findTop100ByOrderByLastSeenAtDesc()) {
            createResumeRequestAfterReply(observation, now);
        }
    }

    private void createReplyWhenEligible(BrowserUnreadObservation observation, Instant now) {
        boolean approvedCycleStart = "ACTIVE".equals(observation.getCycleTestStatus())
                && "INITIAL_CONTACT".equals(observation.getConversationStage())
                && "APPROVED".equals(observation.getReviewStatus());
        if (!approvedCycleStart && !"READY_FOR_REVIEW".equals(observation.getEligibilityStatus())) return;
        if (
                !"KNOWLEDGE_READY".equals(observation.getDraftQualification())
                || observation.getDraftContent() == null
                || observation.getDraftContent().isBlank()) return;
        LocalConnectorActionTask existing = find(observation, "SEND_MESSAGE");
        if (existing != null) {
            promoteWhenApproved(existing, observation, "企业与岗位事实回复", now);
            return;
        }
        String status = executionStatus(observation, "SEND_MESSAGE", now);
        LocalConnectorActionTask task = tasks.save(LocalConnectorActionTask.unattended(
                observation, "SEND_MESSAGE", status, observation.getDraftContent(), reason(status, "企业与岗位事实回复", observation)));
        audit.systemSuccess("QUEUE_UNATTENDED_REPLY", "LOCAL_CONNECTOR_ACTION", task.getId(),
                observation.getAccount().getDisplayName(), "已为当前未读周期幂等登记回复任务；任务状态 " + status);
    }

    private void createResumeRequestAfterReply(BrowserUnreadObservation observation, Instant now) {
        if (!"CAN_REQUEST_RESUME".equals(observation.getConversationStage())) {
            LocalConnectorActionTask stale = find(observation, "REQUEST_RESUME");
            if (stale != null) stale.cancelIfPending("当前页面阶段已变更为 " + observation.getConversationStage() + "，索要简历任务已取消", now);
            return;
        }
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
                observation, "REQUEST_RESUME", status, null, reason(status, "索要简历", observation)));
        audit.systemSuccess("QUEUE_UNATTENDED_RESUME_REQUEST", "LOCAL_CONNECTOR_ACTION", task.getId(),
                observation.getAccount().getDisplayName(), "事实回复已确认成功，已为当前未读周期幂等登记一次简历请求；任务状态 " + status);
    }

    private void createContactExchange(BrowserUnreadObservation observation, Instant now) {
        if (!"ACTIVE".equals(observation.getCycleTestStatus())
                || !"APPROVED".equals(observation.getResumeReviewStatus())
                || !"CAN_EXCHANGE_CONTACT".equals(observation.getConversationStage())) return;
        ConversationSignals signals = observation.getConversationSignals();
        String actionType = signals.exchangeWechatAvailable() ? "EXCHANGE_WECHAT"
                : signals.exchangePhoneAvailable() ? "EXCHANGE_PHONE" : null;
        if (actionType == null) return;
        LocalConnectorActionTask existing = find(observation, actionType);
        if (existing != null) {
            promoteWhenApproved(existing, observation, "交换联系方式", now);
            return;
        }
        String status = executionStatus(observation, actionType, now);
        LocalConnectorActionTask task = tasks.save(LocalConnectorActionTask.unattended(
                observation, actionType, status, null, reason(status, "交换联系方式", observation)));
        audit.systemSuccess("QUEUE_CYCLE_CONTACT_EXCHANGE", "LOCAL_CONNECTOR_ACTION", task.getId(),
                observation.getAccount().getDisplayName(), "简历已经 HR 人工审核；已按微信优先、电话兜底登记单次联系方式交换任务；任务状态 " + status);
    }

    private LocalConnectorActionTask find(BrowserUnreadObservation observation, String actionType) {
        return tasks.findByObservationIdAndActionTypeAndCycleStartedAt(
                observation.getId(), actionType, observation.getFirstSeenAt()).orElse(null);
    }

    private void restoreRequiredInitialReply(BrowserUnreadObservation observation, Instant now) {
        if (!"ACTIVE".equals(observation.getCycleTestStatus())
                || !"CAN_REQUEST_RESUME".equals(observation.getConversationStage())) return;
        LocalConnectorActionTask reply = find(observation, "SEND_MESSAGE");
        if (reply != null && "SUCCEEDED".equals(reply.getStatus())) return;
        LocalConnectorActionTask prematureResumeRequest = find(observation, "REQUEST_RESUME");
        if (prematureResumeRequest != null) prematureResumeRequest.waitForPrerequisite(
                "等待首次自动回复收到明确成功回执后再索要简历", now);
        observation.requireInitialReplyBeforeResume(now);
    }

    private void promoteWhenApproved(LocalConnectorActionTask task, BrowserUnreadObservation observation,
                                     String action, Instant now) {
        if (!"READY".equals(executionStatus(observation, task.getActionType(), now))) return;
        String before = task.getStatus();
        task.ready(reason("READY", action, observation), now);
        if (!before.equals(task.getStatus())) audit.systemSuccess(
                "PROMOTE_UNATTENDED_ACTION", "LOCAL_CONNECTOR_ACTION", task.getId(),
                observation.getAccount().getDisplayName(), observation.bypassesProductionGuardsForExplicitCycleTest()
                        ? action + "由 HR 显式单会话周期测试授权，任务进入 READY"
                        : action + "已通过当前真实页面验收和生产批准，任务进入 READY");
    }

    private String executionStatus(BrowserUnreadObservation observation, String actionType, Instant now) {
        BrowserDevice device = devices.findFirstByBossAccountIdAndStatus(observation.getAccount().getId(), "ACTIVE").orElse(null);
        if (device == null || !"RUNNING".equals(device.getRuntimeState())) return "BLOCKED_UNVERIFIED";
        if (observation.bypassesProductionGuardsForExplicitCycleTest()) return "READY";
        LocalConnectorCapability capability = capabilities.findByDeviceIdAndCapability(device.getId(), actionType).orElse(null);
        LocalConnectorProductionApproval approval = approvals.findByDeviceIdAndActionType(device.getId(), actionType).orElse(null);
        return capability != null && "PRODUCTION_APPROVED".equals(capability.getStatus())
                && approval != null && approval.active(now) ? "READY" : "BLOCKED_UNVERIFIED";
    }

    private String reason(String status, String action) {
        return "READY".equals(status) ? action + "已通过真实页面验收与当前低配额批准"
                : action + "已登记，但真实页面能力或当前批准未就绪，禁止下发";
    }

    private String reason(String status, String action, BrowserUnreadObservation observation) {
        if ("READY".equals(status) && observation.bypassesProductionGuardsForExplicitCycleTest()) {
            return action + "已由 HR 显式授权用于当前单会话周期测试";
        }
        return reason(status, action);
    }
}
