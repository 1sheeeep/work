package ai.xzkj.recruitment.notifications;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
public record HrNotificationResponse(UUID id,int confirmationRound,String recipientName,NotificationChannel channel,
                                     NotificationStatus status,int attemptCount,String lastError,Instant sentAt,
                                     Instant createdAt,List<NotificationAttemptResponse> attempts){
    public static HrNotificationResponse from(HrNotification item,List<NotificationAttempt> attempts){return new HrNotificationResponse(
            item.getId(),item.getConfirmationRound(),item.getRecipient().getDisplayName(),item.getChannel(),item.getStatus(),
            item.getAttemptCount(),item.getLastError(),item.getSentAt(),item.getCreatedAt(),attempts.stream().map(NotificationAttemptResponse::from).toList());}
}
