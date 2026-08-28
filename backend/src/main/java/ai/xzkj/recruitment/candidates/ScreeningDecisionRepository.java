package ai.xzkj.recruitment.candidates;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface ScreeningDecisionRepository extends JpaRepository<ScreeningDecision, UUID> {
    @EntityGraph(attributePaths = {"createdBy"})
    List<ScreeningDecision> findByContactIdOrderByCreatedAtDesc(UUID contactId);
}
