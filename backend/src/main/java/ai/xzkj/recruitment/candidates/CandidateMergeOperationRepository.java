package ai.xzkj.recruitment.candidates;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface CandidateMergeOperationRepository extends JpaRepository<CandidateMergeOperation, UUID> {
    Optional<CandidateMergeOperation> findByIdAndStatus(UUID id, String status);
    List<CandidateMergeOperation> findAllByOrderByCreatedAtDesc();
}
