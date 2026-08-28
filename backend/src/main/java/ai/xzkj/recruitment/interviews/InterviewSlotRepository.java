package ai.xzkj.recruitment.interviews;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface InterviewSlotRepository extends JpaRepository<InterviewSlot,UUID>{
    List<InterviewSlot> findByScheduleIdOrderByRoundNumberDescStartsAtAsc(UUID scheduleId);
    List<InterviewSlot> findByScheduleIdAndRoundNumberOrderByStartsAtAsc(UUID scheduleId,int roundNumber);
    Optional<InterviewSlot> findByIdAndScheduleId(UUID id,UUID scheduleId);
}
