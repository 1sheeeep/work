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
}
