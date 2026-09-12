package ai.xzkj.recruitment.candidates;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface CandidateProfileRepository extends JpaRepository<CandidateProfile, UUID> {
    List<CandidateProfile> findAllByOrderByUpdatedAtDesc();
    Optional<CandidateProfile> findByCompanyIdAndSourceAndDedupKey(UUID companyId, CandidateSource source, String dedupKey);
    List<CandidateProfile> findAllByCompanyIdAndIdentityPhoneDigest(UUID companyId, String identityPhoneDigest);
    List<CandidateProfile> findAllByCompanyIdAndIdentityEmailDigest(UUID companyId, String identityEmailDigest);
    List<CandidateProfile> findByMergedIntoId(UUID mergedIntoId);
}
