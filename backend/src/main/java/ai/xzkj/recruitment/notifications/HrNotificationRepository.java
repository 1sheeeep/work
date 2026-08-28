package ai.xzkj.recruitment.notifications;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface HrNotificationRepository extends JpaRepository<HrNotification,UUID>{
    @EntityGraph(attributePaths={"recipient"})
    List<HrNotification> findByScheduleIdOrderByConfirmationRoundDesc(UUID scheduleId);
    @EntityGraph(attributePaths={"recipient"})
    Optional<HrNotification> findByScheduleIdAndConfirmationRound(UUID scheduleId,int round);
    @EntityGraph(attributePaths={"recipient"})
    Optional<HrNotification> findWithRecipientById(UUID id);
}
