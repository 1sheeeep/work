package ai.xzkj.recruitment.jobs;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface JobPositionRepository extends JpaRepository<JobPosition, UUID> {
    @EntityGraph(attributePaths = {"company", "bossAccount"})
    List<JobPosition> findAllByOrderByCreatedAtDesc();

    @EntityGraph(attributePaths = {"company", "bossAccount", "bossAccount.capabilities"})
    Optional<JobPosition> findWithDetailsById(UUID id);
}
