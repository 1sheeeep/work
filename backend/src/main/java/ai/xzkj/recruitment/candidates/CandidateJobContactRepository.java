package ai.xzkj.recruitment.candidates;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface CandidateJobContactRepository extends JpaRepository<CandidateJobContact, UUID> {
    @EntityGraph(attributePaths = {"candidate", "candidate.company", "jobPosition", "jobPosition.company", "bossAccount", "assignedHr"})
    List<CandidateJobContact> findAllByOrderByUpdatedAtDesc();
    @EntityGraph(attributePaths = {"candidate", "candidate.company", "jobPosition", "jobPosition.company", "bossAccount", "bossAccount.capabilities", "assignedHr"})
    Optional<CandidateJobContact> findWithDetailsById(UUID id);
    Optional<CandidateJobContact> findByCandidateIdAndJobPositionId(UUID candidateId, UUID jobPositionId);
    List<CandidateJobContact> findByCandidateId(UUID candidateId);
}
