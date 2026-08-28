package ai.xzkj.recruitment.boss;

import org.springframework.stereotype.Component;

import java.util.EnumSet;
import java.util.Set;

@Component
public class MockBossGateway implements BossGateway {
    @Override
    public BossCapabilityCheckResult inspect(BossAccount account) {
        return switch (account.getMockProfile()) {
            case FULL -> new BossCapabilityCheckResult(
                    BossConnectionStatus.CONNECTED, EnumSet.allOf(BossCapability.class));
            case READ_ONLY -> new BossCapabilityCheckResult(
                    BossConnectionStatus.DEGRADED,
                    EnumSet.of(BossCapability.JOB_SYNC, BossCapability.CANDIDATE_READ));
            case UNAVAILABLE -> new BossCapabilityCheckResult(
                    BossConnectionStatus.UNAVAILABLE, Set.of());
        };
    }

    @Override
    public RecruitmentCycleResult executeRecruitmentCycle(BossAccount account, RecruitmentCycleRequest request) {
        if (account.getMockProfile() == MockBossProfile.UNAVAILABLE) {
            return new RecruitmentCycleResult(RecruitmentCycleOutcome.FAILED, 0, "Mock BOSS 账号当前不可用");
        }
        return switch (request.mockOutcome()) {
            case "FAILURE" -> new RecruitmentCycleResult(
                    RecruitmentCycleOutcome.FAILED, 0, "Mock 执行失败，可修正配置后重试");
            case "NEEDS_ATTENTION" -> new RecruitmentCycleResult(
                    RecruitmentCycleOutcome.NEEDS_ATTENTION, 0, "Mock 执行需要 HR 人工介入");
            default -> new RecruitmentCycleResult(
                    RecruitmentCycleOutcome.SUCCEEDED, Math.min(request.limit(), 5), "Mock 执行成功");
        };
    }
}
