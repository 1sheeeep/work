package ai.xzkj.recruitment.notifications;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface NotificationAttemptRepository extends JpaRepository<NotificationAttempt,UUID>{
    List<NotificationAttempt> findByNotificationIdOrderByAttemptedAtDesc(UUID notificationId);
    Optional<NotificationAttempt> findByNotificationIdAndIdempotencyKey(UUID notificationId,String key);
}
