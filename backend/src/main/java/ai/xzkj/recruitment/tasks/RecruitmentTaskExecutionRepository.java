package ai.xzkj.recruitment.tasks;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RecruitmentTaskExecutionRepository extends JpaRepository<RecruitmentTaskExecution, UUID> {
    Optional<RecruitmentTaskExecution> findByTaskIdAndIdempotencyKey(UUID taskId, String idempotencyKey);
    List<RecruitmentTaskExecution> findTop20ByTaskIdOrderByStartedAtDesc(UUID taskId);
    long countByTaskId(UUID taskId);
}
