package ai.xzkj.recruitment.candidates;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
import java.util.UUID;

public interface CandidateProfileRepository extends JpaRepository<CandidateProfile, UUID> {
    Optional<CandidateProfile> findByCompanyIdAndSourceAndDedupKey(UUID companyId, CandidateSource source, String dedupKey);
}
