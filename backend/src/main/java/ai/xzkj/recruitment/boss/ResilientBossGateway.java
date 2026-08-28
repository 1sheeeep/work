package ai.xzkj.recruitment.boss;

import ai.xzkj.recruitment.resilience.GatewayResilienceGuard;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

import java.util.Set;

@Component
@Primary
public class ResilientBossGateway implements BossGateway {
    private final MockBossGateway delegate;
    private final GatewayResilienceGuard guard;
    public ResilientBossGateway(MockBossGateway delegate, GatewayResilienceGuard guard) { this.delegate = delegate; this.guard = guard; }

    @Override public BossCapabilityCheckResult inspect(BossAccount account) {
        return guard.execute("boss.inspect", () -> delegate.inspect(account),
                result -> result.status() != BossConnectionStatus.UNAVAILABLE,
                reason -> new BossCapabilityCheckResult(BossConnectionStatus.UNAVAILABLE, Set.of()));
    }
    @Override public RecruitmentCycleResult executeRecruitmentCycle(BossAccount account, RecruitmentCycleRequest request) {
        return guard.execute("boss.recruitment-cycle", () -> delegate.executeRecruitmentCycle(account, request),
                result -> result.outcome() != RecruitmentCycleOutcome.FAILED,
                reason -> new RecruitmentCycleResult(RecruitmentCycleOutcome.NEEDS_ATTENTION, 0,
                        "BOSS Gateway 保护已触发：" + label(reason) + "，请 HR 人工处理"));
    }
    @Override public MessageSendResult sendMessage(BossAccount account, MessageSendRequest request) {
        return guard.execute("boss.message-send", () -> delegate.sendMessage(account, request), MessageSendResult::succeeded,
                reason -> new MessageSendResult(false, "BOSS Gateway 保护已触发：" + label(reason) + "，消息保留待人工处理"));
    }
    private String label(GatewayResilienceGuard.FailureReason reason) { return switch (reason) {
        case TIMEOUT -> "超时"; case RATE_LIMITED -> "频率限制"; case CONCURRENCY_LIMITED -> "并发限制";
        case CIRCUIT_OPEN -> "断路器已打开"; case GATEWAY_ERROR -> "网关异常"; };
    }
}
