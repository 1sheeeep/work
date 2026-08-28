package ai.xzkj.recruitment.notifications;
import java.time.Instant;
import java.util.UUID;
public record NotificationAttemptResponse(UUID id,String idempotencyKey,NotificationStatus status,String message,Instant attemptedAt){
    public static NotificationAttemptResponse from(NotificationAttempt attempt){return new NotificationAttemptResponse(attempt.getId(),attempt.getIdempotencyKey(),attempt.getStatus(),attempt.getMessage(),attempt.getAttemptedAt());}
}
