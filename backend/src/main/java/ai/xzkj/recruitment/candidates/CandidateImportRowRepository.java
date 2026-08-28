package ai.xzkj.recruitment.candidates;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.*;
public interface CandidateImportRowRepository extends JpaRepository<CandidateImportRow,UUID>{List<CandidateImportRow> findByBatchIdOrderByRowNumber(UUID batchId);}
