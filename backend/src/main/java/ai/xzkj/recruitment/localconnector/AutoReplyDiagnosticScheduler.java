package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.autoreply.AutoReplyPolicy;
import ai.xzkj.recruitment.autoreply.AutoReplyPolicyRepository;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Emits one concise, privacy-safe explanation when an unread conversation
 * cannot advance through unattended reply processing. The current state is
 * de-duplicated in memory so normal polling does not flood the audit log.
 */
@Component
class AutoReplyDiagnosticScheduler {
    private final BrowserDeviceRepository devices;
    private final BrowserUnreadObservationRepository observations;
    private final AutoReplyPolicyRepository policies;
    private final LocalConnectorCapabilityRepository capabilities;
    private final AuditService audit;
    private final Map<UUID, String> lastStateByDevice = new ConcurrentHashMap<>();

    AutoReplyDiagnosticScheduler(BrowserDeviceRepository devices,
                                 BrowserUnreadObservationRepository observations,
                                 AutoReplyPolicyRepository policies,
                                 LocalConnectorCapabilityRepository capabilities,
                                 AuditService audit) {
        this.devices = devices;
        this.observations = observations;
        this.policies = policies;
        this.capabilities = capabilities;
        this.audit = audit;
    }

    @Scheduled(fixedDelayString = "${app.auto-reply-diagnostic.interval:30s}", initialDelayString = "30s")
    @Transactional
    void diagnose() {
        Instant now = Instant.now();
        for (BrowserDevice device : devices.findAllByOrderByCreatedAtDesc()) {
            if (!"ACTIVE".equals(device.getStatus())) continue;
            List<BrowserUnreadObservation> unread = observations.findAllByAccountIdAndUnreadTrue(device.getBossAccount().getId())
                    .stream().filter(item -> device.getId().equals(item.getDevice().getId())).toList();
            publishIfChanged(device, describe(device, unread, now));
        }
    }

    private String describe(BrowserDevice device, List<BrowserUnreadObservation> unread, Instant now) {
        if (unread.isEmpty()) return "CLEAR|当前没有待处理未读会话。";
        AutoReplyPolicy policy = policies.findByBossAccountId(device.getBossAccount().getId()).orElse(null);
        if (policy == null || !policy.isAwayActive(now) || !policy.isAutoSendEnabled()) {
            return "BLOCKED_POLICY|发现 " + unread.size() + " 条未读，但挂机或自动发送总开关未开启。";
        }
        if (!"RUNNING".equals(device.getRuntimeState())) {
            String reason = blank(device.getLastPauseReason()) ? device.getStopReason() : device.getLastPauseReason();
            return "BLOCKED_DEVICE|发现 " + unread.size() + " 条未读，但浏览器桥接为 " + device.getRuntimeState()
                    + "、页面为 " + device.getPageContext() + "；" + fallback(reason, "请打开 BOSS 沟通页并保持插件运行。") ;
        }
        long snapshotRequired = unread.stream().filter(item -> "SNAPSHOT_CONFIRMATION_REQUIRED".equals(item.getEligibilityStatus())).count();
        if (snapshotRequired > 0) return "BLOCKED_SNAPSHOT|有 " + snapshotRequired + " 条未读只在列表中出现，尚未稳定打开会话确认最后一条消息。";
        long detailRequired = unread.stream().filter(item -> item.getDetailVerifiedAt() == null || item.getDetailVerifiedAt().isBefore(now.minusSeconds(180))).count();
        if (detailRequired > 0) return "BLOCKED_DETAIL|有 " + detailRequired + " 条未读会话详情已过期，等待插件重新读取并稳定复核。";
        long unmatched = unread.stream().filter(item -> item.getMatchedJobPositionId() == null).count();
        if (unmatched > 0) return "BLOCKED_JOB|有 " + unmatched + " 条未读未唯一匹配启用岗位，系统不会猜测回复对象。";
        LocalConnectorCapability send = capabilities.findByDeviceIdAndCapability(device.getId(), "SEND_MESSAGE").orElse(null);
        if (send == null || !"PRODUCTION_APPROVED".equals(send.getStatus())) {
            return "WARN_LEGACY_SEND_CAPABILITY|未读会话已可分析；旧浏览器动作队列的发送能力尚未完成生产验收。AI 直连回复任务仍会独立记录。";
        }
        return "READY|发现 " + unread.size() + " 条未读，挂机、桥接、会话详情和岗位匹配均已就绪，等待插件逐条领取。";
    }

    private void publishIfChanged(BrowserDevice device, String state) {
        String previous = lastStateByDevice.put(device.getId(), state);
        if (state.equals(previous)) return;
        String[] parts = state.split("\\|", 2);
        String code = parts[0];
        String detail = parts.length > 1 ? parts[1] : state;
        String action = "CLEAR".equals(code) || "READY".equals(code)
                ? "AUTO_REPLY_DIAGNOSTIC_RECOVERED" : "AUTO_REPLY_DIAGNOSTIC_BLOCKED";
        audit.systemSuccess(action, "BROWSER_DEVICE", device.getId(), device.getDisplayName(), code + " · " + detail);
    }

    private boolean blank(String value) { return value == null || value.isBlank(); }
    private String fallback(String value, String fallback) { return blank(value) ? fallback : value; }
}
