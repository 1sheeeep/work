package ai.xzkj.recruitment.candidates;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface CandidateMergeItemRepository extends JpaRepository<CandidateMergeItem, UUID> {
    List<CandidateMergeItem> findByOperationId(UUID operationId);
}
