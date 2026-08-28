package ai.xzkj.recruitment.boss;

import java.util.Set;
import java.util.UUID;

public interface BossGateway {
    BossCapabilityCheckResult inspect(BossAccount account);

    RecruitmentCycleResult executeRecruitmentCycle(BossAccount account, RecruitmentCycleRequest request);

    MessageSendResult sendMessage(BossAccount account, MessageSendRequest request);

    record BossCapabilityCheckResult(BossConnectionStatus status, Set<BossCapability> capabilities) {
    }

    record RecruitmentCycleRequest(UUID taskId, String idempotencyKey, int limit,
                                   String executionStrategy, String mockOutcome) {
    }

    record RecruitmentCycleResult(RecruitmentCycleOutcome outcome, int processedCount, String message) {
    }

    enum RecruitmentCycleOutcome {
        SUCCEEDED,
        FAILED,
        NEEDS_ATTENTION
    }

    record MessageSendRequest(UUID contactId, String idempotencyKey, String content) {}

    record MessageSendResult(boolean succeeded, String message) {}
}
