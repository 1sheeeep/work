package ai.xzkj.recruitment.notifications;

import java.time.Instant;
import java.util.UUID;

public interface NotificationGateway {
    NotificationChannel channel();
    NotificationResult notifyInterview(NotificationRequest request);
    record NotificationRequest(UUID notificationId, UUID recipientId, String idempotencyKey,
                               String candidateReference, String jobTitle, Instant startsAt,
                               String timezone, String mockOutcome) {}
    record NotificationResult(boolean succeeded, String message) {}
}
