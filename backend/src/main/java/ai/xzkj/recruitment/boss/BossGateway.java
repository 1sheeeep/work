package ai.xzkj.recruitment.boss;

import java.util.Set;

public interface BossGateway {
    BossCapabilityCheckResult inspect(BossAccount account);

    record BossCapabilityCheckResult(BossConnectionStatus status, Set<BossCapability> capabilities) {
    }
}
