package ai.xzkj.recruitment.boss;

import java.util.UUID;

public interface BossGateway {
    MessageSendResult sendMessage(BossAccount account, MessageSendRequest request);
    record MessageSendRequest(UUID contactId, String idempotencyKey, String content) {}
    record MessageSendResult(boolean succeeded, String message) {}
}
