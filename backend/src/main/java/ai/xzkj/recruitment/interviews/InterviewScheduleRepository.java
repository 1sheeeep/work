package ai.xzkj.recruitment.interviews;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface InterviewScheduleRepository extends JpaRepository<InterviewSchedule,UUID>{
    @EntityGraph(attributePaths={"contact","contact.candidate","contact.candidate.company","contact.jobPosition","contact.bossAccount","ownerHr","confirmedSlot"})
    List<InterviewSchedule> findAllByOrderByUpdatedAtDesc();
    @EntityGraph(attributePaths={"contact","contact.candidate","contact.candidate.company","contact.jobPosition","contact.bossAccount","ownerHr","confirmedSlot"})
    Optional<InterviewSchedule> findWithDetailsById(UUID id);
    @EntityGraph(attributePaths={"confirmedSlot"})
    List<InterviewSchedule> findByOwnerHrIdAndStatus(UUID ownerHrId,InterviewStatus status);
    List<InterviewSchedule> findByContactIdOrderByCreatedAtDesc(UUID contactId);
}
