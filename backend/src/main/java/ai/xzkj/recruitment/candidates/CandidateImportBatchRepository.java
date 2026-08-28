package ai.xzkj.recruitment.candidates;
import org.springframework.data.jpa.repository.*;
import java.util.*;
public interface CandidateImportBatchRepository extends JpaRepository<CandidateImportBatch,UUID>{
 @EntityGraph(attributePaths={"company","jobPosition","createdBy"}) Optional<CandidateImportBatch> findWithDetailsById(UUID id);
 @EntityGraph(attributePaths={"company","jobPosition","createdBy"}) List<CandidateImportBatch> findTop20ByOrderByCreatedAtDesc();
}
