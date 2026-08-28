package ai.xzkj.recruitment.tasks;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RecruitmentTaskRepository extends JpaRepository<RecruitmentTask, UUID> {
    @EntityGraph(attributePaths = {"jobPosition", "jobPosition.company", "bossAccount"})
    List<RecruitmentTask> findAllByOrderByCreatedAtDesc();

    @EntityGraph(attributePaths = {"jobPosition", "jobPosition.company", "bossAccount", "bossAccount.capabilities"})
    Optional<RecruitmentTask> findWithDetailsById(UUID id);
}
